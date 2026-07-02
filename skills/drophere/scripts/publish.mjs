#!/usr/bin/env node
// drophere.cc publish script — uploads static files via the 3-step upload flow.
// Dependencies: Node.js 18+ (uses built-in crypto, fs, path, http, https)
// Usage: node publish.mjs [OPTIONS] <directory-or-files...>
//
// Exit codes: 0 = success, 1 = failure
// stdout: final site URL only
// stderr: progress, errors

import { createHash, randomBytes } from "node:crypto";
import { chmodSync, createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { homedir } from "node:os";
import { basename, extname, join, posix, resolve, sep } from "node:path";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

let API_BASE = "https://drophere.cc";
const CLIENT_HEADER = "claude-code/publish-mjs";
const STATE_DIR = ".drophere";
const STATE_FILE = join(STATE_DIR, "state.json");
const MACHINE_STATE_FILE = join(STATE_DIR, "machine-payment-state.json");
const CREDENTIALS_FILE = join(homedir(), ".drophere", "credentials");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function log(msg) { process.stderr.write(`[drophere] ${msg}\n`); }
function warn(msg) { process.stderr.write(`[drophere] WARNING: ${msg}\n`); }
function err(msg) { process.stderr.write(`[drophere] ERROR: ${msg}\n`); }
function debug(msg) { if (process.env.DROPHERE_DEBUG === "1") process.stderr.write(`[drophere:debug] ${msg}\n`); }

function contentType(file) {
  const ext = extname(file).toLowerCase().replace(/^\./, "");
  const map = {
    html: "text/html", htm: "text/html",
    css: "text/css",
    js: "application/javascript", mjs: "application/javascript",
    json: "application/json",
    xml: "application/xml",
    svg: "image/svg+xml",
    png: "image/png",
    jpg: "image/jpeg", jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    avif: "image/avif",
    ico: "image/x-icon",
    pdf: "application/pdf",
    woff: "font/woff",
    woff2: "font/woff2",
    ttf: "font/ttf",
    otf: "font/otf",
    mp4: "video/mp4",
    webm: "video/webm",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    ogg: "audio/ogg",
    txt: "text/plain",
    md: "text/markdown",
    csv: "text/csv",
    wasm: "application/wasm",
    zip: "application/zip",
    tar: "application/x-tar",
    gz: "application/gzip", tgz: "application/gzip",
  };
  return map[ext] || "application/octet-stream";
}

function usage() {
  process.stderr.write(`Usage: node publish.mjs [OPTIONS] <directory | file...>

Publish static files to drophere.cc.

Options:
  --slug SLUG        Update an existing artifact by slug
  --update-slug SLUG Update an existing artifact by slug (alias for --slug)
  --claim-slug SLUG  Claim a paid vanity artifact slug when creating a new artifact
  --new              Ignore .drophere/state.json and create a new artifact
  --api-key KEY      API key for authenticated uploads
  --title TITLE      Set viewer title
  --description DESC Set viewer description
  --ttl SECONDS      Set expiry (authenticated only)
  --payment tempo    Use accountless Tempo MPP paid publish instead of Stripe/account APIs
  --mpp-tx-hash HASH Complete a Tempo MPP publish with a broadcast transaction hash
  --mpp-source-did DID
                     Optional did:pkh sender pin for --mpp-tx-hash
  --mpp-authorization HEADER
                     Complete with a full Authorization: Payment header
  --dry-run          List files that would be published, then exit
  --base-url URL     Override API base URL
  --help             Show this help

Authentication priority:
  1. --api-key flag
  2. DROPHERE_API_KEY environment variable
  3. ~/.drophere/credentials file
  4. Anonymous (24h TTL, no auth needed)

Examples:
  node publish.mjs ./dist/                    # Anonymous publish
  node publish.mjs --api-key dp_... --claim-slug client-demo ./dist/
                                               # Create https://client-demo.drophere.cc/
                                               # Use for requested root URLs like name.drophere.cc
  node publish.mjs --slug abc123 ./dist/
                                               # Update existing artifact
  node publish.mjs --api-key dp_... ./site/   # Authenticated publish
  node publish.mjs --payment tempo ./dist/     # Start Tempo MPP paid publish
  node publish.mjs --payment tempo --mpp-tx-hash 0x... ./dist/
`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Parse arguments
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {
    slug: "",
    updateSlug: "",
    claimSlug: "",
    apiKey: "",
    title: "",
    description: "",
    ttl: "",
    payment: "",
    mppTxHash: "",
    mppSourceDid: "",
    mppAuthorization: "",
    dryRun: false,
    newArtifact: false,
    inputs: [],
  };
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    switch (arg) {
      case "--slug":       args.slug = argv[++i]; break;
      case "--update-slug": args.updateSlug = argv[++i]; break;
      case "--claim-slug": args.claimSlug = argv[++i]; break;
      case "--api-key":    args.apiKey = argv[++i]; break;
      case "--title":      args.title = argv[++i]; break;
      case "--description": args.description = argv[++i]; break;
      case "--ttl":        args.ttl = argv[++i]; break;
      case "--payment":    args.payment = argv[++i]; break;
      case "--mpp-tx-hash": args.mppTxHash = argv[++i]; break;
      case "--mpp-source-did": args.mppSourceDid = argv[++i]; break;
      case "--mpp-authorization": args.mppAuthorization = argv[++i]; break;
      case "--dry-run":    args.dryRun = true; break;
      case "--new":        args.newArtifact = true; break;
      case "--base-url":   API_BASE = argv[++i]; break;
      case "--help": case "-h": usage(); break;
      default:
        if (arg.startsWith("-")) { err(`Unknown option: ${arg}`); usage(); }
        args.inputs.push(arg);
    }
    i++;
  }
  return args;
}

function base64UrlDecode(value) {
  const padded = value + "=".repeat((4 - (value.length % 4)) % 4);
  return Buffer.from(padded, "base64url").toString("utf8");
}

function base64UrlEncodeJson(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url").replace(/=+$/, "");
}

function parsePaymentChallengeHeader(header) {
  if (!header || !/^Payment\s+/i.test(header)) {
    throw new Error("Missing WWW-Authenticate: Payment challenge");
  }
  const params = {};
  for (const match of header.slice(header.search(/\s/) + 1).matchAll(/([A-Za-z][A-Za-z0-9_-]*)="((?:\\.|[^"])*)"/g)) {
    params[match[1]] = match[2].replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  for (const key of ["id", "realm", "method", "intent", "request", "expires"]) {
    if (!params[key]) throw new Error(`Payment challenge missing ${key}`);
  }
  const challenge = {
    id: params.id,
    realm: params.realm,
    method: params.method,
    intent: params.intent,
    request: params.request,
    expires: params.expires,
  };
  if (params.description) challenge.description = params.description;
  if (params.opaque) challenge.opaque = params.opaque;
  return {
    challenge,
    request: JSON.parse(base64UrlDecode(params.request)),
    wwwAuthenticate: header,
  };
}

