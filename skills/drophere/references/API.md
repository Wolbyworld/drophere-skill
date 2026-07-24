# drophere.cc API Reference

Base URL: `https://drophere.cc`

All requests should include `Content-Type: application/json` for JSON bodies.
Authenticated endpoints require `Authorization: Bearer <api_key>`.

---

## Agent Integration Guidance

Drophere is file-oriented. Function-calling agents should not send a complete
generated website as one giant JSON string argument. That spends output tokens
twice: once to generate the file, then again to serialize it into a tool call.
It also makes cutoff failures more likely before the agent can return the URL.

Prefer this flow:

1. Write generated content to local or server-side staged files.
2. Send Drophere a compact manifest: path, byte size, content type, and hash.
3. Upload bytes through the returned presigned URLs.
4. Finalize and return only the live URL.

Hosted agent runtimes should expose staging tools, then a final publish tool
that reads those staged files server-side. Tool calls should pass paths, slugs,
version IDs, and URLs rather than full file bodies whenever possible.

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
{ "email": "user@example.com", "code": "ABCD-EFGH" }
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

Auth codes use the `XXXX-XXXX` format: eight uppercase letters/digits split by a hyphen. Verification accepts the hyphenated form shown in the email; agents should pass it through exactly as the user provides it.

The `apiKey` is permanent — store it securely and use it as a Bearer token for all authenticated endpoints.

**Errors:**
| Status | Error |
|--------|-------|
| 400 | Invalid email address |
| 401 | Invalid or expired code |

### Refresh Browser Session

Convert an existing Bearer-authenticated account session into the host-wide,
HttpOnly browser session used by owner-only controls on artifact subdomains.
The `/account` page calls this automatically; users do not need to sign out or
enter another email code.

```
POST /api/auth/browser/session
```

**Auth:** Required

**Headers:** `Origin` must exactly match `https://drophere.cc`.

**Response (200):**
```json
{ "success": true }
```

The response refreshes the `dh_account` cookie for `.drophere.cc`. The cookie is
`HttpOnly`, `Secure`, and is not returned in the JSON body. The API key is never
placed in a URL or returned by this endpoint. Newly minted browser sessions are
bound to the current API key and stop authenticating when that key is rotated.

**Errors:**
| Status | Error |
|--------|-------|
| 401 | Missing or invalid API key |
| 403 | Invalid origin |

### Rotate API Key

If your key leaks, atomically swap it.

```
POST /api/v1/me/api-key/rotate
```

**Auth:** Required

**Response (200):**
```json
{
  "apiKey": "<new 64-hex>",
  "message": "API key rotated. All clients using the old key will start returning 401..."
}
```

The old key starts returning `401` immediately on every authenticated REST endpoint and on the MCP surfaces. A confirmation email is sent best-effort. Rate-limited to 5/hour/user. **Not exposed via MCP** — agents can't rotate their own credentials.

Recovery from attacker-initiated rotation: re-run the magic-link flow to get whatever key is currently in the DB, then rotate again. The magic-link channel is gated on email control.

---

## Billing

### Plans

Return the public paywall plan definitions and upgrade copy.

```
GET /api/v1/billing/plans
```

**Auth:** Not required

**Response (200):**
```json
{
  "plans": [
    {
      "id": "unlimited",
      "name": "Unlimited",
      "description": "Higher-volume publishing for persistent artifacts.",
      "features": ["Unlimited persistent artifacts", "Custom artifact slugs"],
      "price": "$4.99/month"
    },
    {
      "id": "secure",
      "name": "Unlimited Pro",
      "description": "Volume publishing with collaboration and protected access controls.",
      "features": ["Unlimited persistent artifacts", "Custom artifact slugs", "Access controls", "Collaboration", "Service variables", "Custom domains"],
      "price": "$9.99/month"
    }
  ]
}
```

### Status

Return the authenticated account's plan, quota usage, feature flags, and upgrade options.

```
GET /api/v1/billing/status
```

**Auth:** Required

**Response (200):**
```json
{
  "plan": "free_token",
  "subscriptionStatus": null,
  "usage": {
    "persistentArtifacts": 3,
    "persistentArtifactLimit": 10
  },
  "features": {
    "apiAndMcp": true,
    "temporaryArtifacts": true,
    "persistentArtifacts": true,
    "unlimitedArtifacts": false,
    "secureAccessControls": false,
    "collaboration": false,
    "serviceVariables": false,
    "customArtifactSlugs": false,
    "customDomains": false
  },
  "upgradeOptions": [
    {
      "plan": "unlimited",
      "price": "$4.99/month",
      "checkoutEndpoint": "/api/v1/billing/checkout",
      "accountUrl": "https://drophere.cc/account?upgrade=unlimited",
      "unlocks": ["Unlimited persistent artifacts", "Custom artifact slugs"]
    }
  ]
}
```

### Checkout

Create a Stripe Checkout Session for a paid plan. Agents should only call this after explicit user confirmation.

```
POST /api/v1/billing/checkout
```

**Auth:** Required

**Body:**
```json
{ "plan": "secure" }
```

`plan` must be `unlimited` or `secure`.

**Response (200):**
```json
{
  "url": "https://checkout.stripe.com/...",
  "id": "cs_test_..."
}
```

### Portal

Create a Stripe billing portal session for the authenticated account.

```
POST /api/v1/billing/portal
```

**Auth:** Required

**Response (200):**
```json
{
  "url": "https://billing.stripe.com/..."
}
```

### Paywall Errors

Paid-feature gates return HTTP 402 with a structured error. Agents should present `agentMessage`, ask the human whether to upgrade, then call checkout only if the human confirms.

```json
{
  "error": "PAYWALL",
  "code": "PLAN_REQUIRED",
  "message": "The collaboration feature requires the Unlimited Pro plan.",
  "agentMessage": "The collaboration feature requires the Unlimited Pro plan. Upgrade to Unlimited Pro ($9.99/month) at https://drophere.cc/account?upgrade=secure.",
  "billing": {
    "plan": "free_token",
    "usage": {
      "persistentArtifacts": 10,
      "persistentArtifactLimit": 10
    }
  },
  "upgrade": {
    "plan": "secure",
    "price": "$9.99/month",
    "checkoutEndpoint": "/api/v1/billing/checkout"
  },
  "retry": { "action": "collaboration" }
}
```

Free Token includes API and MCP access, unlimited 24-hour artifacts, and 10 persistent artifacts. Unlimited unlocks unlimited persistent artifacts. Unlimited Pro unlocks access control, password protection, collaboration, service variables, and custom domains.

---

## Machine Payments

Machine payments are an accountless paid publish path for agents. Use the regular `/api/v1/artifact` endpoints for authenticated accounts, anonymous claim-token uploads, and Stripe subscription features. Use the machine endpoints only when the client can satisfy an MPP `tempo/charge` challenge.

Choose the path by principal, not by payment brand: logged-in humans and account-backed agents use the normal artifact APIs and Stripe-backed billing entitlements; accountless agents that need to pay per publish use the machine APIs and Tempo MPP. A client should not show both as interchangeable checkout choices for the same publish request.

Drophere v1 advertises Tempo push mode only: the client broadcasts the TIP-20 transfer, then retries with `Authorization: Payment ...` containing a transaction hash. Drophere verifies the transaction receipt, creates a machine-owned artifact, and returns a machine token for upload finalization.

### Create Machine Artifact

```
POST /api/v1/machine/artifact
```

**Auth:** No Bearer token. Requires `Idempotency-Key`. Use a high-entropy idempotency key and treat it as sensitive until `machineToken` is stored; paid retries are authorized by the tuple of idempotency key, exact request body, and verified Tempo transaction hash. Drophere rejects machine idempotency keys unless they are 32-200 URL-safe characters (`A-Z`, `a-z`, `0-9`, `.`, `_`, `~`, `-`).

Missing payment returns **402** with:

| Header | Notes |
|--------|-------|
| `WWW-Authenticate: Payment ...` | MPP `tempo/charge` challenge. The request advertises `methodDetails.supportedModes: ["push"]`. |
| `Cache-Control: no-store` | Payment challenges must not be cached. |

The JSON body includes agent recovery hints:

```json
{
  "error": "Payment required",
  "code": "PAYMENT_REQUIRED",
  "agentMessage": "Parse the WWW-Authenticate Payment challenge, broadcast the requested Tempo push transfer, then retry the same request with Authorization: Payment.",
  "nextAction": "tempo_push_payment_then_retry",
  "docsUrl": "https://docs.drophere.cc/#machine-payments"
}
```

Paid retries must send `Authorization: Payment ...` with a Tempo hash credential. The credential is a base64url-encoded JSON object. Reuse the challenge fields returned in `WWW-Authenticate`; keep the `request` field in the encoded form from that header.

```json
{
  "challenge": {
    "id": "...",
    "realm": "drophere.cc",
    "method": "tempo",
    "intent": "charge",
    "request": "<base64url challenge request>",
    "description": "Drophere paid machine artifact publish",
    "expires": "2026-06-23T00:00:00.000Z"
  },
  "payload": { "type": "hash", "hash": "0x..." },
  "source": "did:pkh:eip155:4217:0x..."
}
```

