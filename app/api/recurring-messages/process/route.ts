import { NextResponse } from 'next/server';
import { db } from '@/lib/db/drizzle';
import { recurringMessages, contacts, chats, evolutionInstances } from '@/lib/db/schema';
import { eq, and, lte, sql, isNotNull } from 'drizzle-orm';
import { getWhatsAppProvider } from '@/lib/whatsapp/provider-factory';
import { computeNextRun } from '@/lib/recurring-messages/compute-next-run';

/**
 * Cron endpoint: runs every minute. Picks recurring rules whose nextRunAt
 * has arrived, sends to all targeted contacts (with anti-ban delay), and
 * schedules the next run respecting per-rule timezone.
 *
 * Crontab: * * * * * curl -s -X POST -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/recurring-messages/process > /dev/null
 */
function computeNextRunFallback() { /* deprecated — kept as no-op for back-compat */ }

function interpolate(text: string, contact: any): string {
  const phoneFromJid = contact.remoteJid ? String(contact.remoteJid).split('@')[0] : '';
  return text
    .replace(/\{\{nombre\}\}/gi, contact.name || contact.pushName || 'amigo')
    .replace(/\{\{name\}\}/gi, contact.name || contact.pushName || 'friend')
    .replace(/\{\{telefono\}\}/gi, phoneFromJid)
    .replace(/\{\{phone\}\}/gi, phoneFromJid);
}

/**
 * Cron endpoint: runs every minute. Picks recurring rules whose nextRunAt
 * has arrived, sends to all targeted contacts (with anti-ban delay), and
 * schedules the next run.
 *
 * Crontab: * * * * * curl -s -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/recurring-messages/process > /dev/null
 */
export async function GET(request: Request) { return handle(request); }
export async function POST(request: Request) { return handle(request); }

async function handle(request: Request) {
  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = new Date();
  const dueRules = await db
    .select()
    .from(recurringMessages)
    .where(
      and(
        eq(recurringMessages.isActive, true),
        isNotNull(recurringMessages.nextRunAt),
        lte(recurringMessages.nextRunAt, now)
      )
    );

  let totalSent = 0;
  const results: any[] = [];

  for (const rule of dueRules) {
    let sent = 0;
    let errors = 0;
    try {
      if (!rule.instanceId) continue;
      const instanceArr = await db.select().from(evolutionInstances).where(eq(evolutionInstances.id, rule.instanceId)).limit(1);
      if (!instanceArr.length) continue;
      const provider = await getWhatsAppProvider(instanceArr[0] as any);

      // Get target contacts
      let targetContacts: any[] = [];
      if (rule.targetType === 'all') {
        targetContacts = await db
          .select({
            id: contacts.id,
            name: contacts.name,
            pushName: chats.pushName,
            chatId: contacts.chatId,
            remoteJid: chats.remoteJid,
          })
          .from(contacts)
          .leftJoin(chats, eq(contacts.chatId, chats.id))
          .where(eq(contacts.teamId, rule.teamId));
      } else if (rule.targetType === 'tag' && rule.targetValue) {
        targetContacts = await db.execute(sql`
          SELECT c.id, c.name, ch.push_name as "pushName", c.chat_id as "chatId", ch.remote_jid as "remoteJid"
          FROM contacts c
          LEFT JOIN chats ch ON c.chat_id = ch.id
          INNER JOIN contact_tags ct ON ct.contact_id = c.id
          WHERE c.team_id = ${rule.teamId} AND ct.tag_id = ${parseInt(rule.targetValue, 10)}
        `) as any;
      } else if (rule.targetType === 'funnel' && rule.targetValue) {
        targetContacts = await db
          .select({
            id: contacts.id,
            name: contacts.name,
            pushName: chats.pushName,
            chatId: contacts.chatId,
            remoteJid: chats.remoteJid,
          })
          .from(contacts)
          .leftJoin(chats, eq(contacts.chatId, chats.id))
          .where(and(eq(contacts.teamId, rule.teamId), eq(contacts.funnelStageId, parseInt(rule.targetValue, 10))));
      } else if (rule.targetType === 'contacts' && rule.targetValue) {
        // targetValue is a JSON array of items: { remoteJid?: string, phone?: string, name?: string }
        let items: Array<{ remoteJid?: string; phone?: string; name?: string }> = [];
        try { items = JSON.parse(rule.targetValue); } catch { items = []; }
        targetContacts = items.map((it) => {
          const jid = it.remoteJid
            ? it.remoteJid
            : it.phone
              ? `${String(it.phone).replace(/\D/g, '')}@s.whatsapp.net`
              : '';
          return {
            id: null,
            name: it.name || '',
            pushName: null,
            chatId: null,
            remoteJid: jid,
          };
        }).filter((c: any) => !!c.remoteJid);
      }

      const delayMs = (rule.delayBetweenMessages || 8) * 1000;

      for (const c of targetContacts) {
        const jid = c.remoteJid || null;
        if (!jid) continue;
        try {
          const text = interpolate(rule.messageBody, c);
          if (rule.mediaUrl) {
            try {
              const mediaRes = await fetch(rule.mediaUrl);
              const buf = Buffer.from(await mediaRes.arrayBuffer());
              const mimetype = mediaRes.headers.get('content-type') || 'application/octet-stream';
              const mediaType = (rule.mediaType as any) || (mimetype.startsWith('video') ? 'video' : mimetype.startsWith('image') ? 'image' : 'document');
              await provider.sendMedia(jid, {
                mediaBase64: buf.toString('base64'),
                mimetype,
                mediaType,
                caption: text,
              });
            } catch {
              // Fallback to text if media fetch fails
              await provider.sendText(jid, { text });
            }
          } else {
            await provider.sendText(jid, { text });
          }
          sent++;
          await new Promise(r => setTimeout(r, delayMs));
        } catch (sendErr) {
          errors++;
        }
      }

      const isOnce = rule.scheduleType === 'once';
      const nextRun = isOnce ? null : computeNextRun(rule as any, now);
      await db.update(recurringMessages)
        .set({
          lastRunAt: now,
          nextRunAt: nextRun,
          isActive: isOnce ? false : rule.isActive,
          totalRuns: (rule.totalRuns || 0) + 1,
          totalMessagesSent: (rule.totalMessagesSent || 0) + sent,
        })
        .where(eq(recurringMessages.id, rule.id));

      totalSent += sent;
      results.push({ ruleId: rule.id, name: rule.name, sent, errors, nextRunAt: nextRun ? nextRun.toISOString() : null, once: isOnce });
    } catch (err: any) {
      results.push({ ruleId: rule.id, error: err.message });
    }
  }

  return NextResponse.json({
    success: true,
    rulesProcessed: dueRules.length,
    totalSent,
    results,
    timestamp: new Date().toISOString(),
  });
}
