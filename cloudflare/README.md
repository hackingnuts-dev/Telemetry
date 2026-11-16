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

## 2. Free-only email verification setup

**Do not purchase Workers Paid.** Cloudflare Email Sending for arbitrary recipients requires Workers Paid. Telemetry uses the optional **Resend Free** transactional email API instead, which offers 3,000 emails/month with a 100/day limit. Do not subscribe to Pro or turn on pay-as-you-go. When the free quota is exhausted, sending should stop rather than automatically incurring overages. See https://resend.com/pricing.

For real family addresses, Resend requires verifying a sender domain that you **already own**. An existing domain configured with Cloudflare DNS can be used without upgrading Cloudflare. If you do not own a domain, this setup is **not yet a zero-cost way to send email to arbitrary family addresses**; do not buy one without deciding to spend money. Resend's test sender is limited to test recipients and cannot be used for general family onboarding.

1. Sign up for Resend Free: https://resend.com
2. Add and verify a domain you already own (follow Resend SPF/DKIM instructions in Cloudflare DNS).
3. Generate a Resend API key restricted to email sending; do not commit or share it.
4. In **Cloudflare Worker → Settings → Variables and Secrets**, set:
   - `RESEND_API_KEY`: **encrypted secret**, your Resend API key
   - `AUTH_PEPPER`: **encrypted secret**, a locally generated high-entropy value (at least 32 characters)
   - `EMAIL_FROM`: **text variable**, sender address at your verified domain (for example `login@YOUR-OWN-DOMAIN`)
   - `DB`: existing D1 binding `telemetry-family-db`.
5. There is **no Cloudflare Email Sending binding**. Do not add a binding named `EMAIL`, and do not click **Purchase Workers Paid**.

Generate a random `AUTH_PEPPER` locally in PowerShell (never paste the result in chat):

```powershell
$bytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
[Convert]::ToBase64String($bytes)
```

Keep secrets out of any `EXPO_PUBLIC_*` variable and GitHub repository. These `EXPO_PUBLIC_*` variables are embedded in the iPhone application.

## 3. Deploy code and test

**Option A (Dashboard):** Open Worker → Edit code → replace the starter Worker code with the contents of `cloudflare/src/index.mjs` (Raw on GitHub). Click Deploy. The source is one self-contained JavaScript module.

**Option B (CLI):** From the `cloudflare/` directory, with Wrangler authenticated to the correct Cloudflare account:

```bash
npx wrangler deploy
```

The declared `DB` binding ID must match the live D1 database. Avoid deploying CLI configuration over dashboard-managed secrets/bindings without checking that settings are in sync.

Test:

`https://telemetry-family-api.alankarsharma44.workers.dev/health`

Expected: `databaseConnected: true`, `emailSchemaReady: true`, `emailSendingConfigured: true`, **`familySharingReady: false`**. A successful email-code request requires the `EMAIL_FROM` variable, `AUTH_PEPPER` secret, a valid Resend Free key, and verified sender domain.

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

- https://resend.com/pricing
- https://developers.cloudflare.com/d1/worker-api/d1-database/
