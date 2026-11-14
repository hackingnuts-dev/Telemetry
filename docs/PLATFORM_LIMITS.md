# Telemetry capability boundaries

## Phone numbers

Android: `TelephonyManager.getLine1Number()` was deprecated at API 33; `SubscriptionManager.getPhoneNumber(subscriptionId)` may still be empty and requires `READ_PHONE_NUMBERS`, default SMS app privileges, or carrier privileges. Not reliable with dual SIM or data-only SIM. This pilot does not request the permission or silently read a number.

iOS: standard third-party iOS apps cannot fetch the phone line's subscriber number. CoreTelephony carrier metadata is not `telephoneNumber` access. MDM servers may receive some managed device attributes, but there is no general entitlement-free in-app phone number API. Use voluntary employee input plus OTP verification.

Use a random installation ID for events and OIDC or device-bound credentials for authentication, not a phone number.

## Application usage

Android: `UsageStatsManager` is available with user-granted Usage Access, requiring a native adapter and clear disclosure. It is not implemented in this repository yet.

iOS: DeviceActivity/FamilyControls require approved entitlements and authorization and do not provide general unconstrained per-app activity logs. `SCScreenCapture` is not an appropriate passive metadata API. The UI therefore keeps **Enable App Telemetry** disabled, instead of pretending to collect data.

## Background limits

Android may throttle tasks under Doze and background service restrictions; foreground service has a visible notification. iOS determines scheduling and may suspend tasks. Battery usage of the agent must be benchmarked per OS/device, not inferred from the remaining battery level.

## Security constraints

This application does not include an authentication provider or telemetry server. The API client refuses non-HTTPS configuration and requires a token provisioned by a trusted SSO flow. Implement hardening, policy provisioning, token rotation, retention enforcement, observability, and enterprise review before production deployment.
