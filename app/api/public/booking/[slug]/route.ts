import { NextResponse } from 'next/server';
import { db } from '@/lib/db/drizzle';
import { businesses, businessServices, businessHours, appointments } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { getAvailableSlots, zonedDateToUtc } from '@/lib/booking/availability';
import { sendTeamWhatsApp } from '@/lib/booking/whatsapp';

export const dynamic = 'force-dynamic';

// Public booking endpoint — NO auth.
// GET   /api/public/booking/[slug]                            -> business info + services + hours
// GET   /api/public/booking/[slug]?date=YYYY-MM-DD&serviceId= -> slots
// POST  /api/public/booking/[slug]                            -> create appointment

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const url = new URL(request.url);
  const date = url.searchParams.get('date');
  const serviceIdStr = url.searchParams.get('serviceId');

  const biz = await db.query.businesses.findFirst({ where: and(eq(businesses.slug, slug), eq(businesses.isActive, true)) });
  if (!biz) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (date && serviceIdStr) {
    const svc = await db.query.businessServices.findFirst({ where: and(eq(businessServices.id, parseInt(serviceIdStr, 10)), eq(businessServices.businessId, biz.id), eq(businessServices.isActive, true)) });
    if (!svc) return NextResponse.json({ error: 'Service not found' }, { status: 404 });
    const slots = await getAvailableSlots({
      businessId: biz.id, tz: biz.timezone, dateStr: date,
      durationMin: svc.durationMin, noticeMinutes: biz.bookingNoticeMinutes ?? 60,
    });
    return NextResponse.json({ slots });
  }

  const services = await db.select().from(businessServices).where(and(eq(businessServices.businessId, biz.id), eq(businessServices.isActive, true)));
  const hours = await db.select().from(businessHours).where(eq(businessHours.businessId, biz.id));
  return NextResponse.json({
    business: {
      id: biz.id, slug: biz.slug, name: biz.name, type: biz.type, timezone: biz.timezone,
      address: biz.address, phone: biz.phone, logoUrl: biz.logoUrl,
      primaryColor: biz.primaryColor, description: biz.description,
    },
    services, hours,
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const biz = await db.query.businesses.findFirst({ where: and(eq(businesses.slug, slug), eq(businesses.isActive, true)) });
  if (!biz) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await request.json();
  const { serviceId, customerName, customerPhone, customerEmail, date, time, notes } = body;
  if (!serviceId || !customerName || !customerPhone || !date || !time) {
    return NextResponse.json({ error: 'Faltan campos obligatorios' }, { status: 400 });
  }

  const svc = await db.query.businessServices.findFirst({ where: and(eq(businessServices.id, parseInt(String(serviceId), 10)), eq(businessServices.businessId, biz.id), eq(businessServices.isActive, true)) });
  if (!svc) return NextResponse.json({ error: 'Servicio no disponible' }, { status: 400 });

  // Verify slot still available
  const slots = await getAvailableSlots({
    businessId: biz.id, tz: biz.timezone, dateStr: date,
    durationMin: svc.durationMin, noticeMinutes: biz.bookingNoticeMinutes ?? 60,
  });
  if (!slots.includes(time)) {
    return NextResponse.json({ error: 'Ese horario ya no está disponible' }, { status: 409 });
  }

  const startUtc = zonedDateToUtc(date, time, biz.timezone);
  const endUtc = new Date(startUtc.getTime() + svc.durationMin * 60000);

  const [appt] = await db.insert(appointments).values({
    businessId: biz.id,
    serviceId: svc.id,
    customerName: String(customerName).slice(0, 120),
    customerPhone: String(customerPhone).replace(/[^\d+]/g, '').slice(0, 30),
    customerEmail: customerEmail ? String(customerEmail).slice(0, 120) : null,
    startAt: startUtc,
    endAt: endUtc,
    status: 'confirmed',
    notes: notes ? String(notes).slice(0, 500) : null,
    source: 'online',
  }).returning();

  // Confirmation WhatsApp
  const dateLabel = new Intl.DateTimeFormat('es-ES', { timeZone: biz.timezone, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(startUtc);
  const text = `✅ ¡Reserva confirmada en ${biz.name}!\n\nServicio: ${svc.name}\n📅 ${dateLabel}\n\nSi necesitas reprogramar o cancelar, responde a este mensaje.${biz.address ? `\n\n📍 ${biz.address}` : ''}`;
  sendTeamWhatsApp(biz.teamId, appt.customerPhone, text).catch(() => {});

  return NextResponse.json({ appointment: { id: appt.id, startAt: appt.startAt, endAt: appt.endAt } });
}