Rate limits return **429** with `code: "RATE_LIMITED"` and `Retry-After`. Challenge requests are limited separately from paid verification retries.

**Body:**
```json
{
  "files": [
    { "path": "index.html", "size": 1024, "contentType": "text/html" }
  ],
  "viewer": { "title": "Paid Site" },
  "source": "agent"
}
```

**Paid response (201):**
```json
{
  "slug": "paid-demo",
  "versionId": "550e8400-e29b-41d4-a716-446655440000",
  "siteUrl": "https://paid-demo.drophere.cc/",
  "uploadUrlExpiresIn": 600,
  "machineUploadExpiresAt": "2026-06-23T00:00:00.000Z",
  "machineToken": "<secret capability token>",
  "uploads": [
    {
      "path": "index.html",
      "method": "PUT",
      "url": "https://drophere.cc/api/v1/upload/paid-demo/550e8400-.../index.html",
      "headers": { "Content-Type": "text/html" }
    }
  ]
}
```

The paid create response includes `Payment-Receipt` and `Cache-Control: private, no-store`. Store `machineToken`; it is required for machine finalize, refresh, and delete. Upload URLs use the same 10-minute proxy window as regular artifacts. If an upload URL expires before `machineUploadExpiresAt`, call the machine refresh endpoint to get fresh URLs for missing files. `expiresAt` is returned after finalize, when the active artifact TTL starts.

### Finalize Machine Artifact

```
POST /api/v1/machine/artifact/:slug/finalize
```

**Auth:** `X-Drophere-Machine-Token`

**Body:**
```json
{ "versionId": "550e8400-e29b-41d4-a716-446655440000" }
```

Validates every uploaded object against the manifest, promotes the pending version, sets the paid artifact expiry, and returns `siteUrl`. Generic account and claim-token finalize endpoints reject machine-owned artifacts.

### Refresh Machine Uploads

```
POST /api/v1/machine/artifact/:slug/uploads/refresh
```

**Auth:** `X-Drophere-Machine-Token`

Returns fresh upload URLs for missing pending files while the paid machine upload window is still valid.

### Delete Machine Artifact

```
DELETE /api/v1/machine/artifact/:slug
```

**Auth:** `X-Drophere-Machine-Token`

Marks the machine-owned artifact deleted and atomically queues durable KV/R2 cleanup. Returns:

```json
{ "ok": true, "slug": "paid-demo", "storageCleanup": "pending" }
```

`storageCleanup: "pending"` means the one-minute cleanup worker will continue retrying until both stores are clear.

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
    "description": "A demo page"
  },
  "slug": "client-demo",
  "source": "cli"
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
| `slug` | `string` | No | Paid vanity artifact URL slug. Authenticated persistent artifacts only. Lowercase letters, numbers, and hyphens, 2-63 chars; no leading/trailing hyphen. |
| `lang` | `string` | No | Language for generated slug words: `en` (default) or `es`. Always validated (invalid values return `400 INVALID_LANG`) but has no effect when `slug` is provided |
| `viewer` | `ViewerMetadata` | No | Optional `title`, `description`, `ogImagePath`, `spaMode`, `markdownDownload` |
| `source` | `string` | No | Client/source label, max 100 chars. Also accepted via `x-drophere-client` header. |

All `viewer` fields are optional. Defaults: `title`/`description` omitted, `ogImagePath` absent or empty, `spaMode=false`, and `markdownDownload=false`.

**URL intent rule:** when a user asks for `https://name.drophere.cc/` or any `*.drophere.cc` root URL for one site, create the artifact with `slug: "name"`. Do not claim or rename a handle, do not register `name.drophere.cc` as a custom domain, and do not fall back to `handle.drophere.cc/name` unless the user approves that fallback.

**Vanity artifact URLs:** Paid Unlimited and Unlimited Pro accounts may pass `slug` at creation time to publish at `https://{slug}.drophere.cc/`. Custom slugs require authenticated persistent artifacts; do not combine `slug` with `ttlSeconds`. Slugs must be lowercase DNS labels: `a-z`, `0-9`, hyphen, 2-63 chars, no leading/trailing hyphen. Reserved platform names such as `admin`, `api`, `www`, `docs`, `app`, `login`, `status`, and `support` are blocked. On `409` with `code: "CUSTOM_SLUG_UNAVAILABLE"`, ask the user for a different slug; do not invent one unless the user requested suggestions.

**Generated slugs:** are two words, e.g. `pure-haze` (`lang: "en"`) or `pulpo-bailarin` (`lang: "es"`). After a generated candidate collides, the next retry samples a fresh word pair and adds a numeric suffix (`pulpo-bailarin-7`), growing it by one digit per retry.

**Response (201):**
```json
{
  "slug": "bold-canvas",
  "versionId": "550e8400-e29b-41d4-a716-446655440000",
  "siteUrl": "https://bold-canvas.drophere.cc/",
  "uploads": [
    {
      "path": "index.html",
      "method": "PUT",
      "url": "https://drophere.cc/api/v1/upload/bold-canvas/550e8400-.../index.html",
      "headers": { "Content-Type": "text/html" }
    }
  ],
  "limits": { "maxFileSize": 104857600, "maxArtifactSize": 262144000 },
  "claimToken": "ct_xyz789..."
}
```

- `uploads` — upload URLs (10-min window). Upload each file with `PUT`.
- `claimToken` — only returned for anonymous uploads. Store it to update/finalize later.

REST create/update responses use `uploads` for direct HTTP `PUT`s. MCP create/update tools instead return `mcpUploads`, `directHttpUploads`, and `nextStep`; MCP clients should follow `mcpUploads` and reserve `directHttpUploads` for clients that can upload raw bytes themselves.

**Create errors:**
| Status | Code | Meaning |
|--------|------|---------|
| 400 | `CUSTOM_SLUG_INVALID` | `slug` is not a valid lowercase DNS label or is reserved |
| 400 | `CUSTOM_SLUG_REQUIRES_PERSISTENT_ARTIFACT` | `slug` was combined with `ttlSeconds`; vanity slugs are persistent only |
| 400 | `INVALID_LANG` | `lang` was not one of the supported values (`en`, `es`) |
| 402 | `ACCOUNT_REQUIRED` | A signed-in account is required before claiming a vanity artifact slug |
| 402 | `PLAN_REQUIRED` | The signed-in account does not have `custom_artifact_slugs` |
| 409 | `CUSTOM_SLUG_UNAVAILABLE` | The slug is already used by an artifact, retained reservation, or handle |

**Upload size limits:**

|  | Per file | Per artifact (total) |
|--|---------|---------------------|
| Anonymous | 100 MB | 250 MB |
| Authenticated | 1 GB | 5 GB |

Exceeding a limit returns **413** with `error`, `details`, and `limits` fields. The `size` field in each file entry must be the exact byte count — the upload proxy validates Content-Length against the declared size.

Limits are also returned in the response body so clients can pre-validate:
```json
{ "limits": { "maxFileSize": 104857600, "maxArtifactSize": 262144000 } }
```

**Rate limits:**
- Authenticated: 60 creates per hour
- Anonymous: 5 creates per hour (per IP)

### Upload File

Upload each file to the corresponding URL returned from create, update, or refresh.

```
PUT /api/v1/upload/:slug/:versionId/:filePath
```

**Auth:** Capability URL. No Bearer token required; the `slug` + `versionId` +
path identify an upload slot only while that exact version remains the
artifact's `pendingVersionId`. Historical `abandoned` versions cannot receive
uploads even if their original 10-minute window has not expired.

Headers:

| Header | Required | Notes |
|--------|----------|-------|
| `Content-Type` | Recommended | Should match the manifest entry's content type |
| `Content-Length` | Required | Must exactly match the manifest entry's declared size |

**Response (200):**
```json
{ "ok": true, "path": "index.html" }
```

The upload window is 10 minutes. If it expires before all files are uploaded, call `POST /api/v1/artifact/:slug/uploads/refresh`.

Each version file is first-write-wins. A retry never replaces stored bytes: it succeeds only when the existing object's size and content type still match the manifest. A conflicting retry returns **409**; discard the pending version and create a new one.

**Errors:**
| Status | Error |
|--------|-------|
| 400 | Invalid version ID or empty body |
| 403 | Upload window expired |
| 404 | Version not found, already finalized, no longer pending, or file not in manifest |
| 409 | File already exists with conflicting manifest metadata |
| 411 | Missing Content-Length |
| 413 | Content-Length does not match declared file size |
| 502 | Upload to storage failed |

### Update Artifact (Incremental Deploy)

Update an existing artifact. Files with matching hashes are skipped (no re-upload needed).

```
PUT /api/v1/artifact/:slug
```

**Auth:** Optional (Bearer token OR `claimToken` in body for anonymous OR edit grant token via `X-Drophere-Edit-Token`)