function makePaymentAuthorization(challenge, txHash, sourceDid) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    throw new Error("--mpp-tx-hash must be a 32-byte 0x-prefixed hex hash");
  }
  const credential = {
    challenge,
    payload: { type: "hash", hash: txHash },
  };
  if (sourceDid) credential.source = sourceDid;
  return `Payment ${base64UrlEncodeJson(credential)}`;
}

// ---------------------------------------------------------------------------
// Resolve API key
// ---------------------------------------------------------------------------

function resolveApiKey(flagValue) {
  if (flagValue) return flagValue;
  if (process.env.DROPHERE_API_KEY) return process.env.DROPHERE_API_KEY;
  if (existsSync(CREDENTIALS_FILE)) {
    const lines = readFileSync(CREDENTIALS_FILE, "utf8").split("\n");
    for (const line of lines) {
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      const value = line.slice(eq + 1).trim();
      if (key === "API_KEY") return value;
    }
  }
  return "";
}

// ---------------------------------------------------------------------------
// Hash file (streaming SHA-256)
// ---------------------------------------------------------------------------

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve("sha256:" + hash.digest("hex")));
    stream.on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// Scan files — build manifest + fileMap
// ---------------------------------------------------------------------------

async function scanFiles(inputs) {
  const files = [];       // {path, size, contentType, hash}
  const fileMap = {};     // relPath -> absolute local path

  for (const input of inputs) {
    const abs = resolve(input);
    const stat = statSync(abs, { throwIfNoEntry: false });
    if (!stat) { err(`Not a file or directory: ${input}`); process.exit(1); }

    if (stat.isDirectory()) {
      // Recursive walk
      const entries = readdirSync(abs, { recursive: true });
      // Sort for deterministic order
      entries.sort();
      for (const entry of entries) {
        // Normalize to forward slashes for comparison
        const relPath = entry.split(sep).join(posix.sep);
        // Skip hidden files and .drophere directory
        if (relPath.split(posix.sep).some((p) => p.startsWith("."))) continue;
        if (relPath.startsWith(STATE_DIR)) continue;

        const fullPath = join(abs, entry);
        const fstat = statSync(fullPath, { throwIfNoEntry: false });
        if (!fstat || !fstat.isFile()) continue;

        const size = fstat.size;
        const ct = contentType(fullPath);
        const hash = await hashFile(fullPath);

        files.push({ path: relPath, size, contentType: ct, hash });
        fileMap[relPath] = fullPath;
      }
    } else if (stat.isFile()) {
      const relPath = basename(abs);
      const size = stat.size;
      const ct = contentType(abs);
      const hash = await hashFile(abs);

      files.push({ path: relPath, size, contentType: ct, hash });
      fileMap[relPath] = abs;
    }
  }

  return { files, fileMap };
}

