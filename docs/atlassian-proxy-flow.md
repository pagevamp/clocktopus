# Atlassian OAuth Proxy Flow

## Why a proxy?

Atlassian's OAuth 2.0 (3LO) requires a `client_secret` for both token exchange and token refresh. Unlike Google (which has a "Desktop app" type where the secret is non-confidential), Atlassian treats all OAuth apps as confidential clients. This means we can't safely embed the secret in the published npm package or open-source code.

The solution: a lightweight Cloudflare Worker that holds the secret and proxies only the token-related requests.

## Architecture

```
User's browser                 Clocktopus (localhost)          Cloudflare Worker              Atlassian
     |                              |                              |                            |
     |  1. Click "Connect"          |                              |                            |
     |----------------------------->|                              |                            |
     |                              |  2. GET /auth-url            |                            |
     |                              |----------------------------->|                            |
     |                              |     { url: "https://..." }   |                            |
     |                              |<-----------------------------|                            |
     |  3. Redirect to Atlassian    |                              |                            |
     |--------------------------------------------------------------------->                    |
     |                              |                              |    4. User authorizes      |
     |  5. Callback with code       |                              |                            |
     |<---------------------------------------------------------------------                    |
     |----------------------------->|                              |                            |
     |                              |  6. POST /token              |                            |
     |                              |  { code, redirect_uri }      |                            |
     |                              |----------------------------->|                            |
     |                              |                              |  7. POST /oauth/token      |
     |                              |                              |  { code, client_id,        |
     |                              |                              |    client_secret, ... }     |
     |                              |                              |--------------------------->|
     |                              |                              |  { access_token, ... }     |
     |                              |                              |<---------------------------|
     |                              |  { access_token, ... }       |                            |
     |                              |<-----------------------------|                            |
     |  8. Connected!               |                              |                            |
     |<-----------------------------|                              |                            |
```

## What the proxy does

The Cloudflare Worker (`proxy/src/index.ts`) exposes two endpoints:

### `GET /auth-url?redirect_uri=...`

Returns the Atlassian authorization URL with the embedded `client_id`. The client never sees or needs the `client_id` — the proxy constructs the full URL.

**Response:**

```json
{
  "url": "https://auth.atlassian.com/authorize?audience=api.atlassian.com&client_id=...&scope=...&redirect_uri=...&response_type=code&prompt=consent"
}
```

### `POST /token`

Proxies token requests to Atlassian, injecting `client_id` and `client_secret`. Supports two grant types:

**Authorization code exchange:**

```json
{
  "grant_type": "authorization_code",
  "code": "<auth_code>",
  "redirect_uri": "http://localhost:4001/api/jira/callback"
}
```

**Token refresh:**

```json
{
  "grant_type": "refresh_token",
  "refresh_token": "<refresh_token>"
}
```

Both return the Atlassian token response as-is.

## What the proxy does NOT do

- It does not store any user tokens or data
- It does not access any Atlassian APIs on behalf of users
- It does not see the user's Jira data
- It only adds `client_id` and `client_secret` to token requests and forwards them

## Security

- The `client_secret` is stored as a Cloudflare Worker secret (encrypted at rest, never visible in logs or dashboard)
- The `client_id` is in `wrangler.toml` (public, non-sensitive)
- CORS headers allow any origin (`*`) since the proxy only talks to Atlassian's token endpoint
- Users' access/refresh tokens pass through the proxy but are not stored

## Local credential override

If a user has their own `ATLASSIAN_CLIENT_ID` and `ATLASSIAN_CLIENT_SECRET` configured (via the DB or environment), the app bypasses the proxy entirely and talks to Atlassian directly. See `lib/atlassian.ts` — `hasLocalCredentials()` checks this.

## Deployment

The proxy is deployed as a Cloudflare Worker:

```bash
cd proxy
bun install
npx wrangler deploy
```

Set the secret (one-time):

```bash
npx wrangler secret put ATLASSIAN_CLIENT_SECRET
# Paste the secret when prompted
```

### Configuration

- `wrangler.toml` — Worker name, client ID (public)
- `ATLASSIAN_CLIENT_SECRET` — set via `wrangler secret put` (encrypted)

### URL

The deployed worker URL is configured in `lib/atlassian.ts`:

```typescript
const AUTH_PROXY_URL = 'https://clocktopus-auth.clocktopus.workers.dev';
```

## Cost

Cloudflare Workers free tier: 100,000 requests/day. Each OAuth flow uses 2 requests (auth-url + token exchange). Token refreshes use 1 request each. This is more than sufficient for any number of users.
