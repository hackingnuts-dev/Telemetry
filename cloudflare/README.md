# Cloudflare deployment staging — Telemetry Family

This directory prepares the D1 database schema and a safe connectivity-only Worker for the Cloudflare account.

**Current status:** The existing family API in `server/server.mjs` is a Node.js / Express / PostgreSQL server, **not** a Cloudflare Worker. The `src/index.ts` here only responds to `GET /health`, and returns HTTP 503 for all family APIs. Do not enable invitations, location sharing, or real user registration until the full authentication and access-control logic has been ported and integration tested.

## Existing resources

- Worker: `telemetry-family-api`
- D1: `telemetry-family-db`
- Worker binding: `DB`
- The database UUID is recorded in `wrangler.jsonc` from the Cloudflare dashboard.

## Set up D1

From this directory in a trusted local environment with Wrangler authentication:

```bash
npx wrangler d1 migrations apply telemetry-family-db --local
npx wrangler d1 migrations apply telemetry-family-db --remote
```

Review the SQL in `migrations/0001_initial.sql` before applying to production. Use one method only: Wrangler migrations are preferable to manually pasting into the D1 dashboard console because they track applied versions.

After applying, use the D1 dashboard Console and execute:

```sql
SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;
```

You should see `users`, `invitations`, `shares`, `location_history`, `safe_zones`, etc.

## Deployment

The default Worker in this folder is a **health-only placeholder**, not the Family API. It is intentionally not production-deployed through the GitHub iPhone workflow. Only deploy after you are ready to validate /health. The existing iPhone bundle must remain unconfigured for Family API until the complete backend is implemented, including server-side consent authorization, OTP verification, rate limiting, correct expiry, and secure session management.

No cloud secrets belong in this repository. Do not copy Twilio tokens or database credentials into Git.
