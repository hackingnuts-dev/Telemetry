# Enterprise API contract

All endpoints require TLS 1.3 and an enterprise OIDC access token. A server must verify the token's issuer, audience, signature, role, tenant, and expiry, and enforce device-to-user authorization. The mobile client does not contain a shared API secret.

`POST /v1/phone/request-verification`

```json
{"deviceId":"install-uuid","phoneNumber":"+12025550123"}
```

Server sends a one-time code via a real verification provider, after per-user/per-IP rate limiting. Do not disclose account registration status in responses. Store normalized phone numbers encrypted and enforce short verification expiry.

`POST /v1/phone/verify`

```json
{"deviceId":"install-uuid","phoneNumber":"+12025550123","code":"123456"}
```

The server validates the OTP with its provider and binds the **verified** number to the authenticated employee and independent device record. A phone number must not be treated as a login credential. Never accept a client `verified` boolean as proof.

`POST /v1/telemetry/batches`

```json
{
  "deviceId":"install-uuid",
  "batchId":"unique-idempotency-key",
  "events":[
    {"id":"event-uuid","type":"zone_enter","deviceId":"install-uuid",
     "latitude":40.0,"longitude":-73.0,"occurredAt":1790000000000,"zoneId":"site-a"}
  ]
}
```

Server response (`200 OK`):

```json
{"acknowledgedIds":["event-uuid"]}
```

Acknowledge only events durably stored, idempotent by event ID and tenant. Validation errors must be reported separately. The server derives the associated employee and **verified** phone number from enrollment records, not from arbitrary numbers supplied on every event. Use pagination, batch quotas, per-device rate limits, privacy-controlled dashboards, and audit logs.

`GET /v1/devices/config`: policy-authorized geofences: `[{"id":"site-a","latitude":40.0,"longitude":-73.0,"radiusMeters":250}]`. Production must validate issuer and signature and call `setApprovedZones()` after fetching. No geofences are hard-coded in this pilot; stationary dwell events can still be recorded when location collection is enabled.

`GET /v1/devices/status` and `POST /v1/devices/health` are proposed future server capabilities, not called by this client.

## Authentication integration still required

Use enterprise SSO/OIDC or MDM-issued device-bound access, provision tokens using `setEnterpriseTokenFromTrustedLogin()` from a trusted login callback, and handle refresh/rotation. This repository does **not** implement a complete SSO redirect/authentication screen or an OTP-sending server.

## Phone verification response contract

`POST /v1/phone/request-verification` accepts an authenticated deviceId and explicitly entered E.164 phoneNumber. It sends a rate-limited OTP without logging the full number. `POST /v1/phone/verify` requires the same deviceId and number plus the user-supplied code; on confirmed success it **must return HTTP 200 with `{ "verified": true }`**. A 200 response without that flag is rejected by the client. Device identity and server authentication must not rely on the phone number alone.
