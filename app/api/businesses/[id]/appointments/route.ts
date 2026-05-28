import { NextResponse } from 'next/server';
import { db } from '@/lib/db/drizzle';
import { appointments, businesses, businessServices } from '@/lib/db/schema';
import { eq, and, gte, lt, desc, asc } from 'drizzle-orm';
import { getSession } from '@/lib/auth/session';
import { getUserWithTeam } from '@/lib/db/queries';
import { zonedDateToUtc } from '@/lib/booking/availability';
import { sendTeamWhatsApp } from '@/lib/booking/whatsapp';

export const dynamic = 'force-dynamic';

async function ownsAndGet(bizId: number) {
  const session = await getSession();
  if (!session?.user?.id) return null;
  const u = await getUserWithTeam(session.user.id);
  if (!u?.teamId) return null;
  const biz = await db.query.businesses.findFirst({ where: and(eq(businesses.id, bizId), eq(businesses.teamId, u.teamId)) });
  return biz ? { teamId: u.teamId, business: biz } : null;
}

async function owns(bizId: number) {
  const ctx = await ownsAndGet(bizId);
  return ctx ? ctx.teamId : null;
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

// Manual appointment creation (admin walks-in, phone, etc.)
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const bizId = parseInt(id, 10);
  const ctx = await ownsAndGet(bizId);
  if (!ctx) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const body = await request.json();
  const { serviceId, customerName, customerPhone, customerEmail, date, time, notes, sendConfirmation } = body;
  if (!serviceId || !customerName || !customerPhone || !date || !time) {
    return NextResponse.json({ error: 'Faltan campos obligatorios' }, { status: 400 });
  }
  const svc = await db.query.businessServices.findFirst({
    where: and(eq(businessServices.id, parseInt(String(serviceId), 10)), eq(businessServices.businessId, bizId))
  });
  if (!svc) return NextResponse.json({ error: 'Servicio no encontrado' }, { status: 400 });

  const startUtc = zonedDateToUtc(String(date), String(time), ctx.business.timezone);
  const endUtc = new Date(startUtc.getTime() + svc.durationMin * 60000);

  const [appt] = await db.insert(appointments).values({
    businessId: bizId,
    serviceId: svc.id,
    customerName: String(customerName).slice(0, 120),
    customerPhone: String(customerPhone).replace(/[^\d+]/g, '').slice(0, 30),
    customerEmail: customerEmail ? String(customerEmail).slice(0, 120) : null,
    startAt: startUtc,
    endAt: endUtc,
    status: 'confirmed',
    notes: notes ? String(notes).slice(0, 500) : null,
    source: 'manual',
  }).returning();

  if (sendConfirmation !== false) {
    const dateLabel = new Intl.DateTimeFormat('es-ES', { timeZone: ctx.business.timezone, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(startUtc);
    const text = `✅ Reserva confirmada en ${ctx.business.name}\n\nServicio: ${svc.name}\n📅 ${dateLabel}${ctx.business.address ? `\n📍 ${ctx.business.address}` : ''}`;
    sendTeamWhatsApp(ctx.teamId, appt.customerPhone, text).catch(() => {});
  }

  return NextResponse.json({ appointment: appt });
}
