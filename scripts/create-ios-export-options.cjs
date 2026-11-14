#!/usr/bin/env node
/** Produces Xcode export settings without writing signing secrets to the repository. */
const fs = require('node:fs');
function xmlEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
const team = process.env.IOS_TEAM_ID;
const profile = process.env.IOS_PROVISIONING_PROFILE_NAME;
const method = process.env.IOS_EXPORT_METHOD || 'release-testing';
if (!team || !profile || !['release-testing', 'enterprise'].includes(method)) {
  throw new Error('Set IOS_TEAM_ID, IOS_PROVISIONING_PROFILE_NAME and a valid IOS_EXPORT_METHOD');
}
const bundle = 'com.innovsy.telemetry';
fs.writeFileSync(
  'ios-export-options.plist',
  `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>method</key><string>${xmlEscape(method)}</string>
<key>signingStyle</key><string>manual</string>
<key>teamID</key><string>${xmlEscape(team)}</string>
<key>provisioningProfiles</key><dict><key>${bundle}</key><string>${xmlEscape(profile)}</string></dict>
<key>compileBitcode</key><false/>
</dict></plist>`,
);
process.stdout.write(`Created Xcode export settings for ${bundle}.\n`);