**Body:**
```json
{
  "files": [
    { "path": "index.html", "size": 2048, "contentType": "text/html", "hash": "sha256:new..." },
    { "path": "style.css", "size": 512, "contentType": "text/css", "hash": "sha256:def..." }
  ],
  "deletePaths": [],
  "manifestMode": "merge",
  "claimToken": "ct_xyz789...",
  "baseVersionId": "current-version-id-for-edit-grants",
  "summary": "Short deploy summary"
}
```

**Response (200):**
```json
{
  "slug": "bold-canvas",
  "versionId": "660e8400-...",
  "siteUrl": "https://bold-canvas.drophere.cc/",
  "uploads": [
    {
      "path": "index.html",
      "method": "PUT",
      "url": "https://drophere.cc/api/v1/upload/bold-canvas/660e8400-.../index.html",
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
- Edit-token updates default to `manifestMode: "merge"`: supplied paths are changed or added, omitted paths carry forward, and deletion requires `deletePaths`. `manifestMode: "replace"` explicitly treats `files` as the complete manifest. Edit grants must send `baseVersionId`; Drophere rejects stale updates with `409`.
- If a pending version was created with a bad manifest or bad files, prefer another update with the corrected manifest, or discard the pending version when appropriate. Use full artifact deletion only when you intend to remove the live artifact and all versions.

**Errors:**
| Status | Error |
|--------|-------|
| 403 | Invalid or missing claim token / You do not own this artifact |
| 404 | Artifact not found |
| 409 | Base version changed; recreate update from current version |
| 410 | Artifact has expired |
| 413 | File or total artifact size exceeds limit |

### Finalize or Save an Artifact Version

Mark an upload complete and immutable. Copies skipped files server-side.
Existing clients remain compatible: omitting `activate` saves the version and
makes it live. Authenticated owners and edit grants may pass `activate: false`
to save without changing the live site.

```
POST /api/v1/artifact/:slug/finalize
```

**Auth:** Optional (Bearer token OR `claimToken` in body OR edit grant token via `X-Drophere-Edit-Token`)

**Body:**
```json
{
  "versionId": "550e8400-e29b-41d4-a716-446655440000",
  "claimToken": "ct_xyz789...",
  "activate": false
}
```

`activate` defaults to `true`. Anonymous claim-token uploads must use the
publish-now default because deploying a previously saved version is an
owner-only operation.

**Response (200):**
```json
{
  "slug": "bold-canvas",
  "versionId": "550e8400-...",
  "siteUrl": "https://bold-canvas.drophere.cc/",
  "state": "saved",
  "isCurrent": false,
  "savedAt": "2026-07-24T12:03:00.000Z",
  "currentVersionId": "previous-live-version-id"
}
```

**Errors:**
| Status | Error |
|--------|-------|
| 400 | versionId is required / activate must be a boolean |
| 401 | Authentication required |
| 403 | Invalid or missing claim token / You do not own this artifact |
| 404 | Artifact not found / Version not found |
| 409 | versionId does not match pending version / base version changed |

### Artifact Edit Grants

Owner-managed scoped tokens for collaborative publishing. `deploy` grants are write-only credentials for callers that already have a complete local source tree. `editor` grants add manifest, raw-source, and comment reads so a token-only collaborator can make bounded changes safely. Neither kind can delete the artifact, restore/rollback versions, change visibility/passwords, mutate comments, manage variables, route handles/domains, duplicate artifacts, or create/revoke grants.

The raw token is returned only once on creation. Drophere stores only a token hash.

#### Create Edit Grant

```
POST /api/v1/artifact/:slug/edit-grants
```

**Auth:** Required (artifact owner Bearer token)

**Body:**
```json
{
  "name": "builder agent",
  "kind": "editor",
  "ttlSeconds": 86400
}
```

`kind` defaults to `deploy`. `editor` produces the scopes `deploy`, `manifest:read`, `source:read`, and `comments:read`. `expiresAt` may be sent instead of `ttlSeconds`.

**Response (201):**
```json
{
  "grant": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "slug": "bold-canvas",
    "name": "builder agent",
    "kind": "editor",
    "scopes": ["deploy", "manifest:read", "source:read", "comments:read"],
    "expiresAt": "2026-06-29T12:00:00.000Z",
    "revokedAt": null,
    "lastUsedAt": null,
    "createdAt": "2026-06-28T12:00:00.000Z",
    "updatedAt": "2026-06-28T12:00:00.000Z"
  },
  "token": "deg_secret_returned_once",
  "tokenReturnedOnce": true
}
```

#### List Edit Grants

```
GET /api/v1/artifact/:slug/edit-grants?includeRevoked=false
```

**Auth:** Required (artifact owner Bearer token)

Returns grant metadata without token values.

#### Revoke Edit Grant

```
DELETE /api/v1/artifact/:slug/edit-grants/:grantId
```

**Auth:** Required (artifact owner Bearer token)

Revocation is idempotent. Existing pending versions created by the grant cannot be finalized with that grant after revocation.

#### Edit Context

```
GET /api/v1/artifact/:slug/edit-context?include=manifest
```

**Auth:** `X-Drophere-Edit-Token`

All active deploy grants receive `currentVersionId`, `fileCount`, and capability flags. `include=manifest` additionally returns the authoritative current manifest and requires `manifest:read`.

**Response (200):**
```json
{
  "slug": "bold-canvas",
  "currentVersionId": "version-id",
  "fileCount": 2,
  "capabilities": {
    "deploy": true,
    "readManifest": true,
    "readSource": true,
    "readComments": true
  },
  "files": [
    {
      "path": "index.html",
      "size": 26845,
      "contentType": "text/html",
      "hash": "sha256:..."
    }
  ]
}
```

`files` is present only for `include=manifest`. A deploy-only grant can use this endpoint to obtain `currentVersionId` but cannot request the manifest.

#### Raw and Bounded Source Reads

```
GET /api/v1/artifact/:slug/source/:path
GET /api/v1/artifact/:slug/source/:path?startLine=40&endLine=70
GET /api/v1/artifact/:slug/source-search?query=heading&path=index.html
```

**Auth:** `X-Drophere-Edit-Token` with `source:read`

The source route streams the stored R2 object before collaboration or Markdown transformations and supports HTTP byte ranges. Supplying `startLine` and `endLine` returns a bounded JSON text range. `format=json` returns the complete UTF-8 text file as an explicit fallback. Source search is literal, returns at most 20 matches and 32 KiB of context, and scans at most 2 MiB per request.

**Line-range response (200):**
```json
{
  "slug": "bold-canvas",
  "currentVersionId": "version-id",
  "path": "index.html",
  "startLine": 40,
  "endLine": 70,
  "totalLines": 240,
  "text": "..."
}
```

Raw responses include `Content-Type`, `Content-Length`, `ETag`, `Cache-Control: private, no-store`, and `Accept-Ranges: bytes`. A valid `Range` request returns `206` with `Content-Range`; an invalid or unsatisfiable range returns `416`. `format=json` returns `slug`, `currentVersionId`, `path`, `contentType`, `bytes`, and complete UTF-8 `text`.

**Search response (200):**
```json
{
  "slug": "bold-canvas",
  "currentVersionId": "version-id",
  "query": "heading",
  "matches": [
    {
      "path": "index.html",
      "line": 52,
      "column": 5,
      "match": "heading",
      "contextStartLine": 47,
      "contextEndLine": 57,
      "context": "...",
      "contextTruncated": false
    }
  ],
  "totalMatches": 1,
  "truncated": false,
  "scannedBytes": 26845,
  "skipped": [],
  "skippedCount": 0,
  "skippedTruncated": false
}
```

When `truncated` is true, inspect `skipped` and narrow by `path`; `totalMatches` counts every match in the files that were scanned. `skipped` is capped at 20 entries, while `skippedCount` reports the complete count.

#### Token-Efficient Text Edits

```
POST /api/v1/artifact/:slug/edits
```

**Auth:** `X-Drophere-Edit-Token` with `deploy` and `source:read`

```json
{
  "baseVersionId": "current-version-id",
  "summary": "Address heading feedback",
  "operations": [
    {
      "op": "replace_text",
      "path": "index.html",
      "expected": "Current heading",
      "replacement": "New heading",
      "requireMatches": 1
    }
  ]
}
```

Operations apply sequentially to stored UTF-8 source. Zero, ambiguous, or unexpected match counts return `409` without creating a pending version. Drophere computes the new size and SHA-256 hash, writes only changed objects, carries every other file forward, and returns a pending `versionId` for the normal finalize call. Text operations are limited to 2 MiB per file, 20 operations, and 256 KiB of replacement input.

Only one pending version may exist at a time. The request must use the `currentVersionId` observed during search/read; Drophere returns `409` if the live or pending state changed. The request body is limited to 512 KiB, changed output to 8 MiB total, and edit creation to 60 requests per grant per hour.

**Response (201):**
```json
{
  "slug": "bold-canvas",
  "versionId": "pending-version-id",
  "baseVersionId": "current-version-id",
  "readyToFinalize": true,
  "changedFiles": [
    {
      "path": "index.html",
      "replacements": 1,
      "previousBytes": 26845,
      "bytes": 26831,
      "hash": "sha256:..."
    }
  ],
  "copiedFileCount": 11,
  "siteUrl": "https://bold-canvas.drophere.cc/"
}
```

An editor grant may also call `GET /api/v1/artifact/:slug/comments?status=open&limit=20&messageLimit=20`; this is read-only and returns the existing non-owner comment representation without requiring collaboration cookies or origin headers. Editor-token reads default to 20 threads and 20 messages per thread. Thread pagination is stable and cursor-based: pass the opaque `pagination.nextCursor` back as `cursor`. Each thread returns its root feedback plus the newest replies and a `messagePage` object with `limit`, `returned`, `hasMore`, and `attachmentsTruncated`, so bounded reads never silently hide newer feedback.

**Editor endpoint errors:**

| Status | Codes / meaning |
|--------|-----------------|
| 400 | `INVALID_SEARCH_QUERY`, `INVALID_CONTEXT_LINES`, `INVALID_SOURCE_PATH`, `INVALID_LINE_RANGE`, `INVALID_EDIT_REQUEST`, `INVALID_EDIT_OPERATION` |
| 401 | `EDIT_TOKEN_REQUIRED` |
| 403 | `EDIT_SCOPE_REQUIRED`, `MANIFEST_READ_SCOPE_REQUIRED`, `DEPLOY_SCOPE_REQUIRED`, `EDIT_GRANT_OWNER_MISMATCH` |
| 404 | `ARTIFACT_NOT_FOUND`, `SOURCE_FILE_NOT_FOUND`, `SOURCE_OBJECT_NOT_FOUND` |
| 409 | `ARTIFACT_NOT_ACTIVE`, `BASE_VERSION_CHANGED`, `PENDING_VERSION_EXISTS`, `ARTIFACT_STATE_CHANGED`, `NO_MATCH`, `AMBIGUOUS_MATCH`, `MATCH_COUNT_MISMATCH` |
| 410 | `ARTIFACT_EXPIRED` |
| 413 | `SOURCE_NOT_TEXT`, `TEXT_OPERATION_TOO_LARGE`, `EDIT_REQUEST_TOO_LARGE`, `EDIT_OUTPUT_TOO_LARGE`, `EDITED_ARTIFACT_TOO_LARGE` |
| 416 | `INVALID_BYTE_RANGE` |
| 429 | `EDIT_RATE_LIMITED` |
| 500 | `CURRENT_VERSION_MISSING`, `EDIT_VERSION_CREATE_FAILED` |
| 502 | `EDIT_STORAGE_FAILED` |

These editor operations are exposed through REST and the bundled `edit.mjs` CLI, including batched operations files. They are intentionally not MCP tools: the edit token is a collaborator credential, while the Drophere MCP server is authenticated as the artifact owner. This keeps artifact-owner authority separate from delegated editor authority.

### Version History

```
GET /api/v1/artifact/:slug/versions?limit=50
```

**Auth:** Required (artifact owner Bearer token)

Lists version records with deploy attribution and computed lifecycle state.
`uploading` is only the current mutable upload selected by `pendingVersionId`,
`saved` is immutable but not live, and `live` is the version selected by
`currentVersionId`. An unfinalized historical record that is no longer pending
is `abandoned`; it is terminal and cannot be finalized or discarded.

**Response (200):**
```json
{
  "slug": "bold-canvas",
  "currentVersionId": "current-version-id",
  "pendingVersionId": null,
  "versions": [
    {
      "versionId": "current-version-id",
      "baseVersionId": "previous-version-id",
      "isFinalized": true,
      "isCurrent": true,
      "state": "live",
      "createdByKind": "edit_grant",
      "createdByUserId": null,
      "createdByEditGrantId": "grant-id",
      "editGrantName": "builder agent",
      "summary": "Update homepage copy",
      "fileCount": 12,
      "createdAt": "2026-06-28T12:00:00.000Z",
      "finalizedAt": "2026-06-28T12:03:00.000Z",
      "savedAt": "2026-06-28T12:03:00.000Z"
    }
  ]
}
```

#### Deploy or Roll Back to a Saved Version

```
POST /api/v1/artifact/:slug/versions/:versionId/deploy
```

**Auth:** Required (artifact owner Bearer token)

**Body:**
```json
{ "expectedCurrentVersionId": "current-version-id" }
```

Use `null` when the artifact has no live version yet. The expected value is an
optimistic-concurrency guard; a stale live pointer returns `409` without
changing the site. The selected version must belong to the artifact and already
be saved. Deploy is rejected while another upload is pending. Selecting an
older saved version performs a rollback through the same operation.

**Response (200):**
```json
{
  "slug": "bold-canvas",
  "versionId": "saved-version-id",
  "state": "live",
  "isCurrent": true,
  "currentVersionId": "saved-version-id",
  "previousVersionId": "current-version-id",
  "siteUrl": "https://bold-canvas.drophere.cc/"
}
```

**Errors:**
| Status | Error |
|--------|-------|
| 400 | expectedCurrentVersionId is missing or invalid |
| 403 | You do not own this artifact |
| 404 | Artifact or saved version not found |
| 409 | Pending upload exists / version is not saved / live version changed |
| 410 | Artifact has expired |

#### Publish With Edit Grant

```bash
curl -X PUT "https://drophere.cc/api/v1/artifact/bold-canvas" \
  -H "X-Drophere-Edit-Token: deg_secret_returned_once" \
  -H "Content-Type: application/json" \
  -d '{"baseVersionId":"current-version-id","files":[{"path":"index.html","size":2048,"contentType":"text/html","hash":"sha256:new"}],"deletePaths":[]}'

