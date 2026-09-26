import { NextResponse } from 'next/server';
import { isPluginInstalled } from '@/lib/plugins/registry';
import { checkRateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit';
import { verifyMetaSignature } from '@/lib/plugins/meta-cloud/signature';
import { getMetaCloudConfig } from '@/lib/whatsapp/config';
import { db } from '@/lib/db/drizzle';
import { evolutionInstances } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

const VERIFY_TOKEN = process.env.META_WEBHOOK_VERIFY_TOKEN || process.env.NEXT_PUBLIC_EVOLUTION_WEBHOOK_TOKEN;

// GET → verification handshake from Meta
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  const config = await getMetaCloudConfig().catch(() => null);
  const dbToken = config?.webhookToken || '';
  const validToken = dbToken || VERIFY_TOKEN;

  if (mode === 'subscribe' && token && validToken && token === validToken) {
    console.log('[Meta Webhook] Verification OK');
    return new Response(challenge || '', { status: 200, headers: { 'Content-Type': 'text/plain' } });
  }
  console.warn('[Meta Webhook] Verification FAILED (token mismatch)');
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}

// POST → incoming messages / status
export async function POST(request: Request) {
  const limited = checkRateLimit(`webhook:meta:${getClientIp(request)}`, RATE_LIMITS.webhook);
  if (limited) return limited;

  try {
    if (!isPluginInstalled('meta-cloud')) {
      return NextResponse.json({ error: 'Meta Cloud plugin not installed' }, { status: 400 });
    }

    // Read raw body FIRST for HMAC verification, then parse JSON
    const rawBody = await request.text();
    const signature = request.headers.get('x-hub-signature-256');

    let body: any;
    try { body = JSON.parse(rawBody); } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }); }

    if (body.object !== 'whatsapp_business_account') {
      return NextResponse.json({ received: true, ignored: true });
    }

    // ── HMAC verification ──
    // 1) Try each instance's per-tenant app_secret (multi-tenant BYOA).
    // 2) Fall back to the platform-wide app_secret from channel_configs (SaaS solution-partner).
    // If neither validates, reject.
    const wabaId: string | undefined = body?.entry?.[0]?.id;
    let verified = false;

    if (signature) {
      // 1) Per-instance app secret
      if (wabaId) {
        const inst = await db.query.evolutionInstances.findFirst({
          where: eq(evolutionInstances.metaWabaId, wabaId),
          columns: { metaAppSecret: true },
        }).catch(() => null);
        if (inst?.metaAppSecret && verifyMetaSignature(rawBody, signature, inst.metaAppSecret)) {
          verified = true;
        }
      }
      // 2) Global app secret from channel_configs / env
      if (!verified) {
        const cfg = await getMetaCloudConfig().catch(() => null);
        const globalSecret = cfg?.appSecret || process.env.META_APP_SECRET || '';
        if (globalSecret && verifyMetaSignature(rawBody, signature, globalSecret)) {
          verified = true;
        }
      }
    }

    if (!verified) {
      // Meta always signs prod webhooks. We refuse without a valid signature
      // BUT we still return 200 so Meta doesn't disable the subscription while
      // the admin is fixing config. We just don't process the event.
      console.warn('[Meta Webhook] HMAC signature invalid or missing — skipping processing');
      return NextResponse.json({ received: true, verified: false });
    }

    const entries = body.entry;
    if (!Array.isArray(entries) || entries.length === 0) {
      return NextResponse.json({ received: true });
    }

    // Dynamically import so an environment without the plugin can still build.
    const { processMetaWebhook } = await import('@/lib/plugins/meta-cloud/webhook-handler');
    processMetaWebhook(entries).catch((e) => {
      console.error('[Meta Webhook] Processing error:', e?.message || e);
    });

    return NextResponse.json({ received: true });
  } catch (error: any) {
    console.error('[Meta Webhook] Error:', error?.message || error);
    // Always 200 to Meta to prevent retries; log our error.
    return NextResponse.json({ received: true });
  }
}
