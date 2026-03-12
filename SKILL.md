---
name: drophere
description: Publish static files to drophere.cc — instant hosting with a URL
---

# drophere.cc — Publish Static Files

Publish any static files (HTML, images, PDFs, etc.) to the web instantly. Files are hosted at `https://<slug>.drophere.cc/`.

## Quick Start

```bash
# Publish a directory (anonymous, 24h TTL, no auth needed)
node ~/.claude/skills/drophere/scripts/publish.mjs ./dist/

# Publish specific files
node ~/.claude/skills/drophere/scripts/publish.mjs index.html style.css

# Update an existing artifact
node ~/.claude/skills/drophere/scripts/publish.mjs --slug abc123 ./dist/
```

The script outputs the site URL to stdout. All progress goes to stderr.

## Authentication

**Anonymous (default):** No auth needed. Artifacts expire in 24 hours. A `claimToken` is saved locally in `.drophere/state.json` for updates.

**Authenticated:** Artifacts persist indefinitely. Three ways to authenticate (checked in order):

1. **Flag:** `--api-key dp_abc123...`
2. **Environment variable:** `export DROPHERE_API_KEY=dp_abc123...`
3. **Credentials file:** `~/.drophere/credentials` containing `API_KEY=dp_abc123...`

### Getting an API Key

Request a magic-link code, then verify it:

```bash
# 1. Request code (sent to your email)
curl -X POST https://drophere.cc/api/auth/agent/request-code \
  -H "Content-Type: application/json" \
  -d '{"email": "you@example.com"}'

# 2. Verify code and get API key
curl -X POST https://drophere.cc/api/auth/agent/verify-code \
  -H "Content-Type: application/json" \
  -d '{"email": "you@example.com", "code": "123456"}'
# Returns: {"apiKey": "dp_abc123...", ...}

# 3. Save it
mkdir -p ~/.drophere
echo "API_KEY=dp_abc123..." > ~/.drophere/credentials
```

## Publish Script Options

```
node publish.mjs [OPTIONS] <directory | file...>

Options:
  --slug SLUG         Update existing artifact instead of creating new
  --api-key KEY       API key for authenticated uploads
  --title TITLE       Set viewer title (for auto-viewer pages)
  --description DESC  Set viewer description
  --ttl SECONDS       Set expiry in seconds (authenticated only)
  --base-url URL      Override API base URL (default: https://drophere.cc)
```

## How It Works

1. **Scan** — Hashes all files with SHA-256
2. **Create/Update** — Sends file manifest to the API, receives presigned upload URLs
3. **Upload** — PUTs each file to its presigned R2 URL (skips unchanged files)
4. **Finalize** — Marks the version as live

State is saved to `.drophere/state.json` in the working directory. Re-running `publish.mjs` in the same directory automatically does an incremental deploy (only uploads changed files).

## Common Patterns

### Publish a generated site
```bash
# Build then publish
npm run build
URL=$(node ~/.claude/skills/drophere/scripts/publish.mjs ./dist/)
echo "Live at: $URL"
```

### Publish a single HTML file
```bash
node ~/.claude/skills/drophere/scripts/publish.mjs index.html
```

### Share an image or PDF
```bash
node ~/.claude/skills/drophere/scripts/publish.mjs screenshot.png
# Auto-viewer renders a rich preview, no index.html needed
```

### Incremental deploy (update in place)
```bash
# First publish — creates artifact, saves state
node ~/.claude/skills/drophere/scripts/publish.mjs ./site/

# Later — only uploads changed files
node ~/.claude/skills/drophere/scripts/publish.mjs ./site/
```

## Upload Size Limits

|  | Per file | Per artifact (total) |
|--|---------|---------------------|
| Anonymous | 10 MB | 25 MB |
| Authenticated | 50 MB | 200 MB |

Exceeding a limit returns HTTP 413. The `size` field in each file manifest entry must be exact bytes.

## Dependencies

- Node.js 18+ (uses built-in `crypto`, `fs`, `path`, `http`, `https` — no external packages)

Works on macOS, Linux, and Windows.

## API Reference

See `~/.claude/skills/drophere/references/API.md` for the complete API documentation covering all endpoints: artifacts, handles, links, domains, and authentication.