curl -X POST "https://drophere.cc/api/v1/artifact/bold-canvas/finalize" \
  -H "X-Drophere-Edit-Token: deg_secret_returned_once" \
  -H "Content-Type: application/json" \
  -d '{"versionId":"returned-version-id"}'
```

For edit-token updates, supplied files replace or add only those paths; omitted files carry forward automatically. File deletion requires explicit `deletePaths`. `manifestMode: "replace"` is the opt-in full-manifest replacement mode. Finalize succeeds only when the pending version was created by that grant and the artifact's live `currentVersionId` still matches the pending version's `baseVersionId`.

### HTML Quick Edit (Private Beta)

HTML Quick Edit changes one visible static text node while preserving every other source byte, then publishes the result as a new immutable artifact version. It is server-gated and currently enabled only for verified `@luzia.com` Drophere accounts. The authenticated account must own the artifact.

The account library exposes **edit text** for eligible artifacts. The same workflow is available through REST for agents and scripts.

#### Resolve Account Features

```
GET /api/v1/me/features
```

**Auth:** Required (Bearer token or Drophere account session)

**Response (200):**
```json
{ "features": { "htmlQuickEdit": true } }
```

#### Preview Text Edit

```
POST /api/v1/artifact/:slug/quick-edits/preview
```

**Auth:** Required (artifact owner Bearer token or same-origin Drophere account session)

**Body:**
```json
{
  "filePath": "index.html",
  "baseVersionId": "current-version-id",
  "locator": {
    "elementPath": [
      { "tag": "main", "index": 0 },
      { "tag": "p", "index": 2 }
    ],
    "textIndex": 0
  },
  "originalText": "Old quarterly target",
  "replacementText": "New quarterly target",
  "sessionId": "optional-client-session-id"
}
```

Path indices are zero-based among same-tag element siblings. `textIndex` is zero-based among direct text-node children. Preview reads the immutable live source and returns the canonical before/after operation without writing a version.

**Response (200):**
```json
{
  "slug": "bold-canvas",
  "filePath": "index.html",
  "baseVersionId": "current-version-id",
  "supported": true,
  "preview": {
    "before": "Old quarterly target",
    "after": "New quarterly target"
  }
}
```

#### Publish Text Edit

```
POST /api/v1/artifact/:slug/quick-edits/publish
```

Uses the same body as preview, with optional `summary`. Publishing rechecks feature access, ownership, the source locator, and `baseVersionId`; copies unchanged files to a new immutable version; and atomically promotes that version. Existing pending uploads are never overwritten.

**Response (200):**
```json
{
  "slug": "bold-canvas",
  "versionId": "new-version-id",
  "baseVersionId": "current-version-id",
  "siteUrl": "https://bold-canvas.drophere.cc/",
  "summary": "Quick edit: update visible text"
}
```

**Limits and safety:**
- HTML source must be at most 2 MiB.
- Replacement text must be non-empty and at most 20,000 characters.
- Quick Edit refuses runtime-generated content and text inside `script`, `style`, `textarea`, `input`, `select`, `svg`, `math`, `canvas`, `template`, or `noscript`.
- Replacement text is HTML-escaped and cannot introduce markup or scripts.
- Publish is limited to 30 operations per minute per user.

| Status | Code | Meaning |
|--------|------|---------|
| 400 | `INVALID_BODY`, `INVALID_FILE_PATH`, `BASE_VERSION_REQUIRED`, `INVALID_PATCH` | Request body or required patch fields are invalid |
| 401 | `AUTHENTICATION_REQUIRED` | No valid account or Bearer authentication |
| 403 | `INVALID_ORIGIN` | Account-cookie mutation did not come from the main Drophere origin |
| 404 | `FEATURE_NOT_ENABLED`, `ARTIFACT_NOT_FOUND`, `FILE_NOT_FOUND` | Feature, owned artifact, or target file is unavailable |
| 409 | `NO_LIVE_VERSION`, `STALE_BASE_VERSION`, `PENDING_VERSION_EXISTS` | Artifact state prevents a safe immutable publish |
| 413 | `HTML_TOO_LARGE` | Source exceeds the 2 MiB editor cap |
| 415 | `UNSUPPORTED_FILE_TYPE`, `UNSUPPORTED_ENCODING` | Target is not UTF-8 HTML |
| 422 | `INVALID_LOCATOR`, `TARGET_NOT_FOUND`, `TARGET_CHANGED`, `UNSUPPORTED_ELEMENT`, `EMPTY_REPLACEMENT`, `TEXT_TOO_LARGE` | Source patch could not be applied safely |
| 429 | `RATE_LIMITED` | Per-user publish limit exceeded |
| 500 | `SOURCE_UNAVAILABLE`, `STORAGE_FAILED`, `PUBLISH_FAILED` | Source read, object preparation, or atomic promotion failed |
| 503 | `RATE_LIMIT_UNAVAILABLE` | Publish rate-limit service is temporarily unavailable |

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
  "slug": "bold-canvas",
  "siteUrl": "https://bold-canvas.drophere.cc/",
  "message": "Artifact claimed successfully"
}
```

