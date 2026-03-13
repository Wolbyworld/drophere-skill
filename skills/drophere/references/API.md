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
  "limits": { "maxFileSize": 10485760, "maxArtifactSize": 26214400 },
  "claimToken": "ct_xyz789..."
}
```

- `uploads` — presigned R2 URLs (10-min TTL). Upload each file with `PUT`.
- `claimToken` — only returned for anonymous uploads. Store it to update/finalize later.

**Upload size limits:**

|  | Per file | Per artifact (total) |
|--|---------|---------------------|
| Anonymous | 10 MB | 25 MB |
| Authenticated | 50 MB | 200 MB |

Exceeding a limit returns **413** with `error`, `details`, and `limits` fields. The `size` field in each file entry must be the exact byte count — presigned URLs are locked to that size.

Limits are also returned in the response body so clients can pre-validate:
```json
{ "limits": { "maxFileSize": 10485760, "maxArtifactSize": 26214400 } }
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
  "limits": { "maxFileSize": 52428800, "maxArtifactSize": 209715200 }
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

Keys must match: `^[a-zA-Z0-9._\-:/]{1,512}$`

Valid: `score`, `game.level-1_data`, `leaderboard/level:1`
Invalid: empty string, spaces, `../etc/passwd`, unicode, `<script>`, keys > 512 chars

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
