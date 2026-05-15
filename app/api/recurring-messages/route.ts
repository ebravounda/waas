import { NextResponse } from 'next/server';
import { db } from '@/lib/db/drizzle';
import { recurringMessages } from '@/lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { getSession } from '@/lib/auth/session';
import { getUserWithTeam } from '@/lib/db/queries';
import { computeNextRun } from '@/lib/recurring-messages/compute-next-run';

export async function GET() {
  const session = await getSession();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userWithTeam = await getUserWithTeam(session.user.id);
  if (!userWithTeam?.teamId) return NextResponse.json({ error: 'No team' }, { status: 403 });

  const rules = await db.select().from(recurringMessages)
    .where(eq(recurringMessages.teamId, userWithTeam.teamId))
    .orderBy(desc(recurringMessages.createdAt));
  return NextResponse.json({ rules });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userWithTeam = await getUserWithTeam(session.user.id);
  if (!userWithTeam?.teamId) return NextResponse.json({ error: 'No team' }, { status: 403 });

  const body = await request.json();
  const { name, instanceId, scheduleType, scheduleValue, sendHour, sendMinute, timezone,
    messageBody, mediaUrl, mediaType, targetType, targetValue, delayBetweenMessages, isActive, runOnceAt } = body;

  if (!name || !scheduleType || !messageBody) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }
  if (!['day_of_month', 'every_n_days', 'day_of_week', 'once'].includes(scheduleType)) {
    return NextResponse.json({ error: 'Invalid scheduleType' }, { status: 400 });
  }
  if (scheduleType === 'once' && !runOnceAt) {
    return NextResponse.json({ error: 'runOnceAt required for one-time messages' }, { status: 400 });
  }
  if (scheduleType !== 'once' && (scheduleValue == null)) {
    return NextResponse.json({ error: 'scheduleValue required' }, { status: 400 });
  }

  // Validate timezone string (Intl will throw on invalid)
  let tz = (timezone || 'UTC').trim();
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); } catch { tz = 'UTC'; }

  const ruleData = {
    sendHour: sendHour ?? 9,
    sendMinute: sendMinute ?? 0,
    scheduleType,
    scheduleValue: scheduleType === 'once' ? 0 : scheduleValue,
    timezone: tz,
    runOnceAt: scheduleType === 'once' ? new Date(runOnceAt) : null,
  };
  const nextRunAt = computeNextRun(ruleData as any);

  const [created] = await db.insert(recurringMessages).values({
    teamId: userWithTeam.teamId,
    instanceId: instanceId || null,
    name,
    scheduleType,
    scheduleValue: ruleData.scheduleValue,
    sendHour: sendHour ?? 9,
    sendMinute: sendMinute ?? 0,
    timezone: tz,
    messageBody,
    mediaUrl: mediaUrl || null,
    mediaType: mediaType || null,
    targetType: targetType || 'all',
    targetValue: targetValue || null,
    delayBetweenMessages: delayBetweenMessages ?? 8,
    isActive: isActive ?? true,
    nextRunAt,
    createdBy: session.user.id,
  }).returning();

  return NextResponse.json({ rule: created });
}