### Update Viewer Metadata

Update viewer metadata. `title`, `description`, and `ogImagePath` affect auto-viewer rendering when there is no `index.html`. `spaMode` enables index fallback for client-side routers. `markdownDownload` enables opt-in `?format=md` downloads for HTML/Markdown artifact pages.

All fields are optional. Defaults are `spaMode=false`, `markdownDownload=false`, no `ogImagePath`, and no title/description.

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
  "slug": "bold-canvas",
  "viewerMetadata": { "title": "Updated Title", "description": "New description" },
  "note": "Viewer metadata updated successfully."
}
```

### Artifact Tags

Private artifact-level tags for knowledge discovery and agent search. Tags are owner-only metadata; they are not exposed on public artifact pages.

Tags are normalized by trimming, lowercasing, and collapsing whitespace/hyphens to `-`. Empty tags are rejected, each tag is limited to 40 characters, and each artifact can have at most 20 tags. `PATCH /tags` replaces the full tag set, so agents should read existing tags before preserving or extending them.

#### Get Artifact Tags

```
GET /api/v1/artifact/:slug/tags
```

**Auth:** Required

**Response (200):**
```json
{
  "slug": "bold-canvas",
  "tags": [
    { "tag": "strategy", "source": "agent", "confidence": 0.82, "createdAt": "2026-03-13T10:00:00Z", "updatedAt": "2026-03-13T10:00:00Z" }
  ],
  "count": 1
}
```

#### Replace Artifact Tags

```
PATCH /api/v1/artifact/:slug/tags
```

**Auth:** Required

**Body:**
```json
{
  "tags": ["Strategy", "Q1 Plan"],
  "source": "agent",
  "confidence": 0.82
}
```

`source` is optional and defaults to `user` for REST. Valid values are `agent`, `user`, and `import`. `confidence` is optional and must be between `0` and `1` when provided.

**Response (200):**
```json
{
  "slug": "bold-canvas",
  "tags": [
    { "tag": "q1-plan", "source": "agent", "confidence": 0.82, "createdAt": "2026-03-13T10:00:00Z", "updatedAt": "2026-03-13T10:00:00Z" },
    { "tag": "strategy", "source": "agent", "confidence": 0.82, "createdAt": "2026-03-13T10:00:00Z", "updatedAt": "2026-03-13T10:00:00Z" }
  ],
  "count": 2
}
```

#### List Tags

```
GET /api/v1/tags
```

**Auth:** Required

Returns the caller's private tag vocabulary with artifact counts.

**Response (200):**
```json
{
  "tags": [
    { "tag": "strategy", "count": 4 },
    { "tag": "q1-plan", "count": 1 }
  ],
  "count": 2
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
  "slug": "bold-canvas",
  "siteUrl": "https://bold-canvas.drophere.cc/",
  "status": "active",
  "currentVersionId": "550e8400-...",
  "pendingVersionId": null,
  "access": {
    "visibility": "public",
    "allowedEmails": null,
    "allowedDomains": null
  },
  "collaboration": {
    "enabled": false,
    "commentPolicy": "authenticated",
    "commentDomain": null,
    "commentAllowedEmails": null
  },
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
      "slug": "bold-canvas",
      "siteUrl": "https://bold-canvas.drophere.cc/",
      "status": "active",
      "currentVersionId": "550e8400-...",
      "pendingVersionId": null,
      "access": {
        "visibility": "public",
        "allowedEmails": null,
        "allowedDomains": null
      },
      "collaboration": {
        "enabled": false,
        "commentPolicy": "authenticated",
        "commentDomain": null,
        "commentAllowedEmails": null
      },
      "viewerMetadata": { "title": "My Project" },
      "title": "My Project",
      "expiresAt": null,
      "updatedAt": "2026-03-11T10:01:00.000Z"
    }
  ]
}
```

`viewerMetadata` is the full JSON blob (`null` when unset). `title` is a convenience extraction of `viewerMetadata.title` (trimmed; `null` when missing or empty). `access` and `collaboration` are included so owners and agents can discover the current view gate and comment layer before calling the access or comment APIs.

### Library

The private library is the owner rediscovery layer. Every authenticated artifact owned by the user appears automatically, including random artifact slugs and paid vanity artifact slugs. Anonymous artifacts appear after claim. Library routes are aliases; the artifact slug remains the immutable identity.

Human UI anchor: `https://drophere.cc/account#library`. Agents should use that exact URL when linking a user to the private library for rediscovery, organization, routing, or cleanup. Keep returning the specific artifact URL (`artifactUrl` or `preferredUrl`) when the user asks for the published site itself.

```
GET /api/v1/library/items
```

**Auth:** Required

**Query params:** `q`, `collectionId`, `tag`, `source`, `status`, `visibility`, `favorite=true`, `routed=true`, `archived=true`, `limit`, `cursor`.

**Response (200):**
```json
{
  "items": [
    {
      "artifactSlug": "bold-canvas",
      "artifactUrl": "https://bold-canvas.drophere.cc/",
      "preferredUrl": "https://alice.drophere.cc/docs",
      "routes": [
        { "namespaceType": "handle", "namespace": "alice", "location": "docs", "slug": "bold-canvas", "url": "https://alice.drophere.cc/docs" }
      ],
      "title": "Launch docs",
      "summary": "Customer-facing launch notes",
      "tags": ["launch", "docs"],
      "collections": [{ "id": "uuid", "name": "Launch", "slug": "launch" }],
      "favorite": true,
      "archived": false,
      "sourceLabel": "mcp",
      "status": "active",
      "visibility": "public",
      "updatedAt": "2026-03-11T10:01:00.000Z"
    }
  ],
  "nextCursor": null
}
```

```
GET /api/v1/library/items/:artifactSlug
PATCH /api/v1/library/items/:artifactSlug
GET /api/v1/library/items/:artifactSlug/route-suggestions
GET /api/v1/library/items/:artifactSlug/related
```

`PATCH` accepts `title`, `summary`, `tags`, `favorite`, `archived`, and `sourceLabel`. Route suggestions return handle paths plus collision and prefix-shadow information. Related items are deterministic V1 recommendations based on shared tags, source, collections, route prefixes, and title overlap.

```
GET /api/v1/library/collections
POST /api/v1/library/collections
PATCH /api/v1/library/collections/:collectionId
DELETE /api/v1/library/collections/:collectionId
POST /api/v1/library/collections/:collectionId/items
DELETE /api/v1/library/collections/:collectionId/items/:artifactSlug
```

Collections are private to the authenticated user. Adding an item to a collection is idempotent and only works for artifacts owned by the same user.

### Delete Artifact

```
DELETE /api/v1/artifact/:slug
```

**Auth:** Required

