import { NextResponse } from 'next/server';
import { db } from '@/lib/db/drizzle';
import { appointments, businesses, businessServices } from '@/lib/db/schema';
import { eq, and, gte, lte, isNull, or } from 'drizzle-orm';
import { sendTeamWhatsApp } from '@/lib/booking/whatsapp';

export const dynamic = 'force-dynamic';

/**
 * Cron: scans upcoming appointments and sends 24h / 3h reminders.
 * Also handles hostel "thank-you" message after checkout.
 *
 * Crontab: * * * * * curl -s -X POST -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/appointments/process-reminders > /dev/null
 */
async function handle(request: Request) {
  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = Date.now();
  // Window: appts starting between now+2h45m and now+3h15m -> send 3h reminder
  const threeHWindowStart = new Date(now + (3 * 60 - 15) * 60000);
  const threeHWindowEnd = new Date(now + (3 * 60 + 15) * 60000);
  // Window: appts starting between now+23h45m and now+24h15m -> send 24h reminder
  const dayWindowStart = new Date(now + (24 * 60 - 15) * 60000);
  const dayWindowEnd = new Date(now + (24 * 60 + 15) * 60000);

  let sent3h = 0;
  let sent24h = 0;

  // 3h reminders
  const upcoming3h = await db.select({
    id: appointments.id, customerPhone: appointments.customerPhone, customerName: appointments.customerName,
    startAt: appointments.startAt, status: appointments.status,
    businessId: appointments.businessId, businessName: businesses.name, businessTz: businesses.timezone,
    teamId: businesses.teamId, serviceName: businessServices.name,
  }).from(appointments)
    .leftJoin(businesses, eq(appointments.businessId, businesses.id))
    .leftJoin(businessServices, eq(appointments.serviceId, businessServices.id))
    .where(and(
      gte(appointments.startAt, threeHWindowStart),
      lte(appointments.startAt, threeHWindowEnd),
      eq(appointments.reminder3hSent, false),
      eq(appointments.status, 'confirmed')
    ));

  for (const a of upcoming3h) {
    if (!a.teamId || !a.businessName) continue;
    const tz = a.businessTz || 'UTC';
    const hh = new Intl.DateTimeFormat('es-ES', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(a.startAt);
    const txt = `⏰ Recordatorio: tu cita en ${a.businessName} es hoy a las ${hh}${a.serviceName ? ` para ${a.serviceName}` : ''}. ¡Te esperamos! 🙌`;
    const ok = await sendTeamWhatsApp(a.teamId, a.customerPhone, txt);
    if (ok) {
      await db.update(appointments).set({ reminder3hSent: true }).where(eq(appointments.id, a.id));
      sent3h++;
    }
  }

  // 24h reminders
  const upcoming24h = await db.select({
    id: appointments.id, customerPhone: appointments.customerPhone, customerName: appointments.customerName,
    startAt: appointments.startAt, status: appointments.status,
    businessId: appointments.businessId, businessName: businesses.name, businessTz: businesses.timezone,
    teamId: businesses.teamId, serviceName: businessServices.name,
  }).from(appointments)
    .leftJoin(businesses, eq(appointments.businessId, businesses.id))
    .leftJoin(businessServices, eq(appointments.serviceId, businessServices.id))
    .where(and(
      gte(appointments.startAt, dayWindowStart),
      lte(appointments.startAt, dayWindowEnd),
      eq(appointments.reminder24hSent, false),
      eq(appointments.status, 'confirmed')
    ));

  for (const a of upcoming24h) {
    if (!a.teamId || !a.businessName) continue;
    const tz = a.businessTz || 'UTC';
    const dateLabel = new Intl.DateTimeFormat('es-ES', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(a.startAt);
    const txt = `📅 Hola ${a.customerName.split(' ')[0]}, mañana tienes cita en ${a.businessName}: ${dateLabel}${a.serviceName ? ` (${a.serviceName})` : ''}. Si no podrás asistir, respóndenos para reprogramar 🙏`;
    const ok = await sendTeamWhatsApp(a.teamId, a.customerPhone, txt);
    if (ok) {
      await db.update(appointments).set({ reminder24hSent: true }).where(eq(appointments.id, a.id));
      sent24h++;
    }
  }

  return NextResponse.json({ success: true, sent3h, sent24h, timestamp: new Date().toISOString() });
}

export async function GET(r: Request) { return handle(r); }
export async function POST(r: Request) { return handle(r); }
