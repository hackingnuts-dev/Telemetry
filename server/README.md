# Telemetry Family Service

Node 22 + PostgreSQL and Twilio Verify. The phone number is a **verified unique contact lookup**, not the database primary key, password, or device ID. Users have immutable random UUIDs. A family admin cannot see a contact until the contact authenticates their own phone and explicitly accepts sharing; **Pause Sharing** blocks all other viewers immediately (including history). The invited person can revoke individual grants.

## Run locally

1. Create a PostgreSQL database and populate `DATABASE_URL` from `.env.example`.
2. `cd server && npm install && npm run db:init && npm test`
3. Configure Twilio Verify + an SMS sender, `PUBLIC_APP_URL`, and run `npm start`.
4. Put HTTPS/TLS 1.3 in front of port 8787; supply a real hostname, secrets manager and rate-limiting/WAF.
5. Configure your iPhone build's `EXPO_PUBLIC_FAMILY_API_URL` to the HTTPS API address, rebuild and install.
6. Serve the web dashboard from the backend's root URL. WebSocket uses one-time 30-second tickets.

**API:** `/v1/auth/start`, `/v1/auth/verify`, `/v1/invites`, `/v1/invites/:id/accept`, `/v1/invites/:id/decline`, `/v1/family/sharing`, `/v1/family/contacts`, `/v1/family/contacts/:id/history`, `/v1/location`, `/v1/zones`, `/v1/alerts`, `/v1/live-ticket`. Every protected endpoint requires a bearer session issued by phone OTP. OTP is never returned in a production response.

**Development mode:** test SMS codes are returned only when `NODE_ENV=test` and `ALLOW_TEST_OTP=true`. Never deploy this mode publicly. Device-to-device integration requires provisioning a PostgreSQL service and SMS provider; this repository does not deploy either automatically.

**Production gaps:** Add scheduled 24h retention sweeps, device-bound refresh sessions, Twilio webhook/abuse controls, security monitoring and platform-specific push (APNs/FCM). WebSockets deliver live updates while the dashboard is connected, not background push notifications. Optimize database/history query limits and geofence transitions under concurrent device updates before large-scale rollout.

A viewer may define a safe zone only for a person who currently shares with them. Alerts go only to the creator while that sharing relationship remains authorized. Production geofences should add hysteresis and concurrent update serialization.

**SMS invite download link:** Set `MOBILE_INSTALL_URL` to a real, authorized HTTPS TestFlight, MDM, or internal installer page. A private GitHub Actions artifact URL is not usable for recipients who lack repository access. If unset, the invitation links to the web dashboard only.
