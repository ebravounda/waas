import { NextResponse } from 'next/server';
import { db } from '@/lib/db/drizzle';
import { aiSessions, chats, messages, evolutionInstances } from '@/lib/db/schema';
import { eq, and, lt, sql } from 'drizzle-orm';
import { getWhatsAppProvider } from '@/lib/whatsapp/provider-factory';
import { createSystemMessage } from '@/lib/db/system-messages';
import { pusherServer } from '@/lib/pusher-server';

/**
 * Cron endpoint: handles handover lifecycle.
 *
 * Stage 1 (>= 2 min, fallback not sent): send a randomized "please hold" message
 *   to the customer so they don't repeat-spam (anti-ban). Mark fallbackSent=true.
 *
 * Stage 2 (>= 5 min, fallback already sent, still no human reply): re-activate AI
 *   on the chat so the bot keeps the conversation alive. Leaves a persistent
 *   system message so the admin still sees the unattended escalation in the panel.
 *
 * Crontab: * * * * * curl -s -X POST -H "Authorization: Bearer $CRON_SECRET" \
 *   http://localhost:3000/api/handover/check-pending > /dev/null
 */

const HOLD_VARIANTS = [
  'Hola, gracias por tu paciencia 🙏. Estamos buscando un agente disponible para atenderte. En breve te respondemos.',
  'Espera un momento, estamos contactando a un agente para que te atienda lo antes posible 💬',
  'Gracias por escribirnos. Un asesor humano se está conectando para responderte 👨‍💼',
  'Recibimos tu solicitud y un agente está siendo asignado. Te respondemos en unos minutos ⏳',
  'Estamos buscando al agente ideal para tu consulta. Por favor mantente atento al chat 🙏',
  'Hola 👋 — un compañero del equipo te responderá en breve. Disculpá la demora.',
  'Tu mensaje ya está en cola. Un agente real se conectará contigo en pocos minutos 🙌',
  'Gracias por tu paciencia. Estamos buscando un agente disponible para atenderte personalmente.',
];

function pickHold(seed: number): string {
  return HOLD_VARIANTS[seed % HOLD_VARIANTS.length];
}

async function handleRequest(request: Request) {
  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const HOLD_DELAY_MIN = parseInt(process.env.HANDOVER_HOLD_MINUTES || '2', 10);
  const REACTIVATE_DELAY_MIN = parseInt(process.env.HANDOVER_REACTIVATE_MINUTES || '5', 10);

  const now = Date.now();
  const holdCutoff = new Date(now - HOLD_DELAY_MIN * 60 * 1000);
  const reactivateCutoff = new Date(now - REACTIVATE_DELAY_MIN * 60 * 1000);

  // All paused sessions whose pause is older than HOLD_DELAY_MIN
  const pausedSessions = await db
    .select({
      sessionId: aiSessions.id,
      chatId: aiSessions.chatId,
      teamId: aiSessions.teamId,
      pausedAt: aiSessions.updatedAt,
      handoverFallbackSent: aiSessions.handoverFallbackSent,
    })
    .from(aiSessions)
    .where(
      and(
        eq(aiSessions.status, 'paused'),
        lt(aiSessions.updatedAt, holdCutoff)
      )
    );

  let processed = 0;
  let holdSent = 0;
  let reactivated = 0;
  const errors: any[] = [];

  for (const s of pausedSessions) {
    processed++;
    try {
      // Has a human agent replied since the pause? (Exclude AI's own messages)
      const pausedAtIso = s.pausedAt instanceof Date ? s.pausedAt.toISOString() : String(s.pausedAt);
      const humanReply = await db
        .select({ id: messages.id })
        .from(messages)
        .where(
          and(
            eq(messages.chatId, s.chatId),
            eq(messages.fromMe, true),
            eq(messages.isAi, false),
            sql`${messages.timestamp} > ${pausedAtIso}::timestamp`
          )
        )
        .limit(1);

      if (humanReply.length > 0) {
        // Human took it — clear the flag, leave it paused (under human control)
        if (!s.handoverFallbackSent) {
          await db.update(aiSessions)
            .set({ handoverFallbackSent: true })
            .where(eq(aiSessions.id, s.sessionId));
        }
        continue;
      }

      // Lookup chat + instance
      const chatInfo = await db
        .select({ remoteJid: chats.remoteJid, instanceId: chats.instanceId })
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

      const provider = await getWhatsAppProvider(instance[0] as any);

      // STAGE 2: 5 minutes elapsed and we already sent the hold message — reactivate AI
      if (s.handoverFallbackSent && s.pausedAt && new Date(s.pausedAt) < reactivateCutoff) {
        await db.update(aiSessions)
          .set({ status: 'active', updatedAt: new Date() })
          .where(eq(aiSessions.id, s.sessionId));

        await createSystemMessage(
          s.teamId,
          s.chatId,
          `@@syslog_ai_reactivated|reason=Sin respuesta humana en ${REACTIVATE_DELAY_MIN} minutos`
        );

        // Emit pusher event so dashboard can surface persistent notification
        try {
          await pusherServer.trigger(`team-${s.teamId}`, 'chat-status-update', {
            chatId: s.chatId, type: 'ai', status: 'active'
          });
          await pusherServer.trigger(`team-${s.teamId}`, 'handover-unattended', {
            chatId: s.chatId,
            minutes: REACTIVATE_DELAY_MIN,
            timestamp: new Date().toISOString(),
          });
        } catch {}

        reactivated++;
        continue;
      }

      // STAGE 1: 2 minutes elapsed, fallback not yet sent — send randomized hold message
      if (!s.handoverFallbackSent) {
        const text = pickHold(s.sessionId + Math.floor(now / 60000));
        await provider.sendText(chatInfo[0].remoteJid, { text });

        await db.update(aiSessions)
          .set({ handoverFallbackSent: true })
          .where(eq(aiSessions.id, s.sessionId));

        holdSent++;
      }
    } catch (err: any) {
      errors.push({ sessionId: s.sessionId, error: err.message });
      console.error(`[handover-cron] error session ${s.sessionId}:`, err.message);
    }
  }

  return NextResponse.json({
    success: true,
    processed,
    holdSent,
    reactivated,
    errors: errors.length,
    timestamp: new Date().toISOString(),
  });
}

export async function GET(request: Request) { return handleRequest(request); }
export async function POST(request: Request) { return handleRequest(request); }
