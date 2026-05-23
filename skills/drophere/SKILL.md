---
name: drophere
description: >
  This skill should be used when the user asks to "publish files",
  "deploy to a URL", "host a static site", "share an HTML file publicly",
  "upload to drophere", "protect a page", "restrict access",
  "add email access control", "make page private", "share privately",
  "enable comments", "add anchored comments", "review this artifact",
  "collaborate on a drophere artifact", "make this artifact commentable",
  or needs to make local files accessible via a public URL.
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
  curl -fsSL https://raw.githubusercontent.com/Wolbyworld/drophere-skill/main/skills/drophere/scripts/auth.mjs -o ~/.claude/skills/drophere/scripts/auth.mjs
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

## MCP Publishing

Use MCP tools first when they are available. For small static/text artifacts, prefer `drophere_publish_artifact`: pass file content strings with `path`, `contentText` or `content`, and `contentType`; the tool computes byte sizes internally. `drophere_create_static_site` is the compatibility alias for the same one-shot flow. A successful response with `shareable: true` can be returned to the user immediately.

Use `drophere_create_artifact` or `drophere_update_artifact` when you need large files, binary files, or incremental deploy control. Their responses separate `mcpUploads` (call `drophere_upload_file` with `contentText` for text or `contentBase64` for bytes) from `directHttpUploads` (raw HTTP `PUT` fallback), and include `shareable`, `siteUrlStatus`, `operationState`, `nextRecommendedAction`, `nextActions`, and cleanup hints for pending versions.

Use `drophere_get_artifact` to inspect `pendingVersion.readyToFinalize` and per-file upload status. Use `drophere_list_files` and `drophere_get_file` after publishing to verify the deployed files. Publish uploaded pending versions with `drophere_publish_uploaded_version`; `drophere_finalize_artifact` remains available as the compatibility name.

Viewer metadata is optional. Defaults are `spaMode=false`, `markdownDownload=false`, no `ogImagePath`, and no title/description.

For a bad pending version, update with corrected files or discard the pending version instead of deleting the whole artifact unless the user wants it removed.

## Access Control

Restrict who can view a published artifact by email or email domain. Visitors must verify their email via a one-time code before viewing protected content.

### Protect an artifact (requires authentication)

```bash
# Restrict to specific emails
curl -X PATCH "https://drophere.cc/api/v1/artifact/${SLUG}/access" \
  -H "Authorization: Bearer $DROPHERE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"visibility":"restricted","allowedEmails":["alice@acme.com","bob@acme.com"]}'

# Restrict to an email domain (everyone @acme.com)
curl -X PATCH "https://drophere.cc/api/v1/artifact/${SLUG}/access" \
  -H "Authorization: Bearer $DROPHERE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"visibility":"restricted","allowedDomains":["acme.com"]}'

# Combine emails and domains
curl -X PATCH "https://drophere.cc/api/v1/artifact/${SLUG}/access" \
  -H "Authorization: Bearer $DROPHERE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"visibility":"restricted","allowedEmails":["guest@example.com"],"allowedDomains":["acme.com"]}'

# Make public again
curl -X PATCH "https://drophere.cc/api/v1/artifact/${SLUG}/access" \
  -H "Authorization: Bearer $DROPHERE_API_KEY" \
  -d '{"visibility":"public"}'
```

### Check current access settings

```bash
curl "https://drophere.cc/api/v1/artifact/${SLUG}/access" \
  -H "Authorization: Bearer $DROPHERE_API_KEY"
```

### Discover latest capabilities

Fetch the current API capabilities from the server (useful for discovering new features):

```bash
curl -s "https://drophere.cc/api/v1/skill/docs"
```

### Notes

- Consumer email domains (gmail.com, outlook.com, etc.) are blocked in `allowedDomains` to prevent accidental broad access. Use `allowedEmails` for individual accounts.
- Access control works on `*.drophere.cc` subdomains. Custom domains stay public for now.
- Agents with a valid API key whose email is in the allowlist can access restricted pages directly via Bearer token.
- The artifact owner always has access to their own restricted artifacts.

### When to ask about access control

If the user's content appears internal, sensitive, or intended for a specific audience (e.g., "for the team", "client review", "internal dashboard", company data), ask whether to restrict access before publishing:

> "Should I restrict access to this? I can limit viewing to specific emails or an email domain (e.g., everyone @acme.com)."

## Collaboration Comments

Drophere artifacts can expose an isolated reader-style collaboration layer for anchored comments, replies, pasted image attachments, and owner/agent moderation. This can be enabled on existing artifacts without republishing because the layer is injected at serve time.

Use MCP tools first when they are available:

- `drophere_set_collaboration` — enable/disable the layer and set the comment policy
- `drophere_list_comments` — list threads and current settings
- `drophere_add_comment` — create an anchored thread
- `drophere_update_comment` — reply, resolve, or reopen
- `drophere_delete_comment` — soft-delete a thread or message

Enable collaboration with the default authenticated-comment policy:

```json
{
  "slug": "abc123",
  "enabled": true,
  "commentPolicy": "authenticated"
}
```

Policy choices:

- `authenticated` — any logged-in Drophere user can comment
- `anyone` — anyone who can view the artifact can comment
- `same_domain` — only verified users from the owner domain or explicit `commentDomain` can comment; consumer domains such as `gmail.com` are rejected
- `specific_accounts` — only the listed Drophere account emails in `commentAllowedEmails` can comment

REST fallback when MCP tools are unavailable:

```bash
curl -X PATCH "https://drophere.cc/api/v1/artifact/${SLUG}/collaboration" \
  -H "Authorization: Bearer $DROPHERE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"enabled":true,"commentPolicy":"authenticated"}'
```

