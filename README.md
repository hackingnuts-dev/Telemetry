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
- Family Safety screen with **email OTP sign-in** (requires a configured Cloudflare Email Sending service).
- Family invitations and location sharing remain **disabled** until the Cloudflare API supports verified consent and access control.
- App usage metadata remains unavailable until the necessary Apple entitlement and native implementation exist.

**Email sign-in is staged, not deployed.** The new Cloudflare Worker implementation and D1 migration are in [cloudflare/](cloudflare/README.md). Configure a verified sender, an email binding, the `AUTH_PEPPER` secret, and the new auth tables before deploying the Worker. The previous Node/PostgreSQL SMS server remains under `server/` as legacy source only. Family invitations, shared contacts, and live maps are not operational yet.

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
