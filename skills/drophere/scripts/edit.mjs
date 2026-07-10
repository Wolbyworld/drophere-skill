#!/usr/bin/env node
// drophere.cc edit-grant helper — reads bounded source context, applies exact
// text replacements, and finalizes pending artifact versions.
//
// Dependencies: Node.js 18+ (uses built-in http and https)
// Authentication: DROPHERE_EDIT_TOKEN only
// Artifact: --slug or DROPHERE_ARTIFACT_SLUG
// API base: DROPHERE_BASE_URL (default: https://drophere.cc)

import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { readFile } from "node:fs/promises";

const DEFAULT_API_BASE = "https://drophere.cc";
const CLIENT_HEADER = "drophere/edit-mjs";
const REQUEST_TIMEOUT_MS = 30_000;

function err(message) {
  process.stderr.write(`[drophere] ERROR: ${message}\n`);
}

function usage(message) {
  if (message) err(message);
  process.stderr.write(`Usage: node edit.mjs <command> [options]

Commands:
  context [--manifest]
  comments [--status open|resolved|all] [--limit N --cursor TOKEN --message-limit N]
  search --query TEXT [--path PATH]
  read --path PATH [--start-line N --end-line N]
  replace --base-version-id ID --path PATH --expected TEXT --replacement TEXT [--summary TEXT]
  apply --base-version-id ID --operations-file PATH [--summary TEXT]
  finalize --version-id ID

Common options:
  --slug SLUG   Artifact slug (or set DROPHERE_ARTIFACT_SLUG)
  --help        Show this help

Environment:
  DROPHERE_EDIT_TOKEN     Required edit-grant token
  DROPHERE_ARTIFACT_SLUG  Artifact slug when --slug is omitted
  DROPHERE_BASE_URL       API base URL (default: https://drophere.cc)
`);
  process.exit(message ? 1 : 0);
}

function takeValue(argv, index, option) {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    usage(`${option} requires a value`);
  }
  return value;
}

function parseArgs(argv) {
  const command = argv[0];
  if (!command || command === "--help" || command === "-h") usage();

  const args = {
    command,
    slug: "",
    manifest: false,
    status: "",
    limit: undefined,
    cursor: "",
    messageLimit: undefined,
    query: "",
    path: "",
    startLine: undefined,
    endLine: undefined,
    expected: undefined,
    replacement: undefined,
    summary: "",
    baseVersionId: "",
    operationsFile: "",
    versionId: "",
  };

  for (let i = 1; i < argv.length; i++) {
    const option = argv[i];
    switch (option) {
      case "--slug":
        args.slug = takeValue(argv, i, option);
        i++;
        break;
      case "--manifest":
        args.manifest = true;
        break;
      case "--status":
        args.status = takeValue(argv, i, option);
        i++;
        break;
      case "--limit":
        args.limit = takeValue(argv, i, option);
        i++;
        break;
      case "--cursor":
        args.cursor = takeValue(argv, i, option);
        i++;
        break;
      case "--message-limit":
        args.messageLimit = takeValue(argv, i, option);
        i++;
        break;
      case "--query":
        args.query = takeValue(argv, i, option);
        i++;
        break;
      case "--path":
        args.path = takeValue(argv, i, option);
        i++;
        break;
      case "--start-line":
        args.startLine = takeValue(argv, i, option);
        i++;
        break;
      case "--end-line":
        args.endLine = takeValue(argv, i, option);
        i++;
        break;
      case "--expected":
        args.expected = takeValue(argv, i, option);
        i++;
        break;
      case "--replacement":
        args.replacement = takeValue(argv, i, option);
        i++;
        break;
      case "--summary":
        args.summary = takeValue(argv, i, option);
        i++;
        break;
      case "--base-version-id":
        args.baseVersionId = takeValue(argv, i, option);
        i++;
        break;
      case "--operations-file":
        args.operationsFile = takeValue(argv, i, option);
        i++;
        break;
      case "--version-id":
        args.versionId = takeValue(argv, i, option);
        i++;
        break;
      case "--help":
      case "-h":
        usage();
        break;
      default:
        usage(option.startsWith("-") ? `Unknown option: ${option}` : `Unexpected argument: ${option}`);
    }
  }

  return args;
}

function requireOption(value, option) {
  if (value === undefined || value === "") usage(`${option} is required`);
}