// ---------------------------------------------------------------------------
// Upload via node:https (bypasses undici — fixes ETIMEDOUT on Cloudflare endpoints)
// ---------------------------------------------------------------------------

function httpsUpload(url, fileData, contentType) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const reqFn = parsed.protocol === "https:" ? httpsRequest : httpRequest;
    const req = reqFn(parsed, {
      method: "PUT",
      headers: {
        "Content-Type": contentType,
        "Content-Length": fileData.length,
      },
      autoSelectFamily: true,
      autoSelectFamilyAttemptTimeout: 1000,
    }, (res) => {
      let body = "";
      res.on("data", (chunk) => body += chunk);
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("error", reject);
    req.end(fileData);
  });
}

// ---------------------------------------------------------------------------
// API request helper
// ---------------------------------------------------------------------------

function apiRequestRaw(method, url, body, apiKey, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const headers = {
      "x-drophere-client": CLIENT_HEADER,
      "Content-Type": "application/json",
      ...extraHeaders,
    };
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

    const jsonBody = body !== undefined ? JSON.stringify(body) : undefined;
    if (jsonBody !== undefined) headers["Content-Length"] = Buffer.byteLength(jsonBody);

    const reqFn = parsed.protocol === "https:" ? httpsRequest : httpRequest;
    const req = reqFn(parsed, {
      method,
      headers,
      autoSelectFamily: true,
      autoSelectFamilyAttemptTimeout: 1000,
    }, (res) => {
      let text = "";
      res.on("data", (chunk) => text += chunk);
      res.on("end", () => {
        let json;
        try {
          json = text ? JSON.parse(text) : null;
        } catch {
          reject(new Error(`${method} ${parsed.pathname} returned invalid JSON: ${text}`));
          return;
        }
        resolve({ status: res.statusCode || 0, headers: res.headers, body: json, text });
      });
    });

    req.on("error", (e) => {
      const detail = e.message || String(e);
      reject(new Error(`${method} ${parsed.pathname} failed: ${detail}`));
    });

    if (jsonBody !== undefined) {
      req.end(jsonBody);
    } else {
      req.end();
    }
  });
}

async function apiRequest(method, url, body, apiKey) {
  const response = await apiRequestRaw(method, url, body, apiKey);
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`${method} ${new URL(url).pathname} returned HTTP ${response.status}: ${response.text}`);
  }
  return response.body;
}

// ---------------------------------------------------------------------------
// Retry wrapper for transient network errors
// ---------------------------------------------------------------------------

async function withRetry(fn, { retries = 1, delayMs = 1000 } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const isRetryable = /ETIMEDOUT|ENETUNREACH|ECONNRESET|ECONNREFUSED|socket hang up/i.test(e.message)
        || /returned HTTP 5\d\d/i.test(e.message);
      if (attempt < retries && isRetryable) {
        log(`Retrying after error: ${e.message}`);
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }
      throw e;
    }
  }
}

// ---------------------------------------------------------------------------
// Save state to .drophere/state.json
// ---------------------------------------------------------------------------

function saveState(slug, versionId, siteUrl, claimToken) {
  mkdirSync(STATE_DIR, { recursive: true });
  const state = { slug, versionId, siteUrl, claimToken, updatedAt: new Date().toISOString() };
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + "\n");
  debug(`State saved to ${STATE_FILE}`);
}

