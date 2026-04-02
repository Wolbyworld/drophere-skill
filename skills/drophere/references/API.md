# drophere.cc API Reference

Base URL: `https://drophere.cc`

All requests should include `Content-Type: application/json` for JSON bodies.
Authenticated endpoints require `Authorization: Bearer <api_key>`.

---

## Authentication

### Request Code

Send a magic-link verification code to an email address.

```
POST /api/auth/agent/request-code
```

**Body:**
```json
{ "email": "user@example.com" }
```

**Response (200):**
```json
{
  "success": true,
  "requiresCodeEntry": true,
  "expiresAt": "2026-03-11T12:15:00.000Z"
}
```

Codes expire after 15 minutes. If a valid code already exists (created within the last 10 minutes), no new email is sent.

### Verify Code

Exchange the email code for a persistent API key.

```
POST /api/auth/agent/verify-code
```

**Body:**
```json
{ "email": "user@example.com", "code": "123456" }
```

**Response (200):**
```json
{
  "success": true,
  "email": "user@example.com",
  "apiKey": "dp_abc123...",
  "isNewUser": false
}
```

The `apiKey` is permanent — store it securely and use it as a Bearer token for all authenticated endpoints.

**Errors:**
| Status | Error |
|--------|-------|
| 400 | Invalid email address |
| 401 | Invalid or expired code |

---

## Artifacts

### Create Artifact

Start a new artifact upload. Anonymous uploads (no auth) get a 24-hour TTL and a `claimToken`.

```
POST /api/v1/artifact
```

**Auth:** Optional (Bearer token)

