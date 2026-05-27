import { NextResponse } from 'next/server';
import { db } from '@/lib/db/drizzle';
import { businessServices, businesses } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { getSession } from '@/lib/auth/session';
import { getUserWithTeam } from '@/lib/db/queries';

export const dynamic = 'force-dynamic';

async function ownsService(bizId: number, serviceId: number) {
  const session = await getSession();
  if (!session?.user?.id) return false;
  const u = await getUserWithTeam(session.user.id);
  if (!u?.teamId) return false;
  const biz = await db.query.businesses.findFirst({ where: and(eq(businesses.id, bizId), eq(businesses.teamId, u.teamId)) });
  if (!biz) return false;
  const svc = await db.query.businessServices.findFirst({ where: and(eq(businessServices.id, serviceId), eq(businessServices.businessId, bizId)) });
  return !!svc;
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string, serviceId: string }> }) {
  const { id, serviceId } = await params;
  const bizId = parseInt(id, 10);
  const svcId = parseInt(serviceId, 10);
  if (!(await ownsService(bizId, svcId))) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const b = await request.json();
  const allowed: any = {};
  for (const k of ['name', 'durationMin', 'priceCents', 'currency', 'description', 'isActive', 'sortOrder']) {
    if (b[k] !== undefined) allowed[k] = b[k];
  }
  const [updated] = await db.update(businessServices).set(allowed).where(eq(businessServices.id, svcId)).returning();
  return NextResponse.json({ service: updated });
}

export async function DELETE(_r: Request, { params }: { params: Promise<{ id: string, serviceId: string }> }) {
  const { id, serviceId } = await params;
  const bizId = parseInt(id, 10);
  const svcId = parseInt(serviceId, 10);
  if (!(await ownsService(bizId, svcId))) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  await db.delete(businessServices).where(eq(businessServices.id, svcId));
  return NextResponse.json({ success: true });
}
