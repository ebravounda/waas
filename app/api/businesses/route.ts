import { NextResponse } from 'next/server';
import { db } from '@/lib/db/drizzle';
import { businesses, businessHours, businessServices } from '@/lib/db/schema';
import { eq, desc, and } from 'drizzle-orm';
import { getSession } from '@/lib/auth/session';
import { getUserWithTeam } from '@/lib/db/queries';

export const dynamic = 'force-dynamic';

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

export async function GET() {
  const session = await getSession();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const u = await getUserWithTeam(session.user.id);
  if (!u?.teamId) return NextResponse.json({ error: 'No team' }, { status: 403 });
  const rows = await db.select().from(businesses).where(eq(businesses.teamId, u.teamId)).orderBy(desc(businesses.createdAt));
  return NextResponse.json({ businesses: rows });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const u = await getUserWithTeam(session.user.id);
  if (!u?.teamId) return NextResponse.json({ error: 'No team' }, { status: 403 });
  const body = await request.json();
  const { slug, name, type, timezone, address, phone, primaryColor, description } = body;
  if (!slug || !name) return NextResponse.json({ error: 'slug and name required' }, { status: 400 });
  if (!SLUG_RE.test(slug)) return NextResponse.json({ error: 'Slug inválido (solo minúsculas, números y guiones, máx 40 chars)' }, { status: 400 });
  // Reserved slugs
  if (['www', 'api', 'admin', 'app', 'dashboard', 'mail', 'sign-in', 'sign-up', 'pricing'].includes(slug)) {
    return NextResponse.json({ error: 'Slug reservado' }, { status: 400 });
  }
  // Validate timezone
  let tz = (timezone || 'UTC').trim();
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); } catch { tz = 'UTC'; }

  try {
    const [created] = await db.insert(businesses).values({
      teamId: u.teamId,
      slug,
      name,
      type: type || 'barbershop',
      timezone: tz,
      address: address || null,
      phone: phone || null,
      primaryColor: primaryColor || '#0ea5e9',
      description: description || null,
    }).returning();

    // Default business hours: Mon-Sat 9-18, Sun closed
    const hours = [0, 1, 2, 3, 4, 5, 6].map((wd) => ({
      businessId: created.id,
      weekday: wd,
      openTime: '09:00',
      closeTime: '18:00',
      isClosed: wd === 0, // Sunday closed by default
    }));
    await db.insert(businessHours).values(hours);

    // Default service for barbershop
    if ((type || 'barbershop') === 'barbershop') {
      await db.insert(businessServices).values({
        businessId: created.id,
        name: 'Corte de cabello',
        durationMin: 30,
        priceCents: 1500,
        currency: 'EUR',
        sortOrder: 1,
      });
    }

    return NextResponse.json({ business: created });
  } catch (e: any) {
    if (String(e?.message || '').includes('unique')) {
      return NextResponse.json({ error: 'Ese slug ya está en uso' }, { status: 409 });
    }
    console.error('[businesses POST]', e);
    return NextResponse.json({ error: 'Error al crear' }, { status: 500 });
  }
}
