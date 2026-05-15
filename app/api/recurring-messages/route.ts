import { NextResponse } from 'next/server';
import { db } from '@/lib/db/drizzle';
import { recurringMessages } from '@/lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { getSession } from '@/lib/auth/session';
import { getUserWithTeam } from '@/lib/db/queries';

function computeNextRun(rule: any, from: Date = new Date()): Date {
  const next = new Date(from);
  next.setSeconds(0, 0);
  next.setHours(rule.sendHour ?? 9, rule.sendMinute ?? 0, 0, 0);
  if (rule.scheduleType === 'once') {
    // For one-time messages, scheduleValue is ignored — use runOnceAt directly
    return rule.runOnceAt ? new Date(rule.runOnceAt) : from;
  }
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
    next.setDate(next.getDate() + Math.max(rule.scheduleValue, 1));
  } else if (rule.scheduleType === 'day_of_week') {
    const targetWd = rule.scheduleValue === 7 ? 0 : rule.scheduleValue;
    const cur = next.getDay();
    let diff = targetWd - cur;
    if (diff < 0 || (diff === 0 && next <= from)) diff += 7;
    next.setDate(next.getDate() + diff);
  }
  return next;
}

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
  const { name, instanceId, scheduleType, scheduleValue, sendHour, sendMinute,
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

  const ruleData = {
    sendHour: sendHour ?? 9,
    sendMinute: sendMinute ?? 0,
    scheduleType,
    scheduleValue: scheduleType === 'once' ? 0 : scheduleValue,
    runOnceAt: scheduleType === 'once' ? new Date(runOnceAt) : null,
  };
  const nextRunAt = computeNextRun(ruleData);

  const [created] = await db.insert(recurringMessages).values({
    teamId: userWithTeam.teamId,
    instanceId: instanceId || null,
    name,
    scheduleType,
    scheduleValue: ruleData.scheduleValue,
    sendHour: sendHour ?? 9,
    sendMinute: sendMinute ?? 0,
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
