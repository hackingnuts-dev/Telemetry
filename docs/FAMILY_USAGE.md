# Telemetry Family — testing two-way visibility

**No phone-number lookup:** Knowing a person's telephone number does not give access to their GPS. Both people must install the app, log in using their own Cloudflare Access email, and choose what to share.

1. One person creates an invitation for the other's authorized email. The recipient signs in and accepts. They must also enable **Share my location** to send any coordinates.
2. The recipient's position should become visible under **Family last shared locations**, with coordinates and Apple Maps / Google Maps links. Each pin is the latest server observation, not continuously moving inside the external map.
3. For **two-way** visibility, the other person opens **Connected contacts**, taps **Allow them to see my location** and confirms. They also enable their own **Share my location** switch.
4. Press **Refresh family locations** to fetch the newest authorized reports. A fresh fix from the current iPhone uploads only while its owner has opted in, authorized viewers exist, and location permission is enabled.
5. Pause sharing, then verify the other device stops seeing coordinates/history. Revoking a viewer removes their access even if your global sharing remains on.

## Limitations

- Foreground polling approximately every 30 seconds does not guarantee new GPS fixes every 30 seconds; timestamps show when each fix was actually reported.
- iOS may delay background updates substantially. No stealth or background location bypass is used.
- External Apple/Google Maps links show the last coordinate. A future in-app MapKit screen would be needed for an automatically moving map marker.
- The **LOCAL EVENT LOG** is separate from Family Safety and can remain on the phone when no corporate endpoint exists.
- Family Safety currently authenticates via verified **email**, not SMS or a primary phone number.
- This sharing release must be deployed separately to the Cloudflare Family API Worker and built into a new IPA; source commits do not update existing installations automatically.
