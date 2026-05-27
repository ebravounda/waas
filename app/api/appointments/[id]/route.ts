import { NextResponse } from 'next/server';
import { db } from '@/lib/db/drizzle';
import { appointments, businesses } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { getSession } from '@/lib/auth/session';
import { getUserWithTeam } from '@/lib/db/queries';
import { sendTeamWhatsApp } from '@/lib/booking/whatsapp';

export const dynamic = 'force-dynamic';

async function getAppointmentAndTeam(apptId: number) {
  const session = await getSession();
  if (!session?.user?.id) return null;
  const u = await getUserWithTeam(session.user.id);
  if (!u?.teamId) return null;
  const appt = await db.query.appointments.findFirst({ where: eq(appointments.id, apptId) });
  if (!appt) return null;
  const biz = await db.query.businesses.findFirst({ where: and(eq(businesses.id, appt.businessId), eq(businesses.teamId, u.teamId)) });
  if (!biz) return null;
  return { teamId: u.teamId, appointment: appt, business: biz };
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const apptId = parseInt(id, 10);
  const ctx = await getAppointmentAndTeam(apptId);
  if (!ctx) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const body = await request.json();
  const allowed: any = {};
  for (const k of ['status', 'notes', 'customerName', 'customerPhone']) {
    if (body[k] !== undefined) allowed[k] = body[k];
  }
  allowed.updatedAt = new Date();
  const [updated] = await db.update(appointments).set(allowed).where(eq(appointments.id, apptId)).returning();

  // Side effects for hostel-style flow
  if (body.status === 'checked_in' && ctx.business.type === 'hostel') {
    const txt = `🏨 ¡Bienvenido/a a ${ctx.business.name}! Tu check-in está registrado. Si necesitas algo durante tu estancia, responde a este chat. 🙌`;
    sendTeamWhatsApp(ctx.teamId, ctx.appointment.customerPhone, txt).catch(() => {});
  }
  if (body.status === 'checked_out' && ctx.business.type === 'hostel' && !ctx.appointment.thankYouSent) {
    const txt = `Gracias por tu estancia en ${ctx.business.name} 🙏. Esperamos que la hayas disfrutado. ¡Te esperamos pronto de vuelta!`;
    sendTeamWhatsApp(ctx.teamId, ctx.appointment.customerPhone, txt).catch(() => {});
    await db.update(appointments).set({ thankYouSent: true }).where(eq(appointments.id, apptId));
  }
  return NextResponse.json({ appointment: updated });
}

export async function DELETE(_r: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const apptId = parseInt(id, 10);
  const ctx = await getAppointmentAndTeam(apptId);
  if (!ctx) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  await db.delete(appointments).where(eq(appointments.id, apptId));
  return NextResponse.json({ success: true });
}
