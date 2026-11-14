/** iPhone-only pilot: app usage collection requires Apple Screen Time entitlement and native adapter. */
export function getUsageCapability(): {
  available: boolean;
  explanation: string;
} {
  return {
    available: false,
    explanation:
      "iOS app usage needs approved Screen Time entitlements and a native integration.",
  };
}
