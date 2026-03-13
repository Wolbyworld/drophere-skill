---
name: drophere
description: >
  This skill should be used when the user asks to "publish files",
  "deploy to a URL", "host a static site", "share an HTML file publicly",
  "upload to drophere", or needs to make local files accessible via a public URL.
---

# drophere.cc — Publish Static Files

Publish any static files (HTML, images, PDFs, etc.) to the web instantly. Files are hosted at `https://<slug>.drophere.cc/`.

## Setup

Set the publish script path. If `CLAUDE_PLUGIN_ROOT` is set (Cowork/plugin install), files are already in place. Otherwise, download them:

```bash
DROPHERE_DIR="${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/skills/drophere}"

if [ ! -f "$DROPHERE_DIR/skills/drophere/scripts/publish.mjs" ] && [ ! -f "$DROPHERE_DIR/scripts/publish.mjs" ]; then
  mkdir -p ~/.claude/skills/drophere/scripts ~/.claude/skills/drophere/references
  curl -fsSL https://raw.githubusercontent.com/Wolbyworld/drophere-skill/main/skills/drophere/scripts/publish.mjs -o ~/.claude/skills/drophere/scripts/publish.mjs
  curl -fsSL https://raw.githubusercontent.com/Wolbyworld/drophere-skill/main/skills/drophere/scripts/publish.sh -o ~/.claude/skills/drophere/scripts/publish.sh
  curl -fsSL https://raw.githubusercontent.com/Wolbyworld/drophere-skill/main/skills/drophere/references/API.md -o ~/.claude/skills/drophere/references/API.md
  chmod +x ~/.claude/skills/drophere/scripts/publish.sh
  DROPHERE_DIR="$HOME/.claude/skills/drophere"
fi
```

For all commands below, use `PUBLISH` as shorthand:

```bash
PUBLISH="${CLAUDE_PLUGIN_ROOT:+${CLAUDE_PLUGIN_ROOT}/skills/drophere/scripts/publish.mjs}"
PUBLISH="${PUBLISH:-$HOME/.claude/skills/drophere/scripts/publish.mjs}"
```

## Quick Start

```bash
# Publish a directory (anonymous, 24h TTL, no auth needed)
node "$PUBLISH" ./dist/

# Publish specific files
node "$PUBLISH" index.html style.css

# Update an existing artifact
node "$PUBLISH" --slug abc123 ./dist/
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
URL=$(node "$PUBLISH" ./dist/)
echo "Live at: $URL"
```

### Publish a single HTML file
```bash
node "$PUBLISH" index.html
```

### Share an image or PDF
```bash
node "$PUBLISH" screenshot.png
# Auto-viewer renders a rich preview, no index.html needed
```

### Incremental deploy (update in place)
```bash
# First publish — creates artifact, saves state
node "$PUBLISH" ./site/

# Later — only uploads changed files
node "$PUBLISH" ./site/
```

## Upload Size Limits

|  | Per file | Per artifact (total) |
|--|---------|---------------------|
| Anonymous | 10 MB | 25 MB |
| Authenticated | 50 MB | 200 MB |

Exceeding a limit returns HTTP 413. The `size` field in each file manifest entry must be exact bytes.

## Feedback

If the user has feedback about drophere (bug, feature request, or anything else), send it:

```bash
curl -X POST https://drophere.cc/api/v1/feedback \
  -H "Content-Type: application/json" \
  -d '{"message": "your feedback here", "slug": "optional-artifact-slug", "source": "skill"}'
```

No authentication needed. Always set `"source": "skill"` so the team knows it came from an agent.

## Dependencies

- Node.js 18+ (uses built-in `crypto`, `fs`, `path`, `http`, `https` — no external packages)

Works on macOS, Linux, and Windows.

## API Reference

See `~/.claude/skills/drophere/references/API.md` (direct install) or `${CLAUDE_PLUGIN_ROOT}/skills/drophere/references/API.md` (Cowork plugin) for the complete API documentation covering all endpoints: artifacts, handles, links, domains, and authentication.
