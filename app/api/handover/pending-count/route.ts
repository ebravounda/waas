import { NextResponse } from 'next/server';
import { db } from '@/lib/db/drizzle';
import { aiSessions } from '@/lib/db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { getTeamForUser } from '@/lib/db/queries';

export const dynamic = 'force-dynamic';

/**
 * Returns the count of AI sessions paused (handover_to_human triggered)
 * that have not been resolved yet (no human reply / fallback not sent).
 * Used by the dashboard bell badge.
 */
export async function GET() {
  const team = await getTeamForUser();
  if (!team) return NextResponse.json({ count: 0 }, { status: 200 });

  const rows = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(aiSessions)
    .where(and(eq(aiSessions.teamId, team.id), eq(aiSessions.status, 'paused')));

  const count = rows[0]?.c ?? 0;
  return NextResponse.json({ count });
}