**Body:**
```json
{
  "files": [
    { "path": "index.html", "size": 1024, "contentType": "text/html", "hash": "sha256:abc..." },
    { "path": "style.css", "size": 512, "contentType": "text/css", "hash": "sha256:def..." }
  ],
  "ttlSeconds": 3600,
  "viewer": {
    "title": "My Site",
    "description": "A demo page",
    "ogImagePath": "og.png"
  }
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `files` | `FileManifestEntry[]` | Yes | Non-empty array. Paths must not contain `..` |
| `files[].path` | `string` | Yes | Relative file path |
| `files[].size` | `number` | Yes | File size in bytes (>= 0) |
| `files[].contentType` | `string` | Yes | MIME type |
| `files[].hash` | `string` | No | SHA-256 hash for incremental deploys |
| `ttlSeconds` | `number` | No | Expiry for authenticated users. Anonymous always = 24h |
| `viewer` | `ViewerMetadata` | No | Title, description, OG image for auto-viewer |

**Response (201):**
```json
{
  "slug": "abc123",
  "versionId": "550e8400-e29b-41d4-a716-446655440000",
  "siteUrl": "https://abc123.drophere.cc/",
  "uploads": [
    {
      "path": "index.html",
      "method": "PUT",
      "url": "https://r2-presigned-url...",
      "headers": { "Content-Type": "text/html" }
    }
  ],
  "limits": { "maxFileSize": 104857600, "maxArtifactSize": 262144000 },
  "claimToken": "ct_xyz789..."
}
```

- `uploads` — presigned R2 URLs (10-min TTL). Upload each file with `PUT`.
- `claimToken` — only returned for anonymous uploads. Store it to update/finalize later.

**Upload size limits:**

|  | Per file | Per artifact (total) |
|--|---------|---------------------|
| Anonymous | 100 MB | 250 MB |
| Authenticated | 1 GB | 5 GB |

Exceeding a limit returns **413** with `error`, `details`, and `limits` fields. The `size` field in each file entry must be the exact byte count — presigned URLs are locked to that size.

Limits are also returned in the response body so clients can pre-validate:
```json
{ "limits": { "maxFileSize": 104857600, "maxArtifactSize": 262144000 } }
```

**Rate limits:**
- Authenticated: 60 creates per hour
- Anonymous: 5 creates per hour (per IP)

### Update Artifact (Incremental Deploy)

Update an existing artifact. Files with matching hashes are skipped (no re-upload needed).

```
PUT /api/v1/artifact/:slug
```

**Auth:** Optional (Bearer token OR `claimToken` in body for anonymous)

**Body:**
```json
{
  "files": [
    { "path": "index.html", "size": 2048, "contentType": "text/html", "hash": "sha256:new..." },
    { "path": "style.css", "size": 512, "contentType": "text/css", "hash": "sha256:def..." }
  ],
  "claimToken": "ct_xyz789..."
}
```

**Response (200):**
```json
{
  "slug": "abc123",
  "versionId": "660e8400-...",
  "siteUrl": "https://abc123.drophere.cc/",
  "uploads": [
    {
      "path": "index.html",
      "method": "PUT",
      "url": "https://r2-presigned-url...",
      "headers": { "Content-Type": "text/html" }
    }
  ],
  "skipped": [
    { "path": "style.css", "hash": "sha256:def..." }
  ],
  "limits": { "maxFileSize": 1073741824, "maxArtifactSize": 5368709120 }
}
```

- Only files in `uploads` need to be uploaded. Files in `skipped` matched by hash and will be copied server-side during finalize.

**Errors:**
| Status | Error |
|--------|-------|
| 403 | Invalid or missing claim token / You do not own this artifact |
| 404 | Artifact not found |
| 410 | Artifact has expired |
| 413 | File or total artifact size exceeds limit |

### Finalize Artifact

Mark an upload as complete. Copies skipped files server-side, activates the version.

```
POST /api/v1/artifact/:slug/finalize
```

**Auth:** Optional (Bearer token OR `claimToken` in body)

**Body:**
```json
{
  "versionId": "550e8400-e29b-41d4-a716-446655440000",
  "claimToken": "ct_xyz789..."
}
```

**Response (200):**
```json
{
  "slug": "abc123",
  "versionId": "550e8400-...",
  "siteUrl": "https://abc123.drophere.cc/"
}
```

**Errors:**
| Status | Error |
|--------|-------|
| 400 | versionId is required |
| 401 | Authentication required |
| 403 | Invalid or missing claim token / You do not own this artifact |
| 404 | Artifact not found / Version not found |
| 409 | versionId does not match pending version |

### Claim Artifact

Transfer an anonymous artifact to your authenticated account. Removes expiry and claim token.

```
POST /api/v1/artifact/:slug/claim
```

**Auth:** Required (Bearer token)

**Body:**
```json
{ "claimToken": "ct_xyz789..." }
```

**Response (200):**
```json
{
  "slug": "abc123",
  "siteUrl": "https://abc123.drophere.cc/",
  "message": "Artifact claimed successfully"
}
```

### Update Viewer Metadata

Update the title, description, or OG image for auto-viewer rendering. Has no effect if the artifact contains an `index.html`.

```
PATCH /api/v1/artifact/:slug/metadata
```

**Auth:** Required

**Body:**
```json
{
  "viewerMetadata": {
    "title": "Updated Title",
    "description": "New description",
    "ogImagePath": "preview.png"
  }
}
```

**Response (200):**
```json
{
  "slug": "abc123",
  "viewerMetadata": { "title": "Updated Title", "description": "New description" },
  "note": "Viewer metadata updated successfully."
}
```

### Get Artifact Details

```
GET /api/v1/artifact/:slug
```

**Auth:** Required

**Response (200):**
```json
{
  "slug": "abc123",
  "siteUrl": "https://abc123.drophere.cc/",
  "status": "active",
  "currentVersionId": "550e8400-...",
  "pendingVersionId": null,
  "viewerMetadata": null,
  "expiresAt": null,
  "createdAt": "2026-03-11T10:00:00.000Z",
  "updatedAt": "2026-03-11T10:01:00.000Z",
  "files": [
    { "path": "index.html", "size": 1024, "contentType": "text/html", "hash": "sha256:abc..." }
  ]
}
```

### List Artifacts

```
GET /api/v1/artifacts
```

**Auth:** Required

**Response (200):**
```json
{
  "artifacts": [
    {
      "slug": "abc123",
      "siteUrl": "https://abc123.drophere.cc/",
      "status": "active",
      "currentVersionId": "550e8400-...",
      "pendingVersionId": null,
      "expiresAt": null,
      "updatedAt": "2026-03-11T10:01:00.000Z"
    }
  ]
}
```

### Delete Artifact

```
DELETE /api/v1/artifact/:slug
```

**Auth:** Required

**Response (200):**
```json
{ "slug": "abc123", "message": "Artifact deleted" }
```

### Set or Remove Password

```
PATCH /api/v1/artifact/:slug/password
```

**Auth:** Required (must own the artifact)

**Body:**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| password | string or null | Yes | 8-128 chars to set, null to remove |

**Response (200):**
```json
{ "slug": "abc123", "passwordProtected": true }
```

**Errors:**

| Status | Error |
|--------|-------|
| 400 | Password must be 8-128 characters |
| 403 | You do not own this artifact |
| 404 | Artifact not found |

Password stored as bcrypt hash. Changing or removing invalidates all existing sessions. Visitors see a password form; correct entry sets a 30-day `dh_password` cookie. Rate limited: 10 attempts/minute/IP. Password check runs before email-allowlist access control.

### Duplicate Artifact

```
POST /api/v1/artifact/:slug/duplicate
```

**Auth:** Required (must own the artifact)

Creates a server-side copy with a new slug. Rate limited same as artifact creation.

Does NOT copy: password, access control settings, TTL, domain links, claim token.

**Response (201):**
```json
{
  "slug": "calm-reef-x9z1",
  "sourceSlug": "bold-canvas-a7k2",
  "versionId": "550e8400-e29b-41d4-a716-446655440000",
  "siteUrl": "https://calm-reef-x9z1.drophere.cc/",
  "files": 12
}
```

**Errors:**

| Status | Error |
|--------|-------|
| 403 | You do not own this artifact |
| 404 | Artifact not found |
| 410 | Source artifact has expired |

### Refresh Upload URLs

```
POST /api/v1/artifact/:slug/uploads/refresh
```

**Auth:** Required (Bearer token or claimToken in body)

Re-issues upload URLs for a pending version. Only returns URLs for files not yet uploaded to R2. Resets the 10-minute upload window.

**Body (anonymous):**
```json
{ "claimToken": "64-char-hex" }
```

**Response (200):**
```json
{
  "slug": "bold-canvas-a7k2",
  "versionId": "550e8400-e29b-41d4-a716-446655440000",
  "uploads": [
    { "path": "app.js", "method": "PUT", "url": "https://...", "headers": { "Content-Type": "application/javascript" } }
  ],
  "alreadyUploaded": ["index.html", "style.css"],
  "expiresIn": 600
}
```

**Errors:**

| Status | Error |
|--------|-------|
| 400 | No pending version / Version already finalized |
| 403 | You do not own this artifact |
| 404 | Artifact not found |

---

## Service Variables

Encrypted server-side storage for API keys and secrets. Values are encrypted at rest (AES-256-GCM) and never returned via the API. Used by proxy routes to inject auth headers into upstream API calls.

### Upsert Variable

```
PUT /api/v1/me/variables/:name
```

**Auth:** Required

**Body:**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| value | string | Yes | Max 4096 bytes (4 KB) |
| allowedUpstreams | string[] | No | Domain names this variable can be sent to |

**Name validation:** `/^[A-Za-z0-9_]{1,64}$/` — alphanumeric + underscores, 1-64 characters.

**Response (201 created / 200 updated):**
```json
{ "name": "OPENAI_KEY", "allowedUpstreams": ["api.openai.com"], "message": "Variable created" }
```

**Errors:**

| Status | Error |
|--------|-------|
| 400 | Invalid name / Value too large / Invalid allowedUpstreams |
| 400 | Maximum 50 variables per account |
| 503 | Service variables are not configured (VARIABLES_ENCRYPTION_KEY missing) |

### List Variables

```
GET /api/v1/me/variables
```

**Auth:** Required

**Response (200):**
```json
{
  "variables": [
    { "name": "OPENAI_KEY", "allowedUpstreams": ["api.openai.com"], "createdAt": "2026-03-12T10:00:00Z", "updatedAt": "2026-03-12T10:00:00Z" },
    { "name": "DB_KEY", "allowedUpstreams": null, "createdAt": "2026-03-12T10:00:00Z", "updatedAt": "2026-03-12T10:00:00Z" }
  ]
}
```

Values are **never** included in the response.

### Delete Variable

```
DELETE /api/v1/me/variables/:name
```

**Auth:** Required

**Response (200):**
```json
{ "name": "OPENAI_KEY", "message": "Variable deleted" }
```

---

## Proxy Routes

Static sites can call authenticated APIs via `/_proxy/*` paths without exposing credentials in client code. Deploy a `.drophere/proxy.json` file in your artifact.

### Manifest Format

Place `.drophere/proxy.json` in your artifact's files:

```json
{
  "routes": {
    "/api/chat": {
      "upstream": "https://api.openai.com/v1/chat/completions",
      "headers": { "Authorization": "Bearer ${OPENAI_KEY}" }
    },
    "/api/db/*": {
      "upstream": "https://db.example.com/api",
      "headers": { "apikey": "${DB_KEY}" },
      "rateLimit": "20/hour/ip"
    }
  }
}
```

### Route Matching

- **Exact match:** `/api/chat` matches only `/api/chat`
- **Wildcard:** `/api/db/*` matches `/api/db/anything` — the remaining path is appended to the upstream URL

### Variable Resolution

`${VAR_NAME}` references in `headers` values are resolved from service variables at request time. Variables are:
- Decrypted server-side — client code never sees credentials
- Scoped to the artifact owner's variables
- Subject to `allowedUpstreams` enforcement (variable rejected if upstream domain doesn't match)

### Rate Limiting

Default: 100 requests/hour/IP per route. Override per route with `"rateLimit": "20/hour/ip"`.

Format: `{count}/{second|minute|hour}/ip`

### Security

- `upstream` must use HTTPS — HTTP is rejected
- `Set-Cookie` headers from upstream are stripped
- Only `Content-Type` and `Accept` headers forwarded from client
- Max request body: 10 MB
- Max 20 routes per manifest
- SSE (Server-Sent Events) streaming works transparently

### Client Usage

```javascript
// From your deployed static site's client-side JavaScript
const res = await fetch('/_proxy/api/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ model: 'gpt-4', messages: [{ role: 'user', content: 'Hello' }] })
});
const data = await res.json();
```

---

## Access Control

Restrict who can view an artifact by email address or email domain.

### Set Access Control

```
PATCH /api/v1/artifact/:slug/access
```

**Auth:** Required (must be artifact owner)

**Body:**
```json
{
  "visibility": "restricted",
  "allowedEmails": ["alice@acme.com", "bob@acme.com"],
  "allowedDomains": ["acme.com"]
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `visibility` | `string` | Yes | `"public"` or `"restricted"` |
| `allowedEmails` | `string[]` | No | Max 100 emails. Required if no domains. |
| `allowedDomains` | `string[]` | No | Max 20 domains. Consumer domains (gmail.com, etc.) blocked. |

To make public again, set `visibility` to `"public"` — this clears all allowlists.

**Response (200):**
```json
{
  "slug": "abc123",
  "visibility": "restricted",
  "allowedEmails": ["alice@acme.com", "bob@acme.com"],
  "allowedDomains": ["acme.com"]
}
```

**Errors:**
| Status | Error |
|--------|-------|
| 400 | Invalid visibility, email, or domain format |
| 400 | Consumer domain blocked (gmail.com, outlook.com, etc.) |
| 400 | At least one email or domain required for restricted |
| 403 | You do not own this artifact |
| 404 | Artifact not found |
| 410 | Artifact has expired |

### Get Access Control

```
GET /api/v1/artifact/:slug/access
```

**Auth:** Required (must be artifact owner)

**Response (200):**
```json
{
  "slug": "abc123",
  "visibility": "restricted",
  "allowedEmails": ["alice@acme.com"],
  "allowedDomains": ["acme.com"]
}
```

---

## Visitor Authentication

Visitors to restricted artifacts verify their email via a one-time code. After verification, a session cookie is set on `.drophere.cc` for 30 days.

### Request Visitor Code

```
POST /api/v1/visitor/request-code
```

**Auth:** None

**Body:**
```json
{ "email": "alice@acme.com", "slug": "abc123" }
```

**Response (200):**
```json
{ "success": true, "expiresIn": 900 }
```

**Errors:**
| Status | Error |
|--------|-------|
| 400 | Invalid email or missing slug |
| 404 | Artifact not found (or not restricted) |
| 429 | Code already sent, wait 60 seconds |

Note: If the email is not on the allowlist, the endpoint still returns 200 but does not send a code. This prevents probing which emails have access.

### Verify Visitor Code

```
POST /api/v1/visitor/verify-code
```

**Auth:** None

**Body:**
```json
{ "email": "alice@acme.com", "code": "ABCD-EFGH", "slug": "abc123" }
```

**Response (200):**
```json
{ "success": true, "email": "alice@acme.com" }
```

Sets cookie: `dh_visitor` on `.drophere.cc` (30-day TTL, HttpOnly, Secure).

**Errors:**
| Status | Error |
|--------|-------|
| 400 | Invalid email, missing code or slug |
| 401 | Invalid or expired code |

---

## Capability Discovery

### Get API Capabilities

```
GET /api/v1/skill/docs
```

**Auth:** None

Returns a structured list of all API capabilities. Useful for agents to discover available features without reinstalling the skill.

**Response (200):**
```json
{
  "version": "0.2.0",
  "capabilities": [
    { "name": "publish", "summary": "Upload static files to the web instantly", "endpoints": [...] },
    { "name": "access-control", "summary": "Restrict who can view artifacts by email or domain", "endpoints": [...] }
  ],
  "docsUrl": "https://drophere.cc/skill/references/API.md"
}
```

Cached for 1 hour (`Cache-Control: public, max-age=3600`).

---

## Handles

Handles provide a subdomain namespace: `handle.drophere.cc/location`.

### Claim Handle

```
POST /api/v1/handle
```

**Auth:** Required

**Body:**
```json
{ "handle": "my-project" }
```

**Response (201):**
```json
{
  "handle": "my-project",
  "hostname": "my-project.drophere.cc",
  "namespace_id": "user-uuid"
}
```

**Validation:** 2-30 chars, lowercase alphanumeric + hyphens, no leading/trailing hyphens. Reserved words (`admin`, `api`, `www`, `app`, etc.) are blocked.

**Errors:**
| Status | Error |
|--------|-------|
| 400 | Invalid handle format |
| 409 | You already have a handle / Handle is already taken |

### Get Handle

```
GET /api/v1/handle
```

**Auth:** Required

**Response (200):**
```json
{
  "handle": "my-project",
  "hostname": "my-project.drophere.cc",
  "namespace_id": "user-uuid",
  "links": [{ "location": "docs", "slug": "abc123" }]
}
```

### Change Handle

```
PATCH /api/v1/handle
```

**Auth:** Required

**Body:**
```json
{ "handle": "new-name" }
```

**Response (200):**
```json
{
  "handle": "new-name",
  "hostname": "new-name.drophere.cc"
}
```

### Release Handle

```
DELETE /api/v1/handle
```

**Auth:** Required

**Response (200):**
```json
{ "success": true }
```

---

## Links

Links route paths under a handle or custom domain to artifacts.

### Create Link

```
POST /api/v1/links
```

**Auth:** Required

**Body:**
```json
{
  "location": "docs",
  "slug": "abc123",
  "domain": "example.com"
}
```

| Field | Required | Notes |
|-------|----------|-------|
| `location` | Yes | Path segment (e.g., `docs`, `blog`) |
| `slug` | Yes | Target artifact slug |
| `domain` | No | Custom domain. If omitted, uses your handle |

**Response (201):**
```json
{ "namespace": "my-project", "location": "docs", "slug": "abc123" }
```

### List Links

```
GET /api/v1/links
```

**Auth:** Required

**Response (200):**
```json
{
  "links": [
    { "location": "docs", "slug": "abc123", "namespace": "my-project", "namespaceType": "handle" }
  ]
}
```

### Get Link

```
GET /api/v1/links/:location
```

**Auth:** Required. Use `__root__` for the root location.

**Response (200):**
```json
{ "location": "docs", "slug": "abc123" }
```

### Update Link

```
PATCH /api/v1/links/:location
```

**Auth:** Required

**Body:**
```json
{ "slug": "new-slug" }
```

**Response (200):**
```json
{ "success": true }
```

### Delete Link

```
DELETE /api/v1/links/:location
```

**Auth:** Required. Optional query param `?domain=example.com` for domain-scoped links.

**Response (200):**
```json
{ "success": true }
```

---

## Domains

### Add Custom Domain

```
POST /api/v1/domains
```

**Auth:** Required

**Body:**
```json
{ "domain": "docs.example.com" }
```

**Response (201):**
```json
{
  "domain": "docs.example.com",
  "status": "pending",
  "dns_instructions": {
    "type": "CNAME",
    "name": "docs.example.com",
    "value": "fallback.drophere.cc",
    "note": "Add a CNAME record pointing docs.example.com to fallback.drophere.cc. If this is an apex domain, use an ALIAS record instead."
  }
}
```

### List Domains

```
GET /api/v1/domains
```

**Auth:** Required

**Response (200):**
```json
{
  "domains": [
    {
      "domain": "docs.example.com",
      "status": "active",
      "ssl_status": "active",
      "created_at": "2026-03-11T10:00:00.000Z",
      "links": [{ "location": "docs", "slug": "abc123" }]
    }
  ]
}
```

### Get Domain

```
GET /api/v1/domains/:domain
```

**Auth:** Required

**Response (200):**
```json
{
  "domain": "docs.example.com",
  "status": "active",
  "ssl_status": "active",
  "created_at": "2026-03-11T10:00:00.000Z"
}
```

### Delete Domain

```
DELETE /api/v1/domains/:domain
```

**Auth:** Required

**Response (200):**
```json
{ "success": true }
```

---

## Feedback

### Submit Feedback

Submit feedback about drophere. No authentication required.

```
POST /api/v1/feedback
```

**Auth:** None

**Body:**
```json
{
  "message": "presigned URL expired before upload finished",
  "slug": "abc123",
  "source": "skill"
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `message` | `string` | Yes | 1-2000 characters |
| `slug` | `string` | No | Related artifact slug (max 100 chars) |
| `source` | `string` | No | Where feedback came from, e.g. `"skill"`, `"api"`, `"manual"` (max 100 chars) |

**Response (201):**
```json
{ "received": true }
```

**Rate limit:** 10 per hour per IP.

---

## Key-Value Store

Per-artifact key-value storage, accessible from the artifact's own origin. No authentication required — designed for public read/write from hosted apps (e.g., game leaderboards).

All endpoints served from the artifact's subdomain: `{slug}.drophere.cc/_api/store/`. Also works via handles and custom domains.

### Get Value

```
GET /_api/store/:key
```

**Response (200):**
```json
{
  "value": [{ "name": "Alice", "score": 100 }],
  "metadata": { "updatedAt": "2026-03-13T10:00:00.000Z" }
}
```

**Errors:**
| Status | Code | Description |
|--------|------|-------------|
| 404 | `KEY_NOT_FOUND` | Key does not exist |
| 429 | `RATE_LIMITED` | Rate limit exceeded (300 reads/min per IP per artifact) |

### Put Value

```
PUT /_api/store/:key
Content-Type: application/json

[{ "name": "Alice", "score": 100 }]
```

Body must be valid JSON, max 100KB.

**Response (200):**
```json
{ "ok": true, "key": "leaderboard" }
```

**Errors:**
| Status | Code | Description |
|--------|------|-------------|
| 400 | `INVALID_KEY` | Key fails validation |
| 400 | `VALUE_TOO_LARGE` | Body exceeds 100KB |
| 400 | `INVALID_JSON` | Body is not valid JSON |
| 400 | `INVALID_CONTENT_TYPE` | Missing `Content-Type: application/json` |
| 429 | `RATE_LIMITED` | Rate limit exceeded (30 writes/min per IP per artifact) |

### Delete Value

```
DELETE /_api/store/:key
```

**Response (200):**
```json
{ "ok": true }
```

**Errors:**
| Status | Code | Description |
|--------|------|-------------|
| 404 | `KEY_NOT_FOUND` | Key does not exist |
| 429 | `RATE_LIMITED` | Rate limit exceeded (30 writes/min) |

### List Keys

```
GET /_api/store
```

Optional query parameter: `?cursor=...` for pagination.

**Response (200):**
```json
{
  "keys": [
    { "name": "leaderboard", "metadata": { "updatedAt": "2026-03-13T10:00:00.000Z" } }
  ],
  "cursor": null
}
```

Returns up to 1000 keys. Rate-limited at the write tier (30/min).

### Key Validation

Keys must match: `^[a-zA-Z0-9._\-:/]{1,480}$`

Valid: `score`, `game.level-1_data`, `leaderboard/level:1`
Invalid: empty string, spaces, `../etc/passwd`, unicode, `<script>`, keys > 480 chars

### CORS

All store responses include:
```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, PUT, DELETE, OPTIONS
Access-Control-Allow-Headers: Content-Type
```

`OPTIONS` requests return 204 with CORS headers (preflight support).

---

## Error Format

All errors follow a consistent format:

```json
{
  "error": "Human-readable error message",
  "details": "Optional additional context"
}
```

## Common Status Codes

| Code | Meaning |
|------|---------|
| 200 | Success |
| 201 | Created |
| 400 | Bad request (invalid input) |
| 401 | Authentication required or invalid |
| 403 | Forbidden (wrong owner / invalid claim token) |
| 404 | Resource not found |
| 409 | Conflict (duplicate slug, handle, etc.) |
| 410 | Gone (artifact expired) |
| 413 | Upload too large (file or artifact size limit exceeded) |
| 429 | Rate limit exceeded |
| 503 | Service temporarily unavailable |

## Content Serving

Artifacts are served at `https://{slug}.drophere.cc/`. The edge worker handles:

- **Direct slug access:** `{slug}.drophere.cc` serves the artifact
- **Handle routing:** `{handle}.drophere.cc/{location}` resolves via links
- **Custom domains:** `{domain}/{location}` resolves via links
- **Auto-viewer:** If no `index.html`, renders a rich preview (image viewer, gallery, PDF viewer, code viewer, etc.)
- **index.html:** If present, served as the entry point for the site
- **SPA routing:** When `spaMode: true` is set in viewer metadata, unmatched paths serve `index.html` instead of 404 — enabling React, Vue, SvelteKit, and other SPA frameworks. Static assets are still served normally.
- **Proxy routes:** Requests to `/_proxy/*` are forwarded to upstream APIs per `.drophere/proxy.json` manifest
- **Password protection:** Password-protected artifacts show a password form before serving any content
