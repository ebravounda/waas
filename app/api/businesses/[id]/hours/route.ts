import { NextResponse } from 'next/server';
import { db } from '@/lib/db/drizzle';
import { businessHours, businesses } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { getSession } from '@/lib/auth/session';
import { getUserWithTeam } from '@/lib/db/queries';

export const dynamic = 'force-dynamic';

async function owns(bizId: number) {
  const session = await getSession();
  if (!session?.user?.id) return false;
  const u = await getUserWithTeam(session.user.id);
  if (!u?.teamId) return false;
  const biz = await db.query.businesses.findFirst({ where: and(eq(businesses.id, bizId), eq(businesses.teamId, u.teamId)) });
  return !!biz;
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const bizId = parseInt(id, 10);
  if (!(await owns(bizId))) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const body = await request.json();
  // body.hours = [{weekday, openTime, closeTime, isClosed}, ...]
  if (!Array.isArray(body.hours)) return NextResponse.json({ error: 'hours array required' }, { status: 400 });

  // Wipe and re-insert (simpler than upsert per row)
  await db.delete(businessHours).where(eq(businessHours.businessId, bizId));
  const rows = body.hours.map((h: any) => ({
    businessId: bizId,
    weekday: parseInt(h.weekday, 10),
    openTime: h.openTime || '09:00',
    closeTime: h.closeTime || '18:00',
    isClosed: !!h.isClosed,
  }));
  await db.insert(businessHours).values(rows);
  return NextResponse.json({ success: true });
}