**Response (200):**
```json
{ "slug": "bold-canvas", "message": "Artifact deleted" }
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
{ "slug": "bold-canvas", "passwordProtected": true }
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

Creates a server-side copy with a new slug. The destination is staged as
non-live while every R2 object is copied with create-only semantics and its
source size and content type are checked against the manifest. The artifact
becomes live atomically only after all copies succeed. A failed copy returns no
live URL and best-effort removes staged objects after deleting the guarded
pending database artifact. With `client_request_id`, the exact staged
destination remains retryable for up to 24 hours. After that fixed deadline and
15 minutes without an active retry, a bounded minute reaper removes the exact
pending artifact and durable identity, then queues durable object cleanup.
Successful or otherwise changed destinations are never reaped. Rate limited
same as artifact creation.

Does NOT copy: password, access control settings, TTL, domain links, claim token.

**Response (201):**
```json
{
  "slug": "calm-reef",
  "sourceSlug": "bold-canvas",
  "versionId": "550e8400-e29b-41d4-a716-446655440000",
  "siteUrl": "https://calm-reef.drophere.cc/",
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
  "slug": "bold-canvas",
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
  "slug": "bold-canvas",
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
  "slug": "bold-canvas",
  "visibility": "restricted",
  "allowedEmails": ["alice@acme.com"],
  "allowedDomains": ["acme.com"]
}
```

### Set View and Comment Permissions Atomically

```
PATCH /api/v1/artifact/:slug/permissions
```

**Auth:** Required (must be artifact owner)

Updates artifact view access and collaboration comment settings in one row update. Use this when an agent needs to change both gates without leaving an intermediate state.

**Body:**
```json
{
  "access": {
    "visibility": "restricted",
    "allowedEmails": ["alice@acme.com"],
    "allowedDomains": ["acme.com"]
  },
  "collaboration": {
    "enabled": true,
    "commentPolicy": "specific_accounts",
    "commentAllowedEmails": ["reviewer@acme.com"]
  }
}
```

**Response (200):**
```json
{
  "slug": "bold-canvas",
  "access": {
    "visibility": "restricted",
    "allowedEmails": ["alice@acme.com"],
    "allowedDomains": ["acme.com"]
  },
  "collaboration": {
    "enabled": true,
    "commentPolicy": "specific_accounts",
    "commentDomain": null,
    "commentAllowedEmails": ["reviewer@acme.com"]
  }
}
```

**Errors:**
| Status | Error |
|--------|-------|
| 400 | Invalid access or collaboration settings |
| 403 | You do not own this artifact |
| 404 | Artifact not found |
| 410 | Artifact has expired |

---

## Collaboration Comments

Artifacts can expose a private Drophere-hosted collaboration layer for anchored comments, replies, moderation, pasted image attachments, and agent access. Artifact visibility remains the outer read gate; comment write policy is configured separately.

### Set Collaboration

```
PATCH /api/v1/artifact/:slug/collaboration
```

**Auth:** Required (must be artifact owner)

**Body:**
```json
{
  "enabled": true,
  "commentPolicy": "same_domain",
  "commentDomain": "acme.com"
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `enabled` | `boolean` | Yes | Enables the isolated comment layer |
| `commentPolicy` | `string` | No | `"authenticated"` default, `"anyone"`, `"same_domain"`, or `"specific_accounts"` |
| `commentDomain` | `string | null` | No | Required for `same_domain` unless owner email has a valid organization domain |
| `commentAllowedEmails` | `string[] | null` | No | Required for `specific_accounts`; entries must be Drophere account emails |

Consumer domains such as `gmail.com` are rejected for `same_domain`.

### List Comments

```
GET /api/v1/artifact/:slug/comments?status=open
```

**Auth:** Viewer token from the artifact collaboration layer, or owner Bearer token.

**Response (200):**
```json
{
  "slug": "bold-canvas",
  "settings": {
    "enabled": true,
    "commentPolicy": "authenticated",
    "commentDomain": null,
    "commentAllowedEmails": null,
    "viewer": { "canComment": true, "message": null }
  },
  "comments": [
    {
      "id": "5fdd...",
      "status": "open",
      "anchorText": "important paragraph",
      "anchorStatus": "current",
      "messages": [
        {
          "id": "8f2c...",
          "body": "Can we clarify this?",
          "author": { "name": "Alice", "role": "owner" },
          "attachments": []
        }
      ]
    }
  ]
}
```

`settings.viewer.canComment` and each thread's `capabilities.canReply` reflect the current viewer's comment policy eligibility. When `canComment` is false, `message` contains the reason to show in the viewer UI.

### Comment Actions

```
POST   /api/v1/artifact/:slug/comments
POST   /api/v1/artifact/:slug/comments/:threadId/reply
PATCH  /api/v1/artifact/:slug/comments/:threadId
DELETE /api/v1/artifact/:slug/comments/:threadId
DELETE /api/v1/artifact/:slug/comments/:threadId/messages/:messageId
POST   /api/v1/artifact/:slug/comments/attachments
GET    /api/v1/artifact/:slug/comments/attachments/:attachmentId
```

Owners and owner-authenticated agents can moderate every thread. Commenters can delete only their own undeleted messages. Attachments are served through Drophere gates and never as direct public bucket URLs.

Agents should prefer the MCP tools for parity: `drophere_list_comments`, `drophere_add_comment`, `drophere_update_comment`, `drophere_delete_comment`, and `drophere_set_collaboration`.

### Legacy Annotation Compatibility

These owner-only routes remain as compatibility aliases backed by the threaded comment store:

```
GET   /api/v1/artifact/:slug/annotations?status=open
PATCH /api/v1/artifact/:slug/annotations/:id
```

`status` may be `open`, `resolved`, or `all` on reads. Patch accepts `{ "status": "open" }` or `{ "status": "resolved" }`.

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
{ "email": "alice@acme.com", "slug": "bold-canvas" }
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
{ "email": "alice@acme.com", "code": "ABCD-EFGH", "slug": "bold-canvas" }
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

Returns a compact list of API capabilities. Useful for agents to discover available features without reinstalling the skill or loading the full reference.

**Response (200):**
```json
{
  "version": "0.4.0",
  "capabilities": [
    { "name": "publish", "summary": "Upload static files to the web instantly", "endpoints": [...] },
    { "name": "vanity-artifact-urls", "summary": "Paid persistent artifacts can request a custom artifact subdomain at creation time", "endpoints": ["POST /api/v1/artifact"], "tools": ["drophere_publish_artifact", "drophere_create_static_site", "drophere_create_artifact"] },
    { "name": "collaboration", "summary": "Enable anchored comments, replies, moderation, and attachments", "endpoints": [...] },
    { "name": "artifact-tags", "summary": "Private artifact-level tags for knowledge discovery and agent search", "endpoints": [...], "tools": ["drophere_get_artifact_tags", "drophere_set_artifact_tags", "drophere_list_tags"] },
    { "name": "mcp", "summary": "Model Context Protocol wrapper over the REST/API and artifact store surfaces", "endpoints": [...], "tools": ["drophere_publish_artifact", "drophere_upload_file", "drophere_list_files", "drophere_get_file", "drophere_list_tags", "drophere_publish_uploaded_version", "drophere_save_uploaded_version", "drophere_deploy_saved_version"] }
  ],
  "docsUrl": "https://drophere.cc/skill/references/API.md",
  "markdownDocsUrl": "https://drophere.cc/skill/references/API.md",
  "htmlDocsUrl": "https://docs.drophere.cc/"
}
```

Cached for 1 hour (`Cache-Control: public, max-age=3600`).

---

## Handles

Handles provide a subdomain namespace: `handle.drophere.cc/location`.

### Handle vs. Vanity Artifact Slug

Both handles and vanity artifact slugs use the same `{name}.drophere.cc` subdomain namespace, but they are different products:

| Feature | URL shape | Purpose | Limits |
|---------|-----------|---------|--------|
| Vanity artifact slug | `https://client-demo.drophere.cc/` | One artifact gets the root subdomain directly | Paid persistent artifact, chosen only at creation time |
| Handle | `https://acme.drophere.cc/docs` | Account namespace that routes paths to one or more artifacts | One handle per account |

Decision rule for agents:

- User asks for `https://name.drophere.cc/` or `name.drophere.cc` for one artifact/site: create a persistent artifact with `slug: "name"`.
- User asks for `https://handle.drophere.cc/path`: use the existing handle plus a link, or claim a handle only if the user explicitly wants an account namespace.
- User asks for `example.com` or another non-Drophere hostname: use custom domains.

Do not claim or rename a handle when the user asks for a vanity artifact URL. Use the `slug` field on artifact creation instead.

The namespace is exclusive. A name already used by an artifact slug, retained vanity slug reservation, or handle cannot be claimed by the other mechanism. New generated artifact slugs also skip retained vanity reservations and handles, so there is no runtime precedence to choose for new claims. If a request conflicts, REST returns `409` with either `CUSTOM_SLUG_UNAVAILABLE` or `HANDLE_UNAVAILABLE`; agents should ask the user for the next name.

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
| Status | Code | Error |
|--------|------|-------|
| 400 | `HANDLE_INVALID` | Invalid handle format |
| 409 | `HANDLE_ALREADY_SET` | The account already has one handle. The response includes the current `handle`, `hostname`, and `nextAction` pointing single-site root URL requests to artifact `slug`. |
| 409 | `HANDLE_UNAVAILABLE` | The handle name is already used by a handle, artifact slug, or retained vanity reservation |

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
  "links": [{ "location": "docs", "slug": "bold-canvas" }]
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
  "slug": "bold-canvas",
  "domain": "example.com"
}
```

| Field | Required | Notes |
|-------|----------|-------|
| `location` | Yes | Path segment (e.g., `docs`, `blog`). Use empty string `""` for the bare root (`https://handle.drophere.cc/`). `__root__` is accepted as a compatibility alias and stored/returned as `""`. |
| `slug` | Yes | Target artifact slug |
| `domain` | No | Custom domain. If omitted, uses your handle |

