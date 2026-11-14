/** E.164 validation for an explicitly supplied phone number; no silent SIM reads. */
export function normalizePhoneNumber(value: string): string {
  const cleaned = value.replace(/[ ()-]/g, '');
  if (!/^\+[1-9]\d{7,14}$/.test(cleaned)) {
    throw new Error('Enter a phone number in international format, e.g. +12025550123');
  }
  return cleaned;
}

export function maskPhoneNumber(value: string): string {
  return `••• ••• ${value.slice(-4)}`;
}