function positiveLine(value, option) {
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value) || Number(value) < 1) usage(`${option} must be a positive integer`);
  return Number(value);
}

function validateArgs(args) {
  const allowed = new Set(["context", "comments", "search", "read", "replace", "apply", "finalize"]);
  if (!allowed.has(args.command)) usage(`Unknown command: ${args.command}`);

  if (args.command !== "context" && args.manifest) usage("--manifest is only valid with context");
  if (args.command !== "comments" && args.status) usage("--status is only valid with comments");
  if (args.command !== "comments" && (args.limit !== undefined || args.cursor || args.messageLimit !== undefined)) usage("--limit, --cursor, and --message-limit are only valid with comments");
  if (args.command !== "search" && args.query) usage("--query is only valid with search");
  if (!["search", "read", "replace"].includes(args.command) && args.path) usage(`--path is not valid with ${args.command}`);
  if (args.command !== "read" && (args.startLine !== undefined || args.endLine !== undefined)) {
    usage("--start-line and --end-line are only valid with read");
  }
  if (args.command !== "replace" && (args.expected !== undefined || args.replacement !== undefined)) {
    usage("--expected and --replacement are only valid with replace");
  }
  if (!["replace", "apply"].includes(args.command) && args.summary) usage(`--summary is not valid with ${args.command}`);
  if (!["replace", "apply"].includes(args.command) && args.baseVersionId) usage(`--base-version-id is not valid with ${args.command}`);
  if (args.command !== "apply" && args.operationsFile) usage(`--operations-file is not valid with ${args.command}`);
  if (args.command !== "finalize" && args.versionId) usage("--version-id is only valid with finalize");

  if (args.command === "comments" && args.status && !["open", "resolved", "all"].includes(args.status)) {
    usage("--status must be open, resolved, or all");
  }
  if (args.command === "comments") {
    if (args.limit !== undefined && (!/^\d+$/.test(args.limit) || Number(args.limit) < 1 || Number(args.limit) > 100)) {
      usage("--limit must be an integer from 1 to 100");
    }
    if (args.messageLimit !== undefined && (!/^\d+$/.test(args.messageLimit) || Number(args.messageLimit) < 1 || Number(args.messageLimit) > 100)) {
      usage("--message-limit must be an integer from 1 to 100");
    }
  }
  if (args.command === "search") requireOption(args.query, "--query");
  if (["read", "replace"].includes(args.command)) requireOption(args.path, "--path");
  if (args.command === "replace") {
    requireOption(args.baseVersionId, "--base-version-id");
    requireOption(args.expected, "--expected");
    if (args.replacement === undefined) usage("--replacement is required");
  }
  if (args.command === "apply") {
    requireOption(args.baseVersionId, "--base-version-id");
    requireOption(args.operationsFile, "--operations-file");
  }
  if (args.command === "finalize") requireOption(args.versionId, "--version-id");

  args.startLine = positiveLine(args.startLine, "--start-line");
  args.endLine = positiveLine(args.endLine, "--end-line");
  if ((args.startLine === undefined) !== (args.endLine === undefined)) {
    usage("--start-line and --end-line must be provided together");
  }
  if (args.startLine !== undefined && args.endLine !== undefined && args.startLine > args.endLine) {
    usage("--start-line cannot be greater than --end-line");
  }
}

function apiBaseFromEnv() {
  const raw = process.env.DROPHERE_BASE_URL || DEFAULT_API_BASE;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("DROPHERE_BASE_URL must be a valid URL");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("DROPHERE_BASE_URL must use http or https");
  }
  const loopback = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "::1";
  if (parsed.protocol !== "https:" && !loopback) {
    throw new Error("DROPHERE_BASE_URL must use https except for loopback development");
  }
  return parsed.origin;
}

function redact(value, token) {
  if (!token) return value;
  if (typeof value === "string") return value.split(token).join("[REDACTED]");
  if (Array.isArray(value)) return value.map((item) => redact(item, token));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redact(item, token)]));
  }
  return value;
}

