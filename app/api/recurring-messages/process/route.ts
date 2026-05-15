import { NextResponse } from 'next/server';
import { db } from '@/lib/db/drizzle';
import { recurringMessages, contacts, chats, evolutionInstances } from '@/lib/db/schema';
import { eq, and, lte, sql, isNotNull } from 'drizzle-orm';
import { getWhatsAppProvider } from '@/lib/whatsapp/provider-factory';

/**
 * Computes the next run timestamp based on schedule pattern.
 * - day_of_month: next time the day-of-month + send time arrives
 * - every_n_days: now + N days
 * - day_of_week: next occurrence of weekday (1=mon..7=sun)
 */
function computeNextRun(rule: any, from: Date = new Date()): Date {
  const next = new Date(from);
  next.setSeconds(0, 0);
  next.setHours(rule.sendHour ?? 9, rule.sendMinute ?? 0, 0, 0);

  if (rule.scheduleType === 'day_of_month') {
    const targetDay = Math.min(Math.max(rule.scheduleValue, 1), 31);
    if (next.getDate() < targetDay || (next.getDate() === targetDay && next <= from)) {
      next.setDate(targetDay);
      if (next <= from) next.setMonth(next.getMonth() + 1);
    } else {
      next.setMonth(next.getMonth() + 1);
      next.setDate(targetDay);
    }
  } else if (rule.scheduleType === 'every_n_days') {
    const days = Math.max(rule.scheduleValue, 1);
    next.setDate(next.getDate() + days);
  } else if (rule.scheduleType === 'day_of_week') {
    // 1=mon..7=sun, JS getDay: 0=sun..6=sat. Convert.
    const targetWeekday = rule.scheduleValue === 7 ? 0 : rule.scheduleValue;
    const currentWeekday = next.getDay();
    let diff = targetWeekday - currentWeekday;
    if (diff < 0 || (diff === 0 && next <= from)) diff += 7;
    next.setDate(next.getDate() + diff);
  }
  return next;
}

function interpolate(text: string, contact: any): string {
  return text
    .replace(/\{\{nombre\}\}/gi, contact.name || contact.pushName || 'amigo')
    .replace(/\{\{name\}\}/gi, contact.name || contact.pushName || 'friend')
    .replace(/\{\{telefono\}\}/gi, contact.phone || '')
    .replace(/\{\{email\}\}/gi, contact.email || '');
}

/**
 * Cron endpoint: runs every minute. Picks recurring rules whose nextRunAt
 * has arrived, sends to all targeted contacts (with anti-ban delay), and
 * schedules the next run.
 *
 * Crontab: * * * * * curl -s -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/recurring-messages/process > /dev/null
 */
export async function GET(request: Request) {
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
            pushName: contacts.pushName,
            phone: contacts.phone,
            email: contacts.email,
            chatId: contacts.chatId,
            remoteJid: chats.remoteJid,
          })
          .from(contacts)
          .leftJoin(chats, eq(contacts.chatId, chats.id))
          .where(eq(contacts.teamId, rule.teamId));
      } else if (rule.targetType === 'tag' && rule.targetValue) {
        targetContacts = await db.execute(sql`
          SELECT c.id, c.name, c.push_name as "pushName", c.phone, c.email, c.chat_id as "chatId", ch.remote_jid as "remoteJid"
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
            pushName: contacts.pushName,
            phone: contacts.phone,
            email: contacts.email,
            chatId: contacts.chatId,
            remoteJid: chats.remoteJid,
          })
          .from(contacts)
          .leftJoin(chats, eq(contacts.chatId, chats.id))
          .where(and(eq(contacts.teamId, rule.teamId), eq(contacts.funnelStageId, parseInt(rule.targetValue, 10))));
      }

      const delayMs = (rule.delayBetweenMessages || 8) * 1000;

      for (const c of targetContacts) {
        const jid = c.remoteJid || (c.phone ? `${c.phone.replace(/\D/g, '')}@s.whatsapp.net` : null);
        if (!jid) continue;
        try {
          const text = interpolate(rule.messageBody, c);
          if (rule.mediaUrl) {
            await provider.sendMedia(jid, { mediaUrl: rule.mediaUrl, mediaType: (rule.mediaType as any) || 'image', caption: text });
          } else {
            await provider.sendText(jid, { text });
          }
          sent++;
          await new Promise(r => setTimeout(r, delayMs));
        } catch (sendErr) {
          errors++;
        }
      }

      const nextRun = computeNextRun(rule, now);
      await db.update(recurringMessages)
        .set({
          lastRunAt: now,
          nextRunAt: nextRun,
          totalRuns: (rule.totalRuns || 0) + 1,
          totalMessagesSent: (rule.totalMessagesSent || 0) + sent,
        })
        .where(eq(recurringMessages.id, rule.id));

      totalSent += sent;
      results.push({ ruleId: rule.id, name: rule.name, sent, errors, nextRunAt: nextRun.toISOString() });
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
