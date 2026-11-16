# Telemetry Family — Cloudflare Email Authentication

This directory contains the D1-backed Cloudflare Worker sign-in API. The live Worker must still be updated separately; committing code to GitHub does not deploy it.

## Existing Cloudflare resources

- Worker: `telemetry-family-api`
- D1: `telemetry-family-db` (binding `DB`)
- Production address: `https://telemetry-family-api.alankarsharma44.workers.dev`
- Main Worker source: [src/index.mjs](src/index.mjs)
- New migration: [migrations/0002_email_auth.sql](migrations/0002_email_auth.sql)

The original nine family tables are preserved. Migration `0002_email_auth.sql` adds `email_accounts`, `email_challenges`, `email_sessions`, and `email_auth_limits`. Email accounts are **deliberately separate** from legacy phone-only `users`: the family-sharing endpoints remain disabled until migrated and independently security-tested.

## 1. Apply the email-auth migration

Use **Cloudflare → Storage & databases → D1 → telemetry-family-db → Console**, then run the SQL in `migrations/0002_email_auth.sql`, preserving line breaks. If the Console accepts only one statement, execute one `CREATE TABLE` or `CREATE INDEX` statement at a time.

Verify:

```sql
SELECT name FROM sqlite_master
WHERE type='table' AND name LIKE 'email_%' ORDER BY name;
```

Expect all four tables listed above. Do not run the old `0001_initial.sql` again in the dashboard; the original schema already exists.

## 2. Set up an email sender

Preferred: **Cloudflare Dashboard → Compute → Email Service → Email Sending**. Onboard a domain you control in Cloudflare DNS; follow sender-domain verification instructions. Configure the Worker with a `send_email` binding named `EMAIL`. The repository's `wrangler.jsonc` declares this binding for CLI deployments; you must add/verify it on the live Worker too.

Set Worker **Settings → Variables and Secrets**:
- `EMAIL_FROM` (**plain text variable**): a verified sender address such as `login@yourdomain.com` (substitute your real domain)
- `AUTH_PEPPER` (**encrypted secret**): a newly generated random 32-byte-or-longer high-entropy value (do not commit, send, or screenshot it)
- `DB` (**D1 binding**): already connected to `telemetry-family-db`

As an optional alternative to Cloudflare Email Sending, the Worker can use a **secret** `RESEND_API_KEY` with a verified sender domain. Never expose this secret in iPhone `EXPO_PUBLIC_*` variables.

To generate an auth secret locally in Windows PowerShell:

```powershell
$bytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
[Convert]::ToBase64String($bytes)
```

Copy the output **privately** into Cloudflare's encrypted `AUTH_PEPPER` secret. Store or rotate it through secret management; rotating it invalidates unexpired codes and the rate-limiting identity hashes.

## 3. Deploy code and test

**Option A (Dashboard):** Open Worker → Edit code → replace the starter Worker code with the contents of `cloudflare/src/index.mjs` (Raw on GitHub). Click Deploy. The source is one self-contained JavaScript module.

**Option B (CLI):** From the `cloudflare/` directory, with Wrangler authenticated to the correct Cloudflare account:

```bash
npx wrangler deploy
```

The declared `DB` binding ID must match the live D1 database. Avoid deploying CLI configuration over dashboard-managed secrets/bindings without checking that settings are in sync.

Test:

`https://telemetry-family-api.alankarsharma44.workers.dev/health`

Expected: `databaseConnected: true`, `emailSchemaReady: true`, `emailSendingConfigured: true`, **`familySharingReady: false`**. A successful email-code request requires the `EMAIL_FROM` variable, `AUTH_PEPPER` secret, an email-sending binding/provider, and verified sender domain.

## 4. Email authentication endpoints

- `POST /v1/auth/email/start`: `{"email":"person@example.com"}` → `{"challengeId":"...","expiresInSeconds":600}`. A 6-digit code is sent **only** by email.
- `POST /v1/auth/email/verify`: `{"email":"person@example.com","challengeId":"...","code":"123456","name":"Name"}` → random bearer `token` and account info.
- `GET /v1/me`: `Authorization: Bearer <token>`
- `POST /v1/auth/logout`: revokes the same bearer token.

Codes have a 10-minute lifetime, up to five guesses per code, one-time consumption, and separate email/IP D1 rate limits. Sessions last seven days. Tokens are stored hashed in D1. Location access is **not** authorized through email sign-in alone. All family contact, location, invitation, history, and sharing endpoints intentionally respond with HTTP 503 until properly ported.

**Never publicly deploy test-code bypasses**, return a verification code in an API response, or store auth secrets in a repository.

## 5. iPhone application

Once sign-in is deployed and tested, add a GitHub Actions repository variable named `EXPO_PUBLIC_FAMILY_API_URL` with value:

`https://telemetry-family-api.alankarsharma44.workers.dev`

Then rebuild the manually triggered **Telemetry iPhone for Windows** IPA and install it via Sideloadly. The Family Safety screen will offer email sign-in, but **not** shared location until the authenticated and consent-protected family APIs are implemented.

## Automated checks

```bash
node --test cloudflare/tests/email-auth.test.mjs
```

These tests simulate D1 with SQLite locally and a mock sender. Live delivery, Worker deployment, and physical iPhone authentication are separate acceptance tests.

References:
- https://developers.cloudflare.com/email-service/get-started/send-emails/
- https://developers.cloudflare.com/email-service/api/send-emails/workers-api/
- https://developers.cloudflare.com/d1/worker-api/d1-database/
