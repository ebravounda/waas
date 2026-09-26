import { NextResponse } from 'next/server';
import { db } from '@/lib/db/drizzle';
import { evolutionInstances } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { getSession } from '@/lib/auth/session';
import { getUserWithTeam } from '@/lib/db/queries';

const GRAPH_URL = 'https://graph.facebook.com';
const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v21.0';

/**
 * Register a phone number with Meta Cloud API before it can send messages.
 * Meta requires this once per phone number. Also sets a 6-digit PIN for
 * two-step verification (required by WhatsApp Business Platform).
 *
 * POST /api/instance/meta-register
 * Body: { instanceId: number, pin: string (6 digits) }
 *
 * Corresponds to:
 *   POST https://graph.facebook.com/v21.0/{PHONE_NUMBER_ID}/register
 *   { messaging_product: 'whatsapp', pin: '123456' }
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const u = await getUserWithTeam(session.user.id);
  if (!u?.teamId) return NextResponse.json({ error: 'No team' }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const instanceId = parseInt(body.instanceId, 10);
  const pin = String(body.pin || '').trim();

  if (!instanceId) return NextResponse.json({ error: 'instanceId requerido' }, { status: 400 });
  if (!/^\d{6}$/.test(pin)) return NextResponse.json({ error: 'PIN debe tener exactamente 6 dígitos' }, { status: 400 });

  const inst = await db.query.evolutionInstances.findFirst({
    where: and(eq(evolutionInstances.id, instanceId), eq(evolutionInstances.teamId, u.teamId)),
  });
  if (!inst) return NextResponse.json({ error: 'Instancia no encontrada' }, { status: 404 });
  if (inst.integration !== 'META-CLOUD') {
    return NextResponse.json({ error: 'Solo instancias META-CLOUD requieren este registro' }, { status: 400 });
  }

  const token = inst.metaToken || inst.accessToken;
  const phoneNumberId = inst.metaPhoneNumberId;
  if (!token || !phoneNumberId) {
    return NextResponse.json({ error: 'La instancia no tiene metaToken o metaPhoneNumberId' }, { status: 400 });
  }

  try {
    const res = await fetch(`${GRAPH_URL}/${GRAPH_VERSION}/${phoneNumberId}/register`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ messaging_product: 'whatsapp', pin }),
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      const errMsg = data?.error?.message || `Meta rechazó el registro (${res.status})`;
      const code = data?.error?.code;
      const subcode = data?.error?.error_subcode;
      // Common cases:
      //   133005 — PIN incorrect (existing PIN differs)
      //   133006 — Rate limit for register attempts
      //   133008 — Number already registered
      //   133009 — 2FA required (must disable in WhatsApp app first)
      let hint = '';
      if (code === 133008) hint = 'El número ya está registrado. No necesitas hacer nada más.';
      else if (code === 133005) hint = 'Ese PIN no coincide con el actual. Si es un número nuevo, borra el PIN en Meta o usa el que ya tenía.';
      else if (code === 133009) hint = 'Debes DESACTIVAR la verificación en dos pasos en la app WhatsApp del número ANTES de registrar. Luego reintenta.';
      else if (code === 133006) hint = 'Muchos intentos de registro. Espera 10-30 minutos y reintenta.';
      return NextResponse.json({ error: errMsg, code, subcode, hint }, { status: 400 });
    }

    return NextResponse.json({ success: true, meta: data });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Error contactando a Meta' }, { status: 500 });
  }
}

/**
 * Check registration status of a phone number.
 * GET /api/instance/meta-register?instanceId=123
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const u = await getUserWithTeam(session.user.id);
  if (!u?.teamId) return NextResponse.json({ error: 'No team' }, { status: 403 });

  const url = new URL(request.url);
  const instanceId = parseInt(url.searchParams.get('instanceId') || '0', 10);
  if (!instanceId) return NextResponse.json({ error: 'instanceId requerido' }, { status: 400 });

  const inst = await db.query.evolutionInstances.findFirst({
    where: and(eq(evolutionInstances.id, instanceId), eq(evolutionInstances.teamId, u.teamId)),
  });
  if (!inst || inst.integration !== 'META-CLOUD') {
    return NextResponse.json({ error: 'Instancia no válida' }, { status: 404 });
  }

  const token = inst.metaToken || inst.accessToken;
  const phoneNumberId = inst.metaPhoneNumberId;
  if (!token || !phoneNumberId) return NextResponse.json({ error: 'Sin credenciales' }, { status: 400 });

  try {
    const res = await fetch(
      `${GRAPH_URL}/${GRAPH_VERSION}/${phoneNumberId}?fields=verified_name,display_phone_number,quality_rating,code_verification_status,name_status,status,platform_type,throughput`,
      {
        headers: { 'Authorization': `Bearer ${token}` },
        signal: AbortSignal.timeout(10000),
      }
    );
    const data = await res.json();
    if (!res.ok) return NextResponse.json({ error: data?.error?.message || 'Error Meta' }, { status: 400 });
    return NextResponse.json({ phoneInfo: data });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Error' }, { status: 500 });
  }
}
