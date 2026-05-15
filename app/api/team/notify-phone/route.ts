import { NextResponse } from 'next/server';
import { db } from '@/lib/db/drizzle';
import { teams } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { getSession } from '@/lib/auth/session';
import { getUserWithTeam } from '@/lib/db/queries';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getSession();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const u = await getUserWithTeam(session.user.id);
  if (!u?.teamId) return NextResponse.json({ error: 'No team' }, { status: 403 });
  const team = await db.query.teams.findFirst({ where: eq(teams.id, u.teamId), columns: { notifyAdminPhone: true } });
  return NextResponse.json({ notifyAdminPhone: team?.notifyAdminPhone ?? '' });
}

export async function PUT(request: Request) {
  const session = await getSession();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const u = await getUserWithTeam(session.user.id);
  if (!u?.teamId) return NextResponse.json({ error: 'No team' }, { status: 403 });
  const body = await request.json();
  let raw = String(body.notifyAdminPhone || '').trim();
  // Keep only digits (allow leading + but strip it)
  const clean = raw.replace(/[^\d]/g, '');
  // Empty string disables notifications. Otherwise require 8-15 digits sanity check.
  if (clean && (clean.length < 8 || clean.length > 15)) {
    return NextResponse.json({ error: 'Número inválido (use código de país + número, 8-15 dígitos)' }, { status: 400 });
  }
  await db.update(teams).set({ notifyAdminPhone: clean || null }).where(eq(teams.id, u.teamId));
  return NextResponse.json({ notifyAdminPhone: clean });
}
