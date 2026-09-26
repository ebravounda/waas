import { NextResponse } from 'next/server';
import { getTeamForUser, getUser } from '@/lib/db/queries';
import { db } from '@/lib/db/drizzle';
import { evolutionInstances, ActivityType } from '@/lib/db/schema';
import { logActivity } from '@/lib/db/activity';
import { enforceLimit } from '@/lib/limits';
import { isPluginInstalled } from '@/lib/plugins/registry';
import { and, eq } from 'drizzle-orm';

const GRAPH_URL = 'https://graph.facebook.com';
const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v21.0';

/**
 * Manual connection to Meta Cloud API (BYOA — Bring Your Own App).
 * The user pastes credentials from their own Meta App / WABA.
 * Saved directly in evolution_instances with integration='META-CLOUD' — the
 * provider-factory then uses MetaCloudProvider for all sends.
 *
 * Body:
 *   instanceName, metaToken, metaPhoneNumberId, metaWabaId (recommended),
 *   metaBusinessId (optional), metaAppId (optional, informational),
 *   metaAppSecret (recommended — enables per-instance HMAC verification)
 */
export async function POST(request: Request) {
  try {
    if (!isPluginInstalled('meta-cloud')) {
      return NextResponse.json({ error: 'Meta Cloud plugin is not installed' }, { status: 400 });
    }

    const user = await getUser();
    const team = await getTeamForUser();
    if (!team || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    try { await enforceLimit(team.id, 'instances'); }
    catch (e: any) { return NextResponse.json({ error: e.message }, { status: 403 }); }

    const b = await request.json();
    const instanceName = String(b.instanceName || '').trim();
    const metaToken = String(b.metaToken || '').trim();
    const metaPhoneNumberId = String(b.metaPhoneNumberId || '').trim();
    const metaWabaId = String(b.metaWabaId || '').trim();
    const metaBusinessId = b.metaBusinessId ? String(b.metaBusinessId).trim() : null;
    const metaAppId = b.metaAppId ? String(b.metaAppId).trim() : null;
    const metaAppSecret = b.metaAppSecret ? String(b.metaAppSecret).trim() : null;

    if (!instanceName || !metaToken || !metaPhoneNumberId) {
      return NextResponse.json({ error: 'instanceName, metaToken y metaPhoneNumberId son obligatorios' }, { status: 400 });
    }

    // Validate token by calling Graph API for the phone number
    let verifiedName = '';
    let displayPhoneNumber = '';
    try {
      const res = await fetch(
        `${GRAPH_URL}/${GRAPH_VERSION}/${metaPhoneNumberId}?fields=verified_name,display_phone_number,quality_rating`,
        {
          headers: { 'Authorization': `Bearer ${metaToken}` },
          signal: AbortSignal.timeout(10000),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        const msg = data?.error?.message || `Meta rechazó las credenciales (${res.status})`;
        return NextResponse.json({ error: msg }, { status: 400 });
      }
      verifiedName = data.verified_name || '';
      displayPhoneNumber = data.display_phone_number || '';
    } catch (e: any) {
      return NextResponse.json({ error: `No se pudo contactar a Meta: ${e?.message || 'timeout'}` }, { status: 400 });
    }

    // Compose a unique internal instance name
    const slug = `t${team.id}_${Date.now().toString(36)}`;
    const sanitized = instanceName.replace(/[^a-zA-Z0-9_-]/g, '') || 'meta';
    const evoInstanceName = `${slug}_${sanitized}`;
    const userDisplayName = instanceName;

    // If a duplicate WABA/phoneNumberId already exists for this team, refuse
    const existing = await db.query.evolutionInstances.findFirst({
      where: and(
        eq(evolutionInstances.teamId, team.id),
        eq(evolutionInstances.metaPhoneNumberId, metaPhoneNumberId),
      ),
    });
    if (existing) {
      return NextResponse.json({ error: 'Este número ya está conectado en tu equipo' }, { status: 409 });
    }

    const [newInstance] = await db.insert(evolutionInstances).values({
      teamId: team.id,
      instanceName: evoInstanceName,
      displayName: userDisplayName,
      instanceNumber: displayPhoneNumber || metaPhoneNumberId,
      integration: 'META-CLOUD',
      metaToken,
      metaPhoneNumberId,
      metaWabaId: metaWabaId || null,
      metaBusinessId,
      metaAppId,
      metaAppSecret,
      accessToken: metaToken, // legacy fallback used by other code paths
    }).returning();

    await logActivity(team.id, user.id, ActivityType.CREATE_INSTANCE);

    return NextResponse.json({
      success: true,
      instance: {
        id: newInstance.id,
        name: userDisplayName,
        phoneNumber: displayPhoneNumber,
        verifiedName,
        integration: 'META-CLOUD',
      },
    });
  } catch (error: any) {
    console.error('[Meta Manual Setup] Error:', error?.message || error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
