# Security

What protects ResuMaker once it's on the public internet, and the settings it depends on. The account model (sessions,
roles, invites, CSRF) is described in the README under *Accounts and security*. This file covers the deployment side.

## Refusing to start with unsafe settings

With `APP_ENV=production` the API checks its configuration at start (`Settings.problems()` in `backend/app/config.py`)
and stops, listing every problem, if:

- `PUBLIC_URL` is missing or not `https://` (cookies would not be marked `Secure`)
- `COOKIE_SECURE=false`
- `FRONTEND_URL` is missing (PDF rendering)
- `DATABASE_URL` has no password, or the local development one
- `REDIS_URL` has no password
- a `CORS_ORIGINS` entry is not `https://`

The database and Redis addresses have no built-in default anywhere: a forgotten variable fails loudly instead of
connecting somewhere unexpected.

## Network exposure

- Only the **web** service (nginx) has a public domain. The API, Postgres and Redis are reached over Railway's
  private network only. Locally, every published port is bound to `127.0.0.1`. `make stable-expose` opens the web
  port only.
- The API docs (`/docs`, `/redoc`, `/openapi.json`) are not served in production. Locally they aren't reachable through
  nginx either (only `/api/` is proxied).
- `/api/agent/graph` needs a signed-in user (it draws the agent's structure, no data). The only public endpoints are
  `/api/status`, sign-in, accept-invite and sign-out, and `tests/test_auth.py` fails if another one appears.
- The MCP server is not deployed. Over HTTP it binds to loopback by default and warns if told otherwise: it acts as
  one user without asking who is calling.

## Client addresses (per-IP sign-in limit)

The per-IP sign-in limit is only as good as the address it counts, which must be impossible to fake, and must not be
the proxy's own address for everyone:

1. **nginx** believes a client-address header only from `TRUSTED_PROXIES`, and only the header named by
   `REAL_IP_HEADER`. On Railway that's every peer (only the edge reaches the web service) and `X-Real-IP`, which the
   edge overwrites. With `X-Forwarded-For`, nginx takes the rightmost entry (the one the trusted proxy added), never one
   a client typed. Locally nobody is trusted: the TCP peer counts.
2. nginx then **overwrites** `X-Forwarded-For` with that single address. Whatever the client sent is not passed on.
3. **uvicorn** (`--proxy-headers`) only reads that header when the request comes from a private address (nginx,
   `FORWARDED_ALLOW_IPS`; it was `*` before). Anyone who did reach the API directly from outside would be counted by
   their real address.

`make stack` and a quick `curl -H 'X-Forwarded-For: 1.2.3.4' …/api/auth/login` show the real peer address in the API log.

## HTTP headers (nginx)

`Content-Security-Policy` (scripts from us only; styles and fonts also from Google Fonts; no framing), HSTS
(`max-age=1 year`, no `includeSubDomains`; browsers ignore it over plain http, so it's harmless on the local stacks),
`X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy`,
`Cross-Origin-Opener-Policy`, `server_tokens off`. They live in one file, `nginx/security-headers.conf`, included in
every location. API responses are `Cache-Control: no-store`.

Google Fonts means each visitor's browser contacts Google. Self-hosting the two font families would let the CSP drop
both Google origins. That's a follow-up.

## Containers

- The API runs as an unprivileged user (`app`, uid 10001). Chromium runs as that user without its own sandbox
  (containers have no user namespaces), so it is only ever pointed at our own frontend (`FRONTEND_URL`).
- The web image is `nginx-unprivileged` (uid 101), listening on `$PORT` (8080), not 80.

## Database

The Railway Postgres user is a superuser. To run the app with only what it needs, create the extension once as
`postgres`, then a role that owns the application schema and nothing else:

```sql
CREATE EXTENSION IF NOT EXISTS vector;            -- needs a superuser, once
CREATE ROLE resumaker LOGIN PASSWORD '…long random…';
GRANT CONNECT ON DATABASE railway TO resumaker;
GRANT USAGE, CREATE ON SCHEMA public TO resumaker; -- migrations create and alter tables
-- (if tables already exist, owned by postgres:)  REASSIGN OWNED BY postgres TO resumaker;  -- run in this database only
```

Then point the API's `DATABASE_URL` at `resumaker`. Redis on Railway has a password by default; production refuses to
start without one.

## Errors and logs

- Error responses carry a short, fixed message. PDF failures and Gemini errors (which can name the model, project or
  key state) are logged server-side, and the browser gets "PDF rendering failed" / "The AI request failed". Unexpected
  exceptions are a plain 500 or a generic stream error.
- Logs record failed sign-ins with the client address, admin account deletions by id, and warnings without request
  bodies. No passwords, tokens, CV content or sign-in emails. Invite tokens travel in the URL fragment, so no access
  log ever sees them.

## Limits (re-checked for this deployment)

| What | Limit |
|---|---|
| Sign-in / accept-invite | 20 attempts per client address per 10 min; an account locks for 15 min after 5 wrong passwords |
| AI endpoints | 30 calls per user per minute (`AI_RATE_LIMIT_PER_MIN`), checked after the entitlement check |
| CV import upload | 10 MB in the API (it reads at most 10 MB + 1 byte), 12 MB at nginx; other API bodies 5 MB |
| Sessions | 7 days idle, 30 days absolute; replaced at sign-in; all others end on a password change |
| PDF render session | 2 minutes, read-only, revoked right after the render |
| Invite links | 72 h, single use, stored hashed |

## Dependencies

CI runs `npm audit --audit-level=moderate` (dev tools included) and `pip-audit` against the exact versions in
`backend/uv.lock`, on every push and pull request.

## Reporting a problem

Please open a private security advisory on GitHub rather than a public issue.
