import { NextResponse } from 'next/server';
import { db } from '@/lib/db/drizzle';
import { recurringMessages } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { getSession } from '@/lib/auth/session';
import { getUserWithTeam } from '@/lib/db/queries';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userWithTeam = await getUserWithTeam(session.user.id);
  if (!userWithTeam?.teamId) return NextResponse.json({ error: 'No team' }, { status: 403 });

  const { id } = await params;
  const body = await request.json();
  const allowed: any = {};
  ['name', 'isActive', 'messageBody', 'sendHour', 'sendMinute', 'scheduleType', 'scheduleValue', 'targetType', 'targetValue', 'delayBetweenMessages', 'mediaUrl', 'mediaType', 'instanceId'].forEach(k => {
    if (k in body) allowed[k] = body[k];
  });
  allowed.updatedAt = new Date();

  const [updated] = await db.update(recurringMessages)
    .set(allowed)
    .where(and(eq(recurringMessages.id, parseInt(id, 10)), eq(recurringMessages.teamId, userWithTeam.teamId)))
    .returning();

  if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ rule: updated });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userWithTeam = await getUserWithTeam(session.user.id);
  if (!userWithTeam?.teamId) return NextResponse.json({ error: 'No team' }, { status: 403 });

  const { id } = await params;
  await db.delete(recurringMessages)
    .where(and(eq(recurringMessages.id, parseInt(id, 10)), eq(recurringMessages.teamId, userWithTeam.teamId)));
  return NextResponse.json({ success: true });
}
