import { getPhoneEnrollment, setPhoneEnrollment } from '../../core/database';
import { getInstallationId } from '../../core/identity';
import type { PhoneStatus } from '../../core/types';
import { authorizedPost } from '../sync/syncService';
import { maskPhoneNumber, normalizePhoneNumber } from './numberUtils';

export { normalizePhoneNumber } from './numberUtils';

/** Carrier/SIM number reads are not a reliable or permitted cross-platform mechanism. */
export async function readPrimaryPhoneNumber(): Promise<string | null> {
  return null;
}

export async function getPhoneDetails(): Promise<{ masked: string; status: PhoneStatus }> {
  const item = await getPhoneEnrollment();
  return item
    ? { masked: maskPhoneNumber(item.e164), status: item.status }
    : { masked: 'Not added', status: 'not_provided' };
}

/** Authenticated API must issue an OTP, throttle attempts and confirm enrollment. */
export async function requestPhoneVerification(userEnteredNumber: string): Promise<void> {
  const number = normalizePhoneNumber(userEnteredNumber);
  const response = await authorizedPost('/v1/phone/request-verification', {
    deviceId: await getInstallationId(),
    phoneNumber: number,
  });
  if (!response.ok) throw new Error(`Verification could not be started (${response.status})`);
  await setPhoneEnrollment(number, 'pending_verification');
}

export async function verifyPhoneCode(code: string): Promise<void> {
  if (!/^\d{4,8}$/.test(code)) throw new Error('Enter the verification code');
  const enrollment = await getPhoneEnrollment();
  if (!enrollment) throw new Error('Add a phone number first');
  const response = await authorizedPost('/v1/phone/verify', {
    deviceId: await getInstallationId(),
    phoneNumber: enrollment.e164,
    code,
  });
  if (!response.ok) throw new Error(`Verification failed (${response.status})`);
  const result = (await response.json()) as { verified?: boolean };
  if (result.verified !== true) throw new Error('Server has not confirmed verification');
  await setPhoneEnrollment(enrollment.e164, 'verified');
}
