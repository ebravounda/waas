import { NextResponse } from 'next/server';
import { db } from '@/lib/db/drizzle';
import { evolutionInstances, messages, chats } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { getSession } from '@/lib/auth/session';
import { getUserWithTeam } from '@/lib/db/queries';

const GRAPH_URL = 'https://graph.facebook.com';
const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v21.0';

/**
 * Proxy download for Meta Cloud media (images, videos, audio, docs).
 * Incoming Meta messages store `mediaUrl` as `meta://<media_id>`. This route
 * takes a message_id, fetches the media_id, asks Meta for a temporary URL,
 * downloads the bytes with the tenant's access token and streams them back
 * to the browser. This keeps the access token server-side.
 *
 * GET /api/meta/media/[messageId]
 */
export async function GET(_req: Request, { params }: { params: Promise<{ messageId: string }> }) {
  const { messageId } = await params;

  const session = await getSession();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const u = await getUserWithTeam(session.user.id);
  if (!u?.teamId) return NextResponse.json({ error: 'No team' }, { status: 403 });

  const msg = await db.query.messages.findFirst({ where: eq(messages.id, messageId) });
  if (!msg?.mediaUrl?.startsWith('meta://')) {
    return NextResponse.json({ error: 'Not a Meta media message' }, { status: 404 });
  }
  const mediaId = msg.mediaUrl.slice('meta://'.length);

  // Ensure this chat belongs to the requesting team
  const chat = await db.query.chats.findFirst({ where: eq(chats.id, msg.chatId) });
  if (!chat || chat.teamId !== u.teamId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const instance = chat.instanceId
    ? await db.query.evolutionInstances.findFirst({
        where: and(eq(evolutionInstances.id, chat.instanceId), eq(evolutionInstances.teamId, u.teamId)),
      })
    : null;
  const token = instance?.metaToken || instance?.accessToken;
  if (!token) return NextResponse.json({ error: 'No Meta token available' }, { status: 400 });

  try {
    // 1) Get temporary URL for this media_id
    const infoRes = await fetch(`${GRAPH_URL}/${GRAPH_VERSION}/${mediaId}`, {
      headers: { 'Authorization': `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!infoRes.ok) return NextResponse.json({ error: `Meta media info failed (${infoRes.status})` }, { status: 502 });
    const info = await infoRes.json();
    const url: string | undefined = info?.url;
    const mime: string = info?.mime_type || msg.mediaMimetype || 'application/octet-stream';
    if (!url) return NextResponse.json({ error: 'Media URL not returned by Meta' }, { status: 502 });

    // 2) Download bytes (must send bearer token)
    const dl = await fetch(url, {
      headers: { 'Authorization': `Bearer ${token}` },
      signal: AbortSignal.timeout(30000),
    });
    if (!dl.ok) return NextResponse.json({ error: `Meta media download failed (${dl.status})` }, { status: 502 });

    const buf = Buffer.from(await dl.arrayBuffer());
    return new Response(new Uint8Array(buf), {
      headers: {
        'Content-Type': mime,
        'Content-Length': String(buf.length),
        'Cache-Control': 'private, max-age=300',
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Meta media fetch error' }, { status: 500 });
  }
}
