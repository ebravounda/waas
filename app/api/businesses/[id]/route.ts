import { NextResponse } from 'next/server';
import { db } from '@/lib/db/drizzle';
import { businesses, businessHours, businessServices, appointments } from '@/lib/db/schema';
import { eq, and, gte, lte, asc } from 'drizzle-orm';
import { getSession } from '@/lib/auth/session';
import { getUserWithTeam } from '@/lib/db/queries';

export const dynamic = 'force-dynamic';

async function checkOwnership(businessId: number) {
  const session = await getSession();
  if (!session?.user?.id) return null;
  const u = await getUserWithTeam(session.user.id);
  if (!u?.teamId) return null;
  const biz = await db.query.businesses.findFirst({ where: and(eq(businesses.id, businessId), eq(businesses.teamId, u.teamId)) });
  return biz ? { teamId: u.teamId, business: biz } : null;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const bizId = parseInt(id, 10);
  const own = await checkOwnership(bizId);
  if (!own) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const services = await db.select().from(businessServices).where(eq(businessServices.businessId, bizId)).orderBy(asc(businessServices.sortOrder));
  const hours = await db.select().from(businessHours).where(eq(businessHours.businessId, bizId)).orderBy(asc(businessHours.weekday));
  return NextResponse.json({ business: own.business, services, hours });
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const bizId = parseInt(id, 10);
  const own = await checkOwnership(bizId);
  if (!own) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const body = await request.json();
  const allowed: any = {};
  for (const k of ['name', 'type', 'timezone', 'address', 'phone', 'logoUrl', 'primaryColor', 'description', 'isActive', 'bookingNoticeMinutes']) {
    if (body[k] !== undefined) allowed[k] = body[k];
  }
  if (allowed.timezone) {
    try { new Intl.DateTimeFormat('en-US', { timeZone: allowed.timezone }); } catch { allowed.timezone = 'UTC'; }
  }
  const [updated] = await db.update(businesses).set(allowed).where(eq(businesses.id, bizId)).returning();
  return NextResponse.json({ business: updated });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const bizId = parseInt(id, 10);
  const own = await checkOwnership(bizId);
  if (!own) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  await db.delete(businesses).where(eq(businesses.id, bizId));
  return NextResponse.json({ success: true });
}
