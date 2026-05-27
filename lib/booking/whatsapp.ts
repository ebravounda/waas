import { db } from '@/lib/db/drizzle';
import { evolutionInstances, chats } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL || 'http://localhost:8080';

/**
 * Send a one-off transactional WhatsApp message via the team's Evolution instance.
 * Used by the booking module for confirmations / reminders / thank-you.
 *
 * `phone` should be the customer's number with country code, no plus.
 * Returns true on success.
 */
export async function sendTeamWhatsApp(teamId: number, phone: string, text: string): Promise<boolean> {
  if (!phone || !text) return false;
  const clean = String(phone).replace(/\D/g, '');
  if (clean.length < 8) return false;

  // Pick the first connected instance of the team
  const inst = await db.query.evolutionInstances.findFirst({ where: eq(evolutionInstances.teamId, teamId) });
  if (!inst?.instanceName || !inst?.accessToken) return false;

  try {
    const res = await fetch(`${EVOLUTION_API_URL}/message/sendText/${inst.instanceName}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': inst.accessToken },
      body: JSON.stringify({ number: clean, text, delay: 400, linkPreview: false }),
      signal: AbortSignal.timeout(10000),
    });
    return res.ok;
  } catch (e: any) {
    console.error('[booking-wa] send failed:', e?.message);
    return false;
  }
}