**Response (201):**
```json
{ "namespace": "my-project", "location": "docs", "slug": "bold-canvas" }
```

**Root link recipe:** to serve an artifact at the bare handle URL, create a link with `location: ""`:

```bash
curl -X POST https://drophere.cc/api/v1/links \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{ "location": "", "slug": "bold-canvas" }'
```

That makes `https://my-project.drophere.cc/` resolve to the artifact. Add a second link such as `location: "docs"` only when you also want `https://my-project.drophere.cc/docs`.
For a custom-domain root, the canonical create/update and legacy `__root__`
cleanup run in one current-registration-locked database mutation. Cleanup
requires the canonical write to match successfully, so stale cleanup cannot
remove a root link from a replacement registration.

### List Links

```
GET /api/v1/links
```

**Auth:** Required

**Response (200):**
```json
{
  "links": [
    { "location": "", "slug": "bold-canvas", "namespace": "my-project", "namespaceType": "handle" },
    { "location": "docs", "slug": "bold-canvas", "namespace": "my-project", "namespaceType": "handle" }
  ]
}
```

Root links are listed with canonical `location: ""`, never `__root__`.

### Get Link

```
GET /api/v1/links/:location
GET /api/v1/link?location=docs
```

**Auth:** Required. Use `__root__` in the URL path when reading the root link because a path parameter cannot be empty, or use the query-style `/api/v1/link?location=` form for an empty location. The response returns canonical `location: ""`.

**Response (200):**
```json
{ "location": "docs", "slug": "bold-canvas" }
```

### Update Link

```
PATCH /api/v1/links/:location
PATCH /api/v1/link
```

**Auth:** Required

Use `PATCH /api/v1/links/__root__` to update the root link in path style, or `PATCH /api/v1/link` with `location` in the JSON body.

**Body:**
```json
{ "location": "docs", "slug": "new-slug" }
```

**Response (200):**
```json
{ "success": true }
```

### Delete Link

```
DELETE /api/v1/links/:location
DELETE /api/v1/link?location=docs
```

**Auth:** Required. Optional query param `?domain=example.com` for domain-scoped links. Use `DELETE /api/v1/links/__root__` to delete the root link in path style, or the query-style `/api/v1/link?location=` form for an empty location.

**Response (200):**
```json
{ "success": true }
```

---

## Domains

Agents can manage the full lifecycle with `drophere_register_domain`,
`drophere_list_domains`, `drophere_get_domain`, `drophere_refresh_domain`,
`drophere_detach_domain`, and `drophere_delete_domain`. These tools use the
same authenticated operations and return the same success and error fields as
the REST endpoints below.

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
  "ssl_status": "pending",
  "provider_status": "pending",
  "provider_ssl_status": "pending_validation",
  "provider_configured": true,
  "serving_ready": false,
  "dns_instructions": {
    "type": "CNAME",
    "name": "docs.example.com",
    "value": "fallback.drophere.cc",
    "note": "Point docs.example.com to fallback.drophere.cc."
  },
  "ownership_verification": {
    "type": "txt",
    "name": "_cf-custom-hostname.docs.example.com",
    "value": "..."
  },
  "ssl_validation_records": [],
  "verification_errors": [],
  "last_error": null,
  "last_checked_at": "2026-07-24T12:00:00.000Z"
}
```

Do not register `*.drophere.cc` names here. A request such as `drophelloworld.drophere.cc` returns `400` with `code: "DROPHERE_HOSTNAME_RESERVED"` and `suggestedSlug: "drophelloworld"`; create a persistent artifact with that `slug` instead.

Registration calls Cloudflare for SaaS and persists the returned hostname,
certificate, ownership, and DCV state. A local nonce is mirrored in Cloudflare
custom metadata and must match before Drophere adopts or deletes a provider
record. Cloudflare must enable Custom Hostname custom metadata for the account;
if metadata is unavailable, provisioning fails without falling back to a
hostname-only match. Provisioning uses a short database lease: concurrent live
claims are rejected, while a crashed claim becomes safely retryable. Each claim
has a fencing token and captures the current applied refresh generation, so an expired
request cannot overwrite newer provisioning completion or newer verified
provider evidence. A request timeout does not prove that Cloudflare cancelled
the server-side create. Ambiguous outcomes remain `provisioning_uncertain`,
retain their registration claim, and reject deletion even after the lease
expires. A later retry claims the row first, then clears that uncertainty only
after an exact hostname-and-nonce match is confirmed by an authoritative
provider read.
A domain
does not serve until its bound provider record
exists and both local and raw provider hostname/SSL statuses are `active`.
Apex domains require DNS-provider CNAME
flattening or Cloudflare's separate apex-proxying product; they are not
universally supported by an ALIAS record.

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
      "serving_ready": true,
      "created_at": "2026-03-11T10:00:00.000Z",
      "links": [{ "location": "docs", "slug": "bold-canvas" }]
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
  "serving_ready": true,
  "created_at": "2026-03-11T10:00:00.000Z"
}
```

### Refresh Domain Status

```
POST /api/v1/domains/:domain/refresh
```

**Auth:** Required

Reads the Cloudflare custom hostname, persists the provider readback, and
returns the same shape as Get Domain. Refresh does not rewrite cached link
snapshots, so it cannot resurrect a concurrently deleted or retargeted link.
When no provider hostname ID is stored, hostname search is discovery only;
Drophere reads the discovered exact ID again and validates its current hostname
and binding metadata before persisting it.
Refresh takes an exclusive two-minute claim with a monotonic generation and
captures the registration's immutable namespace ID and binding nonce.
Concurrent refresh and deletion attempts return
`409 CUSTOM_DOMAIN_OPERATION_IN_PROGRESS`. Every success, terminal failure,
and transient-error writeback requires the exact refresh token and rejects a
domain already claimed for deletion. An expired refresh response therefore
cannot overwrite deletion state or a same-owner replacement registration.
Pending, unbound, or failed state is fail-closed and removes stale routing KV.
Provider or configuration failures return `502` or `503` with a stable error
code and remain visible in later authenticated reads.
Refresh returns `409 CUSTOM_DOMAIN_OPERATION_IN_PROGRESS` without contacting
Cloudflare while a provisioning token exists or the row is
`provisioning_uncertain`. Only `POST /api/v1/domains` can claim and reconcile
an uncertain create after its lease expires.

### Detach Local Domain Registration

```
POST /api/v1/domains/:domain/detach
```

**Auth:** Required

**Response (200):**
```json
{
  "success": true,
  "local_only": true,
  "provider_untouched": true
}
```

This recovery operation removes the domain registration, its local links, and
routing cache without creating, updating, or deleting any Cloudflare record.
It is available for a failed foreign binding, for authoritative absence, and
for an uncertain create only after its provisioning lease expires. When the
provider record is discovered by hostname, Drophere performs an authoritative
read of that exact record before detaching. A live provisioning or refresh
claim returns `409 CUSTOM_DOMAIN_OPERATION_IN_PROGRESS`. If the provider record
still has this registration's exact hostname and binding nonce, detach returns
`409 CUSTOM_DOMAIN_PROVIDER_BINDING_MATCHES`; use normal deletion so provider
cleanup happens first. Provider errors leave local state intact for retry.

### Delete Domain

```
DELETE /api/v1/domains/:domain
```

**Auth:** Required

**Response (200):**
```json
{ "success": true }
```

Drophere removes the custom hostname and its certificates at Cloudflare before
deleting local links, database state, and KV. If provider deletion fails, local
ownership and routing state remain available for a safe retry. Provider metadata
must prove the record is bound to the local registration before deletion.
When the row has no stored provider hostname ID, hostname search is discovery
only: Drophere reads the discovered exact ID again and revalidates its current
hostname and binding metadata before sending the delete request.
If that binding no longer matches, Drophere marks the local domain failed and
purges routing KV without deleting the foreign provider record.
Deletion claims block new domain-link writes and provider refreshes while the
provider call is in progress. A live refresh claim blocks deletion. After
provider deletion, local links and the domain row are removed atomically,
preventing orphan routes from reappearing after re-registration.
Deletion returns `409 CUSTOM_DOMAIN_OPERATION_IN_PROGRESS` while a live
provisioning lease exists or while a create outcome remains
`provisioning_uncertain`. Provider request timeouts do not imply server-side
cancellation. After the lease expires, retry provisioning to reconcile the
exact hostname-and-nonce binding; deletion becomes available only after that
uncertainty is cleared.
Domain routing cache is bound to the registration's immutable namespace ID and
provider nonce; legacy or mismatched snapshots fail closed and are invalidated.
Repeated deletes succeed; KV cleanup after the database deletion is best effort.

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
  "message": "upload URL expired before upload finished",
  "slug": "bold-canvas",
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