function apiRequest(apiBase, token, method, pathname, { query, body } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(pathname, `${apiBase}/`);
    for (const [key, value] of Object.entries(query || {})) {
      if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
    }

    const headers = {
      Accept: "application/json",
      "x-drophere-client": CLIENT_HEADER,
      "X-Drophere-Edit-Token": token,
    };
    const jsonBody = body === undefined ? undefined : JSON.stringify(body);
    if (jsonBody !== undefined) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = Buffer.byteLength(jsonBody);
    }

    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, {
      method,
      headers,
      autoSelectFamily: true,
      autoSelectFamilyAttemptTimeout: 1000,
    }, (response) => {
      response.setEncoding("utf8");
      let text = "";
      response.on("data", (chunk) => { text += chunk; });
      response.on("end", () => {
        let parsed;
        try {
          parsed = text ? JSON.parse(text) : {};
        } catch {
          reject(new Error(`${method} ${url.pathname} returned invalid JSON`));
          return;
        }
        if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
          const detail = parsed?.error || parsed?.message || `HTTP ${response.statusCode || 0}`;
          reject(new Error(`${method} ${url.pathname} returned HTTP ${response.statusCode || 0}: ${redact(String(detail), token)}`));
          return;
        }
        resolve(parsed);
      });
    });

    request.on("error", (error) => {
      reject(new Error(`${method} ${url.pathname} failed: ${redact(error.message || String(error), token)}`));
    });
    request.setTimeout(REQUEST_TIMEOUT_MS, () => {
      request.destroy(new Error(`request timed out after ${REQUEST_TIMEOUT_MS}ms`));
    });
    if (jsonBody !== undefined) request.write(jsonBody);
    request.end();
  });
}

function encodeSourcePath(path) {
  if (path.startsWith("/") || path.split("/").some((part) => part === "" || part === "." || part === "..")) {
    usage("--path must be a relative artifact path without empty, . or .. segments");
  }
  return path.split("/").map(encodeURIComponent).join("/");
}

function printResult(result, token) {
  process.stdout.write(`${JSON.stringify(redact(result, token))}\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  validateArgs(args);

  const token = process.env.DROPHERE_EDIT_TOKEN || "";
  if (!token) throw new Error("DROPHERE_EDIT_TOKEN is required");
  const slug = args.slug || process.env.DROPHERE_ARTIFACT_SLUG || "";
  if (!slug) throw new Error("--slug or DROPHERE_ARTIFACT_SLUG is required");

  const apiBase = apiBaseFromEnv();
  const artifactPath = `/api/v1/artifact/${encodeURIComponent(slug)}`;
  const request = (method, suffix, options) => apiRequest(apiBase, token, method, `${artifactPath}${suffix}`, options);
  let result;

  switch (args.command) {
    case "context":
      result = await request("GET", "/edit-context", {
        query: args.manifest ? { include: "manifest" } : undefined,
      });
      break;
    case "comments":
      result = await request("GET", "/comments", { query: {
        status: args.status,
        limit: args.limit,
        cursor: args.cursor,
        messageLimit: args.messageLimit,
      } });
      break;
    case "search":
      result = await request("GET", "/source-search", { query: { query: args.query, path: args.path } });
      break;
    case "read":
      result = await request("GET", `/source/${encodeSourcePath(args.path)}`, {
        query: args.startLine === undefined
          ? { format: "json" }
          : { startLine: args.startLine, endLine: args.endLine },
      });
      break;
    case "replace": {
      const body = {
        baseVersionId: args.baseVersionId,
        operations: [{
          op: "replace_text",
          path: args.path,
          expected: args.expected,
          replacement: args.replacement,
          requireMatches: 1,
        }],
      };
      if (args.summary) body.summary = args.summary;
      result = await request("POST", "/edits", { body });
      break;
    }
    case "apply": {
      let parsed;
      try {
        parsed = JSON.parse(await readFile(args.operationsFile, "utf8"));
      } catch (error) {
        throw new Error(`Could not read operations file: ${error.message || String(error)}`);
      }
      const operations = Array.isArray(parsed) ? parsed : parsed?.operations;
      if (!Array.isArray(operations)) throw new Error("Operations file must contain an array or an object with operations[]");
      const body = { baseVersionId: args.baseVersionId, operations };
      if (args.summary) body.summary = args.summary;
      result = await request("POST", "/edits", { body });
      break;
    }
    case "finalize":
      result = await request("POST", "/finalize", { body: { versionId: args.versionId } });
      break;
  }

  printResult(result, token);
}

main().catch((error) => {
  const token = process.env.DROPHERE_EDIT_TOKEN || "";
  err(redact(error.message || String(error), token));
  process.exit(1);
});
