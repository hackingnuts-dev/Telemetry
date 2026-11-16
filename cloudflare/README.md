# Telemetry Family — Free Cloudflare Access dual-Worker sign-in

**Current state:** Cloudflare Access has been enabled for `telemetry-family-auth` using the existing `Telemetry Family Allow` policy. The Worker is still the Cloudflare starter application until you paste and deploy the new auth code. The main `telemetry-family-api` remains a separate Worker with D1 binding `DB`, and must receive its updated session code.

No domain, SMS service, Cloudflare Workers Paid, or Resend subscription is required for this design.

## Architecture

- `telemetry-family-auth.alankarsharma44.workers.dev`: **all traffic protected by Access**. Cloudflare authenticates One-time PIN email and provides `ctx.access.getIdentity()`. Source: [src/auth.mjs](src/auth.mjs).
- `telemetry-family-api.alankarsharma44.workers.dev`: public reachable API, with its own authenticated D1-backed sessions. Source: [src/index.mjs](src/index.mjs).
- Both Workers bind the **same existing** `telemetry-family-db` as `DB`. No new database or service token is required. The auth Worker writes only one-time hashed exchange data; the API Worker consumes it exactly once.
- The iPhone opens the Access-protected auth Worker in the iOS system authentication browser; the code redirects to `telemetry://family-auth`; app exchanges it at the separate Family API Worker.

## Setup order

1. Confirm Access protection: visit `https://telemetry-family-auth.alankarsharma44.workers.dev` in a private browser; email One-time PIN should be requested. The existing policy currently allows only the configured email; later add family emails explicitly.
2. In Cloudflare **D1 → telemetry-family-db → Console**, run [migrations/0003_access_exchange.sql](migrations/0003_access_exchange.sql), then verify `SELECT name FROM sqlite_master WHERE name='access_login_codes';`. The other email and family tables are already present.
3. Open **telemetry-family-auth → Settings → Bindings → Add binding → D1**. Set the variable name **`DB`** and select **`telemetry-family-db`**. This is the SAME database already bound to the Family API. Do not create a second database.
4. In **telemetry-family-auth → Edit code**, replace Hello World with the complete contents of [src/auth.mjs](src/auth.mjs) and Deploy. The Access policy remains attached.
5. In **telemetry-family-api → Edit code**, replace the temporary health-check Worker with [src/index.mjs](src/index.mjs) and Deploy. Its existing `DB` binding must remain.
6. Test `https://telemetry-family-api.alankarsharma44.workers.dev/health`; expect `databaseConnected: true`, `accessSchemaReady: true`, and `familySharingReady: false`.
7. Under **GitHub → hackingnuts-dev/Telemetry → Settings → Secrets and variables → Actions → Variables** configure:
   - `EXPO_PUBLIC_FAMILY_API_URL`: `https://telemetry-family-api.alankarsharma44.workers.dev`
   - `EXPO_PUBLIC_FAMILY_AUTH_URL`: `https://telemetry-family-auth.alankarsharma44.workers.dev`
8. Rebuild manually via the iPhone for Windows workflow and install with Sideloadly. Do not run a build until you are ready to spend your remaining included Actions minutes.

## Security requirements

- Do **not** configure Access on `telemetry-family-api`; doing so would return browser sign-in pages for ordinary app requests.
- A Cloudflare Access-protected Worker receives verified email via `ctx.access.getIdentity()`; this context does **not** automatically propagate to another Worker. The shared D1 exchange is how the two Workers communicate without trusting unverified HTTP headers.
- The 90-second exchange code is cryptographically tied to the iPhone's state and a SHA-256 verifier challenge, consumed once, and exchanged for a revocable 24-hour app session.
- No credentials, Resend API keys, or `AUTH_PEPPER` are needed for this Access configuration.
- **Family invitations, location uploads, maps, history, and consent-based sharing are not deployed yet.** Those endpoints fail closed. The two-Worker authentication pilot cannot be treated as functioning family tracking.

## Local integration tests

```bash
node --test cloudflare/tests/access-auth.test.mjs
```

Checks include rejecting fake identity headers, refusing location uploads, single-use code exchange, verified-email mapping, session authorization and logout.

Cloudflare reference: https://developers.cloudflare.com/workers/configuration/cloudflare-access/