## Slack Webhooks

These endpoints are called by Slack, not by regular API clients. Requests must include a valid Slack signature.

```
POST /api/slack/events
POST /api/slack/interact
```

`/api/slack/events` handles Slack URL verification, app mentions, and DM/group-DM message events. `/api/slack/interact` handles the message shortcut callback.

Slack-hosted artifacts are anonymous. By default they are restricted to the workspace's configured email domains; a `--public` mention option can publish without that restriction.

---

## Key-Value Store

Per-artifact key-value storage, accessible from the artifact's own origin. No authentication required — designed for public read/write from hosted apps (e.g., game leaderboards).

Store data belongs to the artifact itself, not its reusable slug. Deleting an artifact and later creating another with the same slug does not transfer the deleted artifact's keys. Artifacts created before this isolation was introduced retain access to their existing keys.

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

Keys must match: `^[a-zA-Z0-9._-:/]{1,480}$`

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

## MCP Server

drophere.cc exposes a native Model Context Protocol server at:

```
https://drophere.cc/mcp
https://drophere.cc/mcp/<apiKey>
```

Use the bearer-header form when the client supports custom headers:

```json
{
  "mcpServers": {
    "drophere": {
      "url": "https://drophere.cc/mcp",
      "headers": { "Authorization": "Bearer YOUR_API_KEY" }
    }
  }
}
```

The path-token form is available for clients that cannot set headers. Treat that URL as a secret.

### MCP Publishing

For small static/text artifacts, prefer `drophere_publish_artifact`. It accepts file content strings (`path`, `contentText` or `content`, `contentType`) and computes byte sizes internally, so clients do not need to pre-count bytes or base64 each file. `drophere_create_static_site` remains available as a compatibility alias for the same one-shot flow. Successful one-shot responses include `shareable: true`, a canonical `artifact` summary, `nextActions`, `entrypointUrl`, `hasIndexHtml`, and `htmlDetected`.

Use `drophere_create_artifact` / `drophere_update_artifact` for large files, binary files, or incremental deploys. Their responses distinguish:

Pass an explicit `client_request_id` on create and update mutations when a request may be retried. Drophere commits that key with the artifact or version in PostgreSQL, so the same key and request body recover the committed result even when the short-lived KV retry cache is unavailable.

- `mcpUploads` — call `drophere_upload_file` with the listed args. Use `contentText` for text files or `contentBase64` for exact bytes.
- `directHttpUploads` — direct HTTP `PUT` fallback for clients that can upload raw bytes.
- `nextStep` — concise instruction for the client path to follow.
- `siteUrlStatus: "pending_until_finalize"` and `doNotShareUntilFinalized: true` — the returned URL is reserved but not live until publish/finalize succeeds.
- `shareable` — the simplest readiness signal for whether the URL can be returned to the user.
- `operationState` — `pending_upload`, `ready_to_finalize`, `saved`, or `active`.
- `nextRecommendedAction` / `nextActions` — tool names and args for the next safe MCP step.
- `cleanup` — a `drophere_discard_pending_version` recipe for unwanted pending manifests. Pass both the artifact `slug` and the exact pending `versionId` from the read/create response; stale version IDs are rejected and cannot discard a newer upload.

Call `drophere_get_artifact` to inspect a pending version before publishing. Its `pendingVersion.files[]` entries include `manifestBytes`, `uploadedBytes`, `uploaded`, `sizeMatches`, and `ready`; `pendingVersion.readyToFinalize` flips true when the version can be published.

After publishing, use `drophere_list_files` to inspect the live manifest and `drophere_get_file` to read back deployed content. `drophere_get_file` returns `contentText` for UTF-8 text files and `contentBase64` for binary files, truncating large files in the tool response.

Status fields are intentionally distinct: `status` is the artifact row lifecycle, `operationState` is the MCP workflow state, and `siteUrlStatus` is public serving readiness.

After uploading every required file, call `drophere_publish_uploaded_version`.
`drophere_finalize_artifact` remains available as the compatibility name. For a
review-first release, call `drophere_save_uploaded_version`, inspect version
history, then call `drophere_deploy_saved_version` with the observed
`expectedCurrentVersionId`. The same deploy tool rolls back to older saved
versions.

For a bad pending version, update with a corrected manifest or call `drophere_discard_pending_version` with the exact observed `slug` and pending `versionId`. A stale version ID is rejected. If the artifact has saved versions but no live version, discard preserves those saved versions and removes only the expected pending upload. Delete the whole artifact only when removal is intended.

### MCP Tools

| Area | Tools |
|------|-------|
| Search/read | `drophere_search`, `drophere_fetch`, `drophere_list_artifacts`, `drophere_get_artifact`, `drophere_list_artifact_versions`, `drophere_list_files`, `drophere_get_file`, `drophere_get_artifact_access` |
| Library | `drophere_list_library_items`, `drophere_update_library_item`, `drophere_create_library_collection`, `drophere_list_library_collections`, `drophere_add_library_item_to_collection`, `drophere_suggest_library_routes`, `drophere_find_related_library_items` |
| Artifact write | `drophere_publish_artifact`, `drophere_create_static_site`, `drophere_create_artifact`, `drophere_update_artifact`, `drophere_publish_uploaded_version`, `drophere_save_uploaded_version`, `drophere_deploy_saved_version`, `drophere_finalize_artifact`, `drophere_claim_artifact`, `drophere_duplicate_artifact`, `drophere_refresh_uploads`, `drophere_update_artifact_metadata`, `drophere_discard_pending_version`, `drophere_delete_artifact` |
| Tags | `drophere_get_artifact_tags`, `drophere_set_artifact_tags`, `drophere_list_tags` |
| Edit grants | `drophere_create_edit_grant`, `drophere_list_edit_grants`, `drophere_revoke_edit_grant` |
| Upload | `drophere_upload_file` |
| Access | `drophere_set_artifact_access`, `drophere_set_artifact_password`, `drophere_unset_artifact_password` |
| Collaboration | `drophere_set_collaboration`, `drophere_list_comments`, `drophere_add_comment`, `drophere_update_comment`, `drophere_delete_comment` |
| Handles/links | `drophere_set_handle`, `drophere_get_handle`, `drophere_delete_handle`, `drophere_set_link`, `drophere_get_link`, `drophere_list_links`, `drophere_delete_link` |
| Custom domains | `drophere_register_domain`, `drophere_list_domains`, `drophere_get_domain`, `drophere_refresh_domain`, `drophere_detach_domain`, `drophere_delete_domain` |
| Variables | `drophere_set_variable`, `drophere_list_variables`, `drophere_delete_variable` |
| KV store | `drophere_kv_get`, `drophere_kv_set`, `drophere_kv_list`, `drophere_kv_delete` |

API-key rotation is deliberately not exposed via MCP.

---

## Visit Counters

Artifacts expose same-origin visit counts for public display and an owner API for dashboards.

### Embeddable Script

```html
<p><span data-drophere-visits="total">0</span> visits</p>
<p><span data-drophere-visits="today">0</span> today</p>
<script src="https://drophere.cc/c/visits.js" defer></script>
```

The script fetches `/_drophere/visits` from the artifact host and fills matching elements. Metrics: `total`, `today`, `last7d`, `unique7d`.

### Same-Origin Endpoint

```
GET /_drophere/visits
```

Inherits the artifact's password and email access gates.

**Response (200):**
```json
{
  "total": 12483,
  "today": 142,
  "last7d": 1109,
  "unique7d": 734
}
```

### Owner API

```
GET /api/v1/artifact/:slug/visits
```

**Auth:** Required (must own the artifact)

Returns the same JSON shape as `/_drophere/visits`.

---

## Download as Markdown

Artifact HTML can opt into agent-friendly Markdown downloads. This is off by default.

Enable at create time:

```json
{
  "files": [...],
  "viewer": { "markdownDownload": true }
}
```

Enable later:

```json
{
  "viewerMetadata": { "markdownDownload": true }
}
```

When enabled, append `?format=md` to any artifact HTML path:

```
GET https://bold-canvas.drophere.cc/?format=md
GET https://bold-canvas.drophere.cc/docs/guide.html?format=md
```

Markdown sources (`.md`, `.markdown`, or `text/markdown`) are served verbatim with attachment headers. HTML sources are converted best-effort.

Limits and errors:

| Status | Meaning |
|--------|---------|
| 404 | `markdownDownload` is not enabled or the source file does not exist |
| 413 | HTML input exceeds 2 MB |
| 415 | Source is neither HTML nor Markdown |
| 429 | Conversion rate limit exceeded (30/min/IP/slug) |

---

## Error Format

Errors always include a human-readable `error` string. Feature-specific errors may also include a stable machine-readable `code` and additional `details`.

```json
{
  "error": "Human-readable error message",
  "code": "OPTIONAL_STABLE_MACHINE_READABLE_CODE",
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
