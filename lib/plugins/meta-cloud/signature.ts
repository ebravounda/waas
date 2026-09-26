import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Verifies Meta webhook signature (X-Hub-Signature-256).
 * Meta signs the raw request body with the App Secret using HMAC-SHA256.
 *
 * @param rawBody     raw request body (as string, BEFORE parsing)
 * @param signature   value of header "x-hub-signature-256" (e.g. "sha256=abc...")
 * @param appSecret   Meta App Secret used to sign
 * @returns true when signature matches
 */
export function verifyMetaSignature(rawBody: string, signature: string | null, appSecret: string): boolean {
  if (!signature || !appSecret) return false;

  const cleaned = signature.startsWith('sha256=') ? signature.slice('sha256='.length) : signature;
  const expected = createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex');

  try {
    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(cleaned, 'hex');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
