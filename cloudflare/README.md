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

## Family sharing v4 — deploy only after schema and code are verified

This is a **separate second phase** after Cloudflare Access login. Existing sign-in works; it does not automatically grant tracking permission.

1. In Cloudflare **D1 → telemetry-family-db → Console**, execute [migrations/0004_family_sharing.sql](migrations/0004_family_sharing.sql), preserving line breaks. This creates `family_invites`, `family_shares`, `family_privacy`, `family_latest`, and `family_history`. No previous data is deleted.
2. Confirm with:
   ```sql
   SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'family_%' ORDER BY name;
   ```
3. Easiest from Windows: open **[deploy-family-api.js](deploy-family-api.js)** → **Raw**, copy the entire file into **telemetry-family-api → Edit code**, and click **Deploy**. This file combines `src/index.mjs` and `src/family.mjs` into one dashboard-compatible Worker. **Do not paste only index.mjs**, because it imports `family.mjs`. The existing `telemetry-family-auth` Worker stays unchanged.
4. In Zero Trust Access, add each participant's own verified email to `Telemetry Family Allow` only with their knowledge. They authenticate independently; GitHub ownership does not grant location access.
5. Build and install the updated iPhone app only after the API deploys, and test with two voluntary accounts.

### Consent model

- An authenticated owner creates an invitation **to an email address**. This MVP stores an invitation in D1 but **does not send an email**. Tell the invitee directly to sign into Telemetry.
- The invitee sees the invitation and may Accept or Decline. Accepting grants the inviter permission to view **only after the invitee separately turns on Share my location**.
- The owner may pause tracking or revoke a specific viewer at any time. History access checks current sharing and the viewer-specific consent timestamp. Only observations since consent can be retrieved.
- The server requires valid sessions on every endpoint. Devices upload their own coordinates only. No admin override or phone-number-only tracking is available.
- The Family Safety app is designed to show contacts, last known location, battery, and count of location-history observations. It does not yet implement an interactive history map, push notifications, or safe-zone notifications.
- iOS can delay location updates in the background. The app does not guarantee fixed reporting frequency.
- Keep the API behind Cloudflare's normal TLS and rate protections. A later production hardening phase should implement bounded data retention and abuse monitoring.

### Endpoint groups

`GET /v1/family/status`, `POST /v1/family/sharing`, `GET /v1/family/contacts`, `GET /v1/family/viewers`, `DELETE /v1/family/viewers/:id`, `GET|POST /v1/invites`, `POST /v1/invites/:id/accept`, `POST /v1/invites/:id/decline`, `POST /v1/location`, `GET /v1/family/contacts/:id/history`.

### Tests and release boundaries

Run `node --test cloudflare/tests/*.test.mjs` (two-account consent tests). These have been exercised locally with SQLite. A full iPhone build and physical two-phone acceptance test have **not** yet been verified. Since you require zero spending, do not start GitHub macOS builds without checking their included free compute allowance.