When changing both view access and comment permissions from an owner/admin surface, prefer the atomic `PATCH /api/v1/artifact/${SLUG}/permissions` endpoint and use its readback as the source of truth.

For private/client review pages, keep artifact visibility/password/email gates as the outer view gate and choose the least-broad comment policy that fits the audience.

## Authentication

**Anonymous (default):** No auth needed. Artifacts expire in 24 hours. A `claimToken` is saved locally in `.drophere/state.json` for updates.

**Authenticated:** Artifacts persist indefinitely. API keys are 64-character hex strings with no prefix (e.g. `a1b2c3d4e5f6...`). Three ways to authenticate (checked in order):

1. **Flag:** `--api-key a1b2c3d4e5f6...`
2. **Environment variable:** `export DROPHERE_API_KEY=a1b2c3d4e5f6...`
3. **Credentials file:** `~/.drophere/credentials` containing `API_KEY=a1b2c3d4e5f6...`

### Getting an API Key

**If you are an AI agent running this skill and `DROPHERE_API_KEY` is not set, or you hit a 401 / unauthenticated error from `publish.mjs` or any authenticated endpoint, run the auth flow *first* before trying again.** The dedicated auth script handles both halves of the magic-link exchange:

```bash
AUTH="${CLAUDE_PLUGIN_ROOT:+${CLAUDE_PLUGIN_ROOT}/skills/drophere/scripts/auth.mjs}"
AUTH="${AUTH:-$HOME/.claude/skills/drophere/scripts/auth.mjs}"

# 1. Request a magic-link code (sent to the user's email)
node "$AUTH" login you@example.com
# stderr: "Code sent. Expires at ..."
# stdout: {"success":true,"requiresCodeEntry":true,"expiresAt":"..."}

# 2. Ask the user for the XXXX-XXXX code they received (8 alphanumerics plus
#    a dash, e.g. ABCD-EFGH; case-insensitive), then exchange it:
node "$AUTH" verify you@example.com ABCD-EFGH
# stderr: "Success. API key retrieved. Store it as DROPHERE_API_KEY."
# stdout: a1b2c3d4e5f6...   ← bare 64-char hex token, one line, ready to capture

# 3. Host agents (e.g. LuziaClaw) should save this as the per-user secret
#    DROPHERE_API_KEY. publish.mjs reads it from process.env.DROPHERE_API_KEY.
#    For local CLI use, persist it to ~/.drophere/credentials:
mkdir -p ~/.drophere
echo "API_KEY=a1b2c3d4e5f6..." > ~/.drophere/credentials
```

The `auth.mjs` script prints progress on stderr and the final payload on stdout, so `$(node "$AUTH" verify ... | tr -d '\n')` captures the API key cleanly. Exit code is 0 on success, 1 on any error (bad email, expired code, network failure, etc.).

Raw curl equivalents (if you need to bypass the script for debugging):

```bash
curl -X POST https://drophere.cc/api/auth/agent/request-code \
  -H "Content-Type: application/json" \
  -d '{"email": "you@example.com"}'

curl -X POST https://drophere.cc/api/auth/agent/verify-code \
  -H "Content-Type: application/json" \
  -d '{"email": "you@example.com", "code": "ABCD-EFGH"}'
# Returns: {"apiKey": "a1b2c3d4e5f6...", ...}   (64-char hex, no prefix)
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
2. **Create/Update** — Sends file manifest to the API, receives upload URLs
3. **Upload** — PUTs each file to its upload URL (skips unchanged files)
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

## Key-Value Store

Every artifact includes a built-in key-value store for lightweight data persistence
(leaderboards, counters, preferences). No setup needed — it's always available.

### Usage (from hosted app's client-side JS)
```javascript
// Write a value
fetch('/_api/store/leaderboard', {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify([{ name: 'Alice', score: 100 }])
});

// Read a value
const res = await fetch('/_api/store/leaderboard');
const { value } = await res.json();

// List all keys
const list = await fetch('/_api/store');
const { keys } = await list.json();

// Delete a value
fetch('/_api/store/leaderboard', { method: 'DELETE' });
```

### Limits
- Max value size: 100KB
- Key pattern: alphanumeric, dots, hyphens, underscores, colons, slashes (max 512 chars)
- Rate: 300 reads/min, 30 writes/min per IP per artifact
- Consistency: eventual (KV) — concurrent writes are last-writer-wins

## Visit Counter

Drop a counter into any hosted site. The script fills `[data-drophere-visits=METRIC]` elements with the raw number from a same-origin endpoint — no formatting applied, so you can wrap and style however you want.

```html
<p>Visits: <span data-drophere-visits="total">—</span></p>
<p>Today: <span data-drophere-visits="today">—</span></p>
<script src="https://drophere.cc/c/visits.js" defer></script>
```

Available metrics: `total` (lifetime), `today`, `last7d`, `unique7d` (approximate — visitor hash rotates daily for privacy). Raw JSON also at `/_drophere/visits` on the artifact's host, or `GET /api/v1/artifact/:slug/visits` (auth required) for owner dashboards.

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

Full developer documentation: https://docs.drophere.cc

Agent-readable Markdown reference: https://drophere.cc/skill/references/API.md

Installed local copy:
- Direct install: `~/.claude/skills/drophere/references/API.md`
- Cowork plugin: `${CLAUDE_PLUGIN_ROOT}/skills/drophere/references/API.md`

For a compact capability index before loading the full reference, fetch:

```bash
curl -s https://drophere.cc/api/v1/skill/docs
```
