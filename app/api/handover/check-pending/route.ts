import { NextResponse } from 'next/server';
import { db } from '@/lib/db/drizzle';
import { aiSessions, chats, messages, evolutionInstances } from '@/lib/db/schema';
import { eq, and, lt, sql } from 'drizzle-orm';
import { getWhatsAppProvider } from '@/lib/whatsapp/provider-factory';

/**
 * Cron endpoint: checks for paused AI sessions (after handover_to_human)
 * where no human has replied in the last 3 minutes, then sends an
 * automatic fallback message to the customer.
 *
 * Run every minute via crontab:
 *   * * * * * curl -s -H "Authorization: Bearer $CRON_SECRET" \
 *     http://localhost:3000/api/handover/check-pending > /dev/null
 */
export async function GET(request: Request) {
  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const FALLBACK_DELAY_MINUTES = 3;
  const FALLBACK_MESSAGE = process.env.HANDOVER_FALLBACK_MESSAGE
    || 'Estamos experimentando alta demanda en este momento. Por favor déjanos tu mensaje detallado y un agente te responderá a la brevedad. ¡Gracias por tu paciencia! 🙏';

  const cutoff = new Date(Date.now() - FALLBACK_DELAY_MINUTES * 60 * 1000);

  // Find paused sessions older than 3 minutes that haven't received fallback yet
  const pendingSessions = await db
    .select({
      sessionId: aiSessions.id,
      chatId: aiSessions.chatId,
      teamId: aiSessions.teamId,
      pausedAt: aiSessions.updatedAt,
    })
    .from(aiSessions)
    .where(
      and(
        eq(aiSessions.status, 'paused'),
        eq(aiSessions.handoverFallbackSent, false),
        lt(aiSessions.updatedAt, cutoff)
      )
    );

  let processed = 0;
  let sent = 0;
  const errors: any[] = [];

  for (const s of pendingSessions) {
    processed++;
    try {
      // Check if a human agent has replied since the handover
      const humanReply = await db
        .select({ id: messages.id })
        .from(messages)
        .where(
          and(
            eq(messages.chatId, s.chatId),
            eq(messages.fromMe, true),
            sql`${messages.timestamp} > ${s.pausedAt}`
          )
        )
        .limit(1);

      if (humanReply.length > 0) {
        // Human already responded — mark as fallback "sent" to skip
        await db.update(aiSessions)
          .set({ handoverFallbackSent: true })
          .where(eq(aiSessions.id, s.sessionId));
        continue;
      }

      // Get chat info to send the fallback message
      const chatInfo = await db
        .select({
          remoteJid: chats.remoteJid,
          instanceId: chats.instanceId,
        })
        .from(chats)
        .where(eq(chats.id, s.chatId))
        .limit(1);

      if (!chatInfo.length || !chatInfo[0].instanceId || !s.teamId) continue;

      const instance = await db
        .select()
        .from(evolutionInstances)
        .where(eq(evolutionInstances.id, chatInfo[0].instanceId))
        .limit(1);

      if (!instance.length) continue;

      // Send fallback message via the appropriate provider
      const provider = await getWhatsAppProvider(instance[0] as any);
      await provider.sendText(chatInfo[0].remoteJid, { text: FALLBACK_MESSAGE });

      // Mark fallback as sent
      await db.update(aiSessions)
        .set({ handoverFallbackSent: true })
        .where(eq(aiSessions.id, s.sessionId));

      sent++;
    } catch (err: any) {
      errors.push({ sessionId: s.sessionId, error: err.message });
      console.error(`[handover-fallback] error for session ${s.sessionId}:`, err.message);
    }
  }

  return NextResponse.json({
    success: true,
    processed,
    sent,
    errors: errors.length,
    timestamp: new Date().toISOString(),
  });
}