function saveMachineState(state) {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(MACHINE_STATE_FILE, JSON.stringify(state, null, 2) + "\n", { mode: 0o600 });
  chmodSync(MACHINE_STATE_FILE, 0o600);
  debug(`Machine payment state saved to ${MACHINE_STATE_FILE}`);
}

function loadMachineState() {
  if (!existsSync(MACHINE_STATE_FILE)) {
    throw new Error(`Machine payment state not found: ${MACHINE_STATE_FILE}. Start with --payment tempo before passing a transaction hash.`);
  }
  return JSON.parse(readFileSync(MACHINE_STATE_FILE, "utf8"));
}

function machinePublishBody(files, args) {
  const body = { files, source: "publish-mjs:mpp" };
  if (args.title || args.description) {
    body.viewer = {};
    if (args.title) body.viewer.title = args.title;
    if (args.description) body.viewer.description = args.description;
  }
  return body;
}

async function uploadFiles(uploads, fileMap) {
  if (uploads.length > 0) {
    log(`Uploading ${uploads.length} file(s)...`);
    let uploadErrors = 0;

    for (const upload of uploads) {
      const localFile = fileMap[upload.path];
      if (!localFile || !existsSync(localFile)) {
        err(`Local file not found for path: ${upload.path}`);
        uploadErrors++;
        continue;
      }

      debug(`Uploading: ${upload.path}`);
      const fileData = readFileSync(localFile);
      const uploadCt = upload.headers?.["Content-Type"] || contentType(localFile);

      let result;
      try {
        result = await withRetry(() => httpsUpload(upload.url, fileData, uploadCt));
      } catch (uploadErr) {
        const details = uploadErr.errors
          ? uploadErr.errors.map((e) => e.message || String(e)).join("; ")
          : uploadErr.message || String(uploadErr);
        err(`Upload ${upload.path} failed: ${details}`);
        uploadErrors++;
        continue;
      }

      if (result.status < 200 || result.status >= 300) {
        err(`Upload ${upload.path} returned HTTP ${result.status}`);
        uploadErrors++;
      }
    }

    if (uploadErrors > 0) {
      err(`${uploadErrors} upload(s) failed`);
      process.exit(1);
    }
  } else {
    log("All files unchanged — no uploads needed");
  }
}

