# Telemetry Family — Cloudflare Access Free

Cloudflare Access One-time PIN sends email codes, no email sending provider or domain purchase. The new Worker source is `src/index.mjs`.

**Do not create the currently drafted Worker-wide Access application.** Worker-wide protection blocks the iPhone's public token-exchange endpoint and WebSocket upgrades. Cloudflare documents hostname/path-specific Access separately.

## 1. Create a path-scoped Access application

Cancel the unsaved **Workers**-destination application form. Keep the existing reusable policy `Telemetry Family Allow` with only your approved email addresses.

Create a new **Self-hosted and private → Public DNS / public hostname** Access application, if your account offers it for `workers.dev` routes:
- Hostname: `telemetry-family-api.alankarsharma44.workers.dev`
- Path: `/auth/access/complete` **only**
- Policy: `Telemetry Family Allow`
- Identity provider: `One-time PIN`
- Name: `Telemetry Family Sign-in`

Verify Access protects this exact path and leaves `/health` and `/v1/auth/access/exchange` outside Access. Cloudflare's official documentation supports specific path-protected `workers.dev` hostnames; your dashboard may render the fields differently. Never use an Everyone / Bypass rule.

## 2. Database migration

The existing four `email_*` tables are reused. In Cloudflare D1 Console, execute the SQL from `migrations/0003_access_exchange.sql`. Verify:
```sql
SELECT name FROM sqlite_master WHERE name='access_login_codes';
```

## 3. Worker deployment

After setting up the path-based Access application, copy the **Raw** contents of `src/index.mjs` into the existing `telemetry-family-api` Worker's editor and deploy it (or deploy with Wrangler using `wrangler.jsonc`). The existing D1 binding `DB` must remain attached.

No Resend key, `AUTH_PEPPER`, Cloudflare Email Sending, or paid service is needed for Access email OTP.

## 4. Sign-in security

The iPhone uses the system authentication browser (`ASWebAuthenticationSession`). Access validates email sign-in on the protected path. The Worker reads identity only through `ctx.access`, then creates a **90-second one-time exchange code** tied to a cryptographic proof verifier and client state. The code is returned to `telemetry://family-auth`; the iPhone exchanges it for a short-lived, hashed, revocable D1-backed app session.

Only the browser-login path is protected by Access. All public API endpoints independently require a valid app session token; all family invitation, location, sharing, and history endpoints continue to return HTTP 503 until their per-user consent ACLs are implemented.

## 5. iPhone build

Set GitHub Actions variable `EXPO_PUBLIC_FAMILY_API_URL` to `https://telemetry-family-api.alankarsharma44.workers.dev`, run the manual iPhone workflow, and install the resulting signed-by-Sideloadly app.

**Acceptance testing:** verify (1) browser email OTP login with an allowed address, (2) disallowed address denied by Access, (3) app token exchange succeeds once only, (4) `/v1/me` requires token, (5) logout revokes token, and (6) `/v1/location` remains unavailable.

Cloudflare docs: https://developers.cloudflare.com/workers/configuration/cloudflare-access/
