import { NextResponse } from 'next/server';
import { db } from '@/lib/db/drizzle';
import { appointments, businesses, businessServices } from '@/lib/db/schema';
import { eq, and, gte, lt, desc, asc } from 'drizzle-orm';
import { getSession } from '@/lib/auth/session';
import { getUserWithTeam } from '@/lib/db/queries';

export const dynamic = 'force-dynamic';

async function owns(bizId: number) {
  const session = await getSession();
  if (!session?.user?.id) return null;
  const u = await getUserWithTeam(session.user.id);
  if (!u?.teamId) return null;
  const biz = await db.query.businesses.findFirst({ where: and(eq(businesses.id, bizId), eq(businesses.teamId, u.teamId)) });
  return biz ? u.teamId : null;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const bizId = parseInt(id, 10);
  if (!(await owns(bizId))) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const url = new URL(request.url);
  const fromStr = url.searchParams.get('from');
  const toStr = url.searchParams.get('to');
  const conds: any[] = [eq(appointments.businessId, bizId)];
  if (fromStr) conds.push(gte(appointments.startAt, new Date(fromStr)));
  if (toStr) conds.push(lt(appointments.startAt, new Date(toStr)));
  const rows = await db.select({
    id: appointments.id, customerName: appointments.customerName,
    customerPhone: appointments.customerPhone, customerEmail: appointments.customerEmail,
    startAt: appointments.startAt, endAt: appointments.endAt, status: appointments.status,
    notes: appointments.notes, serviceId: appointments.serviceId, source: appointments.source,
    serviceName: businessServices.name, durationMin: businessServices.durationMin,
  }).from(appointments)
    .leftJoin(businessServices, eq(appointments.serviceId, businessServices.id))
    .where(and(...conds))
    .orderBy(asc(appointments.startAt));
  return NextResponse.json({ appointments: rows });
}
