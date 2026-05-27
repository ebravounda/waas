import { NextResponse } from 'next/server';
import { db } from '@/lib/db/drizzle';
import { businessServices, businesses } from '@/lib/db/schema';
import { eq, and, asc } from 'drizzle-orm';
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

export async function GET(_r: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const bizId = parseInt(id, 10);
  if (!(await owns(bizId))) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const rows = await db.select().from(businessServices).where(eq(businessServices.businessId, bizId)).orderBy(asc(businessServices.sortOrder));
  return NextResponse.json({ services: rows });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const bizId = parseInt(id, 10);
  if (!(await owns(bizId))) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const b = await request.json();
  if (!b.name) return NextResponse.json({ error: 'name required' }, { status: 400 });
  const [created] = await db.insert(businessServices).values({
    businessId: bizId,
    name: b.name,
    durationMin: parseInt(b.durationMin, 10) || 30,
    priceCents: parseInt(b.priceCents, 10) || 0,
    currency: b.currency || 'EUR',
    description: b.description || null,
    isActive: b.isActive ?? true,
    sortOrder: parseInt(b.sortOrder, 10) || 0,
  }).returning();
  return NextResponse.json({ service: created });
}
