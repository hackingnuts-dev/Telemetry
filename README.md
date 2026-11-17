# Telemetry — iPhone for Windows

**Internal Enterprise Device Telemetry & Location Tracking Solution**, with an optional consent-based Family Safety Network. **iOS only.**

This repository has one GitHub Actions workflow: **Telemetry iPhone for Windows**. No Android APKs, Android build workflow, or automated test-only GitHub workflow.

## Build your iPhone IPA

1. Open **[Telemetry iPhone for Windows](https://github.com/hackingnuts-dev/Telemetry/actions/workflows/telemetry-iphone-build.yml)**.
2. Click **Run workflow**, choose `main`, then run it.
3. Open the successful run and download the **Telemetry-iPhone-for-Windows** artifact under **Artifacts**.
4. Extract the GitHub ZIP. It contains `Telemetry-unsigned.ipa`, `BUILD-INFO.txt`, and `IPA-SHA256.txt`.
5. Use **Sideloadly on Windows** to sign `Telemetry-unsigned.ipa` with your own Apple ID and install it on an eligible iPhone. The unsigned IPA is not directly installable. Free Apple ID signing may need refreshing roughly every seven days.

The workflow is **manual only** so pushes to `main` do not automatically consume macOS Actions minutes. It runs unit tests, TypeScript, lint, and formatting checks, generates the iOS native project, installs CocoaPods, compiles the arm64 iPhone app, and uploads its IPA. If compilation fails it uploads **Telemetry-iPhone-Build-Diagnostics** when logs are available.

## iPhone features

- Opt-in foreground and background location, with iOS-controlled timing.
- SQLCipher-encrypted on-device observations; user-visible dashboard and battery status.
- Family Safety sign-in via **Cloudflare Access One-time PIN** using the iPhone system browser (no domain purchase, SMS, or external email provider).
- Family email invitations, per-person reciprocal sharing permissions, explicit sharing pause, and authorized location history are available in the Cloudflare backend after deploying the latest bundle.
- App usage metadata remains unavailable until the necessary Apple entitlement and native implementation exist.

**Cloudflare Access iPhone sign-in was validated on a physical iPhone.** See [cloudflare/](cloudflare/README.md). Cloudflare Access now protects the dedicated `telemetry-family-auth` Worker; `telemetry-family-api` remains separate. The migration `0003_access_exchange.sql` and a `DB` binding on the auth Worker are required before deployment. The previous Node/PostgreSQL SMS server remains under `server/` as legacy source only. Family invitations and shared last-known positions require the updated Cloudflare Family API bundle; interactive moving maps, push alerts, and geofences remain future work.

The repository is publicly visible; never commit private email addresses, session tokens, or API secrets. GitHub Actions may still be blocked by your account-level billing restriction, which cannot be resolved by changing the workflow. See [iPhone build guidance](docs/BUILD.md).

## Safety and privacy

Location collection starts off. Users control tracking and can pause sharing. Email sign-in grants no location access. A future family-sharing API must check accepted relationships on every request. No screenshot recording or hidden monitoring is included.

## Development

```bash
npm install
npm test
npm run typecheck
npm run lint
npm run format:check
npx expo prebuild --platform ios --clean
```

Native iPhone builds require macOS/Xcode. The GitHub workflow supplies this environment once runner access is available.

## Zero-spend requirement

Do not purchase Workers Paid, email delivery services, a domain, or any GitHub subscription. Cloudflare Access Free handles One-time PIN emails. Workers and D1 have separate free quotas and may stop working when allowance is exhausted. GitHub-hosted iPhone builds can incur charges beyond included minutes; keep manual builds and review GitHub billing before running one. No unlimited-cost guarantee is possible.

## Current authentication architecture

The protected browser endpoint is `/auth/access/complete`, on `telemetry-family-auth.alankarsharma44.workers.dev`. The Worker uses Cloudflare's authenticated identity through `ctx.access`, then redirects a 90-second code to the app; the app uses proof-of-possession and a one-time exchange for a short-lived session. **Protect the dedicated auth Worker only**. The separate Family API Worker must use its own authenticated session checks. Location uploads are permitted only while the owner has explicitly enabled sharing and authorized one or more viewers.

For iPhone auth, configure BOTH `EXPO_PUBLIC_FAMILY_API_URL` and `EXPO_PUBLIC_FAMILY_AUTH_URL` in GitHub Actions repository variables before building. See [Cloudflare setup](cloudflare/README.md).

## Family safety — two-way sharing and map locations

The current implementation displays **My last known location** and **Family last shared locations** together on the iPhone dashboard, with coordinates, the last-reported timestamp, and links to **Apple Maps** and **Google Maps**. The app polls for family updates every 30 seconds while foregrounded, but this is *not* guaranteed instantaneous GPS tracking: iOS controls background callbacks, and maps opened through external links show a snapshot, not a self-moving live marker.

### To enable reciprocal visibility

Inviting A to see B originally created **B → A** sharing only. The updated Family Safety screen offers **Allow them to see my location** on a contact that already shares with you. The owner must tap Allow and separately turn on their **Share my location** switch. Each person may pause or revoke access independently. The server accepts no phone-number-only requests to track a device.

### The Refresh family locations button

This is a Family API operation, **not** the legacy enterprise `/v1/telemetry/batches` outbox. It refreshes authorized contacts and, if Location permission is enabled, refreshes your own local coordinate. It uploads your location only if sharing is explicitly on and at least one viewer is authorized. Legacy zone/dwell event logs stay encrypted locally unless a *separate* corporate event server is configured.

### Phone number limitations

iOS cannot reliably read a SIM's primary number. No service can locate a phone simply because you enter its number. Telemetry uses **Cloudflare Access verified email + accepted sharing consent** as identity and authorization; optional phone enrollment would require its own proof-of-possession verification and is not implemented in the free Family Safety pilot.

### Deploying the latest features

1. Keep `telemetry-family-auth` unchanged.
2. In **telemetry-family-api → Edit code**, paste the **Raw** contents of [cloudflare/deploy-family-api.js](cloudflare/deploy-family-api.js) and deploy. It includes the authenticated `POST /v1/family/contacts/:id/share-back` endpoint.
3. The D1 schema from `0004_family_sharing.sql` must already be applied.
4. Run the single manual [Telemetry iPhone for Windows workflow](https://github.com/hackingnuts-dev/Telemetry/actions/workflows/telemetry-iphone-build.yml), only within your included GitHub Actions allowance, install its IPA using Sideloadly, and test with two authorized, consenting iPhones.

For further detail, see [Cloudflare deployment instructions](cloudflare/README.md).
