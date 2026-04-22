#!/usr/bin/env node
// drophere.cc auth script — completes the magic-link flow end-to-end so an
// agent can obtain an API key without the user having to hand-craft curl.
//
// Dependencies: Node.js 18+ (uses built-in http, https)
// Usage:
//   node auth.mjs login <email>                  # request a code (emailed)
//   node auth.mjs verify <email> <code>          # exchange code for apiKey
//
// Exit codes: 0 = success, 1 = failure
// stdout: JSON result from the API (login) OR the bare apiKey (verify)
// stderr: progress, errors
//
// Why two stdout shapes?  The host agent pipes `verify` straight into a
// secret store, so we keep that output as a single token on one line.
// `login` returns structured data (expiresAt) that the agent may want to
// surface to the user verbatim.

import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { pathToFileURL } from "node:url";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

let API_BASE = "https://drophere.cc";
const CLIENT_HEADER = "claude-code/auth-mjs";
const REQUEST_TIMEOUT_MS = 30_000;

// Magic-link codes are in XXXX-XXXX form, drawn from an ambiguous-char-free
// alphabet (no I/L/O/0/1 — see src/auth/codes.ts in drophere-server).
// Using A–Z + 2–9 as a superset keeps the regex readable; the server is the
// source of truth and will reject anything outside its actual charset.
const CODE_CHARSET = "A-Z2-9";
const CODE_REGEX = new RegExp(`^[${CODE_CHARSET}]{4}-[${CODE_CHARSET}]{4}$`);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function log(msg) { process.stderr.write(`[drophere] ${msg}\n`); }
function err(msg) { process.stderr.write(`[drophere] ERROR: ${msg}\n`); }

function usage() {
  process.stderr.write(`Usage: node auth.mjs <subcommand> [args...]

Subcommands:
  login <email>              Request a magic-link code (emailed to <email>)
  verify <email> <code>      Exchange the code for a persistent API key

Options:
  --base-url URL             Override API base URL (default: https://drophere.cc)
  --help                     Show this help

Examples:
  node auth.mjs login you@example.com
  node auth.mjs verify you@example.com ABCD-EFGH
  # → prints a 64-char hex API key on stdout (e.g. a1b2c3d4e5f6...)

After a successful verify, save the key as DROPHERE_API_KEY (env var or
~/.drophere/credentials) so publish.mjs picks it up on the next run.
`);
  process.exit(1);
}

function apiRequest(method, url, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const headers = {
      "x-drophere-client": CLIENT_HEADER,
      "Content-Type": "application/json",
    };

    const jsonBody = body !== undefined ? JSON.stringify(body) : undefined;
    if (jsonBody !== undefined) headers["Content-Length"] = Buffer.byteLength(jsonBody);

    const reqFn = parsed.protocol === "https:" ? httpsRequest : httpRequest;
    const req = reqFn(parsed, {
      method,
      headers,
      autoSelectFamily: true,
      autoSelectFamilyAttemptTimeout: 1000,
    }, (res) => {
      res.setEncoding("utf8");
      let text = "";
      res.on("data", (chunk) => text += chunk);
      res.on("end", () => {
        let parsedBody;
        try {
          parsedBody = text ? JSON.parse(text) : {};
        } catch {
          reject(new Error(`${method} ${parsed.pathname} returned invalid JSON: ${text}`));
          return;
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const detail = parsedBody?.error || parsedBody?.message || text;
          reject(new Error(`${method} ${parsed.pathname} returned HTTP ${res.statusCode}: ${detail}`));
          return;
        }
        resolve(parsedBody);
      });
    });

    req.on("error", (e) => {
      reject(new Error(`${method} ${parsed.pathname} failed: ${e.message || String(e)}`));
    });

    // Guard against hung connections: a dead drophere server shouldn't hang
    // the host agent indefinitely. destroy() triggers the "error" handler above.
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error(`request timed out after ${REQUEST_TIMEOUT_MS}ms`));
    });

    if (jsonBody !== undefined) req.write(jsonBody);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Parse arguments
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--base-url": API_BASE = argv[++i]; break;
      case "--help": case "-h": usage(); break;
      default:
        if (arg.startsWith("-")) { err(`Unknown option: ${arg}`); usage(); }
        positional.push(arg);
    }
  }
  return positional;
}

function validateEmail(email) {
  if (!email || typeof email !== "string" || !/^\S+@\S+\.\S+$/.test(email)) {
    err(`Invalid email: ${email || "(missing)"}`);
    usage();
  }
}

// ---------------------------------------------------------------------------
// Subcommands
// ---------------------------------------------------------------------------

async function cmdLogin(email) {
  validateEmail(email);
  log(`Requesting magic-link code for ${email}...`);
  const res = await apiRequest("POST", `${API_BASE}/api/auth/agent/request-code`, { email });
  log(`Code sent. Expires at ${res.expiresAt || "unknown"}. Check your inbox.`);
  // Print the raw server response so the host agent can relay it if useful.
  process.stdout.write(`${JSON.stringify(res)}\n`);
}

async function cmdVerify(email, code) {
  validateEmail(email);
  // Normalize the same way the server does (src/auth/codes.ts verifyAuthCode:
  // `code.trim().toUpperCase()`), so a user pasting `abcd-efgh` works.
  const normalizedCode = typeof code === "string" ? code.trim().toUpperCase() : "";
  if (!normalizedCode || !CODE_REGEX.test(normalizedCode)) {
    err(`Invalid code: ${code || "(missing)"} (expected XXXX-XXXX format, e.g. ABCD-EFGH)`);
    usage();
  }
  log(`Verifying code for ${email}...`);
  const res = await apiRequest("POST", `${API_BASE}/api/auth/agent/verify-code`, { email, code: normalizedCode });
  if (!res.apiKey || typeof res.apiKey !== "string") {
    err(`Server did not return an apiKey. Response: ${JSON.stringify(res)}`);
    process.exit(1);
  }
  log("Success. API key retrieved. Store it as DROPHERE_API_KEY.");
  // Bare token on stdout so the host agent can capture it directly.
  process.stdout.write(`${res.apiKey}\n`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const positional = parseArgs(process.argv.slice(2));
  const [sub, ...rest] = positional;

  if (!sub) usage();

  try {
    switch (sub) {
      case "login":
        await cmdLogin(rest[0]);
        break;
      case "verify":
        await cmdVerify(rest[0], rest[1]);
        break;
      default:
        err(`Unknown subcommand: ${sub}`);
        usage();
    }
  } catch (e) {
    err(e.message || String(e));
    process.exit(1);
  }
}

// Run when invoked as a script (`node auth.mjs ...`), skip when imported
// from tests. We compare the script's URL against argv[1] after converting
// the latter to a file:// URL so paths with spaces / special chars match.
const invokedAsScript = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedAsScript) {
  main();
}

// Exported for unit tests — keep the surface minimal.
export { CODE_REGEX };
