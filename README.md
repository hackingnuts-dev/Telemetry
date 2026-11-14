# Telemetry — iPhone for Windows

**Internal Enterprise Device Telemetry & Location Tracking Solution**, with an optional consent-based Family Safety Network. **iOS only.**

This repository has one GitHub Actions workflow: **Telemetry iPhone for Windows**. No Android APKs, Android build workflow, or automated test-only GitHub workflow.

## Build your iPhone IPA

1. Open **[Telemetry iPhone for Windows](https://github.com/lazyKode/Telemetry/actions/workflows/telemetry-iphone-build.yml)**.
2. Click **Run workflow**, choose `main`, then run it.
3. Open the successful run and download the **Telemetry-iPhone-for-Windows** artifact under **Artifacts**.
4. Extract the GitHub ZIP. It contains `Telemetry-unsigned.ipa`, `BUILD-INFO.txt`, and `IPA-SHA256.txt`.
5. Use **Sideloadly on Windows** to sign `Telemetry-unsigned.ipa` with your own Apple ID and install it on an eligible iPhone. The unsigned IPA is not directly installable. Free Apple ID signing may need refreshing roughly every seven days.

The workflow is **manual only** so pushes to `main` do not automatically consume macOS Actions minutes. It runs unit tests, TypeScript, lint, and formatting checks, generates the iOS native project, installs CocoaPods, compiles the arm64 iPhone app, and uploads its IPA. If compilation fails it uploads **Telemetry-iPhone-Build-Diagnostics** when logs are available.

## iPhone features

- Opt-in foreground and background location, with iOS-controlled timing.
- SQLCipher-encrypted on-device observations; user-visible dashboard and battery status.
- Family Safety screen with phone OTP sign-in, invitations, contact list, and pause/revoke sharing controls.
- Family contacts can only be viewed after they verify their number and accept sharing. Knowing a phone number does not grant location access.
- App usage metadata remains unavailable until the necessary Apple entitlement and native implementation exist.

**Family networking is not live by default.** Deploy the opt-in service under [server/](server/README.md) with PostgreSQL, a valid HTTPS origin, and SMS provider configuration. Set the GitHub Actions repository variable `EXPO_PUBLIC_FAMILY_API_URL` to its HTTPS URL **before building**. Local device telemetry works without the family server, but invitations, shared contacts, and live maps require it.

The repository remains private. GitHub Actions may still be blocked by your account-level billing restriction, which cannot be resolved by changing the workflow. See [iPhone build guidance](docs/BUILD.md).

## Safety and privacy

Location collection starts off. Users control tracking and can pause sharing. The server enforces accepted relationships, and phone numbers are verified contact handles rather than authentication secrets. No screenshot recording or hidden monitoring is included.

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
