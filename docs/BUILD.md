# Telemetry — iPhone for Windows only

The **only active build workflow** is [Telemetry iPhone for Windows](https://github.com/hackingnuts-dev/Telemetry/actions/workflows/telemetry-iphone-build.yml).

- It is **manual**: **Actions → Telemetry iPhone for Windows → Run workflow → main**.
- Uses a GitHub-hosted Mac with Xcode, installs Expo/CocoaPods, builds an unsigned arm64 iPhone app, and packages `Telemetry-unsigned.ipa`.
- Find the `Telemetry-iPhone-for-Windows` download in a successful run's **Artifacts** section. Download ZIP, extract IPA, and sign/install on Windows with Sideloadly.
- The app is _not_ automatically signed or installable on every iPhone; signing and Apple provisioning rules still apply.
- Failure diagnostics (when available) appear as `Telemetry-iPhone-Build-Diagnostics`.
- GitHub Actions usage may be blocked by account billing. A billing restriction prevents any hosted runner from starting, even when the workflow YAML is valid.

No Android builds or other CI workflows remain. Source-level family tests remain in `server/tests/` and can be executed locally using PostgreSQL.

## Optional family backend

The source includes `server/`, but does not deploy it for you. Set up PostgreSQL, HTTPS, Twilio credentials and the mobile install URL. Add repository Actions variable `EXPO_PUBLIC_FAMILY_API_URL` before building an iPhone IPA to connect it. Details: [server/README.md](../server/README.md).