async function machinePublish(args, files, fileMap) {
  if (args.slug || args.updateSlug) throw new Error("--payment tempo creates a new paid machine artifact; --slug updates are not supported");
  if (args.claimSlug) throw new Error("--payment tempo creates accountless machine artifacts; vanity slugs require authenticated account artifacts");
  if (args.apiKey) throw new Error("--payment tempo is accountless and cannot be combined with --api-key");
  if (args.ttl) throw new Error("--ttl is not supported for --payment tempo; the server uses MPP_ARTIFACT_TTL_DAYS");

  const body = machinePublishBody(files, args);
  const bodyJson = JSON.stringify(body);
  const hasPaymentCredential = Boolean(args.mppAuthorization || args.mppTxHash);
  const headers = {};
  let idempotencyKey;
  let state;

  if (hasPaymentCredential) {
    state = loadMachineState();
    if (JSON.stringify(state.body) !== bodyJson) {
      throw new Error(`Current files/options do not match ${MACHINE_STATE_FILE}; rerun phase 1 after changing inputs`);
    }
    idempotencyKey = state.idempotencyKey;
    headers.Authorization = args.mppAuthorization || makePaymentAuthorization(state.challenge, args.mppTxHash, args.mppSourceDid);
  } else {
    idempotencyKey = `publish-mpp-${randomBytes(24).toString("base64url")}`;
  }
  headers["Idempotency-Key"] = idempotencyKey;

  const create = await withRetry(() => apiRequestRaw("POST", `${API_BASE}/api/v1/machine/artifact`, body, "", headers));
  if (!hasPaymentCredential) {
    if (create.status !== 402) {
      throw new Error(`POST /api/v1/machine/artifact returned HTTP ${create.status}: ${create.text}`);
    }
    const parsed = parsePaymentChallengeHeader(String(create.headers["www-authenticate"] || ""));
    state = {
      baseUrl: API_BASE,
      idempotencyKey,
      body,
      bodyJson,
      challenge: parsed.challenge,
      request: parsed.request,
      wwwAuthenticate: parsed.wwwAuthenticate,
      createdAt: new Date().toISOString(),
    };
    saveMachineState(state);
    log("Tempo MPP payment required. Decoded request:");
    process.stderr.write(JSON.stringify(parsed.request, null, 2) + "\n");
    log(`State file: ${MACHINE_STATE_FILE}`);
    log(`After broadcasting the Tempo transfer, rerun with: node publish.mjs --payment tempo --mpp-tx-hash 0x... ${args.inputs.join(" ")}`);
    return;
  }

  if (create.status !== 200 && create.status !== 201) {
    throw new Error(`POST /api/v1/machine/artifact returned HTTP ${create.status}: ${create.text}`);
  }

  const response = create.body || {};
  const slug = response.slug;
  const versionId = response.versionId;
  const machineToken = response.machineToken;
  if (!slug || !versionId || !machineToken) {
    throw new Error("Machine artifact response missing slug, versionId, or machineToken");
  }

  saveMachineState({
    ...state,
    slug,
    versionId,
    siteUrl: response.siteUrl,
    machineToken,
    paymentReceipt: create.headers["payment-receipt"] || "",
    paidAt: new Date().toISOString(),
  });

  await uploadFiles(response.uploads || [], fileMap);

  log("Finalizing...");
  const finalized = await withRetry(() => apiRequestRaw(
    "POST",
    `${API_BASE}/api/v1/machine/artifact/${encodeURIComponent(slug)}/finalize`,
    { versionId },
    "",
    { "X-Drophere-Machine-Token": machineToken },
  ));
  if (finalized.status < 200 || finalized.status >= 300) {
    throw new Error(`POST /api/v1/machine/artifact/${slug}/finalize returned HTTP ${finalized.status}: ${finalized.text}`);
  }

  const siteUrl = finalized.body?.siteUrl || response.siteUrl;
  saveMachineState({
    ...state,
    slug,
    versionId,
    siteUrl,
    machineToken,
    paymentReceipt: create.headers["payment-receipt"] || "",
    finalizedAt: new Date().toISOString(),
  });

  log("Published successfully!");
  log(`URL: ${siteUrl}`);
  if (finalized.body?.expiresAt) log(`Expires: ${finalized.body.expiresAt}`);
  process.stdout.write(siteUrl + "\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.inputs.length === 0) {
    err("No files or directory specified");
    usage();
  }

  const apiKey = resolveApiKey(args.apiKey);
  if (apiKey) { debug("Using authenticated mode"); }
  else { debug("Using anonymous mode (24h TTL)"); }

  // Warn anonymous users on creates (no explicit update target, no existing state)
  const isCreate = !args.slug && !args.updateSlug && !args.claimSlug && !existsSync(STATE_FILE);
  if (!apiKey && isCreate) {
    warn("No API key found — anonymous publish (5 creates/hour, 24h TTL)");
    warn("Authenticate for 60 creates/hour and permanent hosting: see --help");
  }

  // Scan files
  log("Scanning files...");
  const { files, fileMap } = await scanFiles(args.inputs);

  if (files.length === 0) {
    err("No files found to publish");
    process.exit(1);
  }

  log(`Found ${files.length} file(s)`);

  if (args.dryRun) {
    log("Dry run — files that would be published:");
    for (const f of files) log(`  ${f.path} (${f.size} bytes, ${f.contentType})`);
    process.exit(0);
  }

  if (args.payment) {
    if (args.payment !== "tempo") throw new Error(`Unsupported payment option: ${args.payment}`);
    await machinePublish(args, files, fileMap);
    return;
  }

  // Load state
  let slug = args.updateSlug || args.slug;
  const requestedSlug = args.claimSlug;
  let claimToken = "";

  if (requestedSlug && !apiKey) {
    throw new Error("--claim-slug claims a paid vanity artifact URL and requires authentication. Set DROPHERE_API_KEY or pass --api-key.");
  }
  if (requestedSlug && args.ttl) {
    throw new Error("--claim-slug claims a persistent vanity artifact URL; omit --ttl.");
  }
  if (requestedSlug && slug) {
    throw new Error("Use either --claim-slug for create-time vanity URLs or --slug/--update-slug for updates, not both.");
  }

  if (!slug && !requestedSlug && !args.newArtifact && existsSync(STATE_FILE)) {
    try {
      const state = JSON.parse(readFileSync(STATE_FILE, "utf8"));
      slug = state.slug || "";
      claimToken = state.claimToken || "";
      if (slug) debug(`Loaded slug=${slug} from state file`);
    } catch { /* ignore corrupt state */ }
  } else if (slug && existsSync(STATE_FILE)) {
    try {
      const state = JSON.parse(readFileSync(STATE_FILE, "utf8"));
      claimToken = state.claimToken || "";
    } catch { /* ignore */ }
  }

  // Detect anonymous→authenticated switch: state has claimToken but we now have an apiKey
  if (slug && claimToken && apiKey) {
    log(`Claiming anonymous artifact ${slug} for your account...`);
    try {
      await withRetry(() => apiRequest("POST", `${API_BASE}/api/v1/artifact/${slug}/claim`, { claimToken }, apiKey));
      claimToken = "";
      // Save state immediately after claim so claimToken is cleared
      let prevState = {};
      try { prevState = JSON.parse(readFileSync(STATE_FILE, "utf8")); } catch {}
      saveState(slug, prevState.versionId || "", prevState.siteUrl || "", claimToken);
      log("Artifact claimed successfully");
    } catch (claimErr) {
      // Maybe we already own it (claimed in a previous run)
      try {
        await withRetry(() => apiRequest("GET", `${API_BASE}/api/v1/artifact/${slug}`, undefined, apiKey));
        claimToken = "";
        log("Artifact already claimed — continuing with update");
      } catch {
        err(`Could not claim artifact: ${claimErr.message}`);
        err("Starting fresh with a new artifact instead");
        slug = "";
        claimToken = "";
      }
    }
  }

  // Create or Update artifact
  let response;

  if (slug) {
    log(`Updating artifact: ${slug}`);
    const body = { files };
    if (claimToken && !apiKey) body.claimToken = claimToken;

    response = await withRetry(() => apiRequest("PUT", `${API_BASE}/api/v1/artifact/${slug}`, body, apiKey));
  } else {
    log(requestedSlug ? `Creating new artifact with vanity slug: ${requestedSlug}` : "Creating new artifact...");
    const body = { files };
    if (requestedSlug) body.slug = requestedSlug;

    // Optional viewer metadata
    if (args.title || args.description) {
      body.viewer = {};
      if (args.title) body.viewer.title = args.title;
      if (args.description) body.viewer.description = args.description;
    }

    // Optional TTL
    if (args.ttl) body.ttlSeconds = Number(args.ttl);

    response = await withRetry(() => apiRequest("POST", `${API_BASE}/api/v1/artifact`, body, apiKey));
  }

  // Parse response
  slug = response.slug;
  const versionId = response.versionId;
  let siteUrl = response.siteUrl;
  if (response.claimToken) claimToken = response.claimToken;
  const uploads = response.uploads || [];
  const skipped = response.skipped || [];

  // Save state immediately so slug is persisted even if uploads fail
  saveState(slug, versionId, siteUrl, claimToken);

  if (skipped.length > 0) {
    log(`Skipped ${skipped.length} unchanged file(s)`);
  }

  debug(`slug=${slug} versionId=${versionId} uploads=${uploads.length}`);

  // Upload files to upload URLs
  await uploadFiles(uploads, fileMap);

  // Finalize
  log("Finalizing...");
  const finalizeBody = { versionId };
  if (claimToken && !apiKey) finalizeBody.claimToken = claimToken;

  const finalizeResponse = await withRetry(() => apiRequest("POST", `${API_BASE}/api/v1/artifact/${slug}/finalize`, finalizeBody, apiKey));

  siteUrl = finalizeResponse.siteUrl;
  const expiresAt = finalizeResponse.expiresAt || "";

  // Save state (update with final siteUrl/versionId)
  saveState(slug, versionId, siteUrl, claimToken);

  // Output
  log("Published successfully!");
  log(`URL: ${siteUrl}`);
  if (expiresAt) log(`Expires: ${expiresAt}`);

  // Final URL to stdout (for agent capture)
  process.stdout.write(siteUrl + "\n");
}

main().catch((e) => {
  err(e.message || String(e));
  if (e.cause) err(`Cause: ${e.cause.message || e.cause}`);
  if (e.errors) {
    for (const sub of e.errors) err(`  - ${sub.message || String(sub)}`);
  }
  process.exit(1);
});
