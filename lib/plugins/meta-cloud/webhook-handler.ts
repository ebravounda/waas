import { db } from '@/lib/db/drizzle';
import { chats, messages, evolutionInstances } from '@/lib/db/schema';
import { and, eq, desc, sql } from 'drizzle-orm';
import { pusherServer } from '@/lib/pusher-server';
import { scheduleAIProcessing } from '@/lib/plugins/ai-chat/service';

/**
 * Meta Cloud API webhook entry.
 * The Graph API sends batches like:
 * {
 *   object: 'whatsapp_business_account',
 *   entry: [{
 *     id: '<WABA_ID>',
 *     changes: [{
 *       field: 'messages',
 *       value: {
 *         messaging_product: 'whatsapp',
 *         metadata: { display_phone_number, phone_number_id },
 *         contacts: [{ profile: { name }, wa_id }],
 *         messages: [{ from, id, timestamp, type, text: {body}, ... }],
 *         statuses: [{ id, status, timestamp, recipient_id, ... }]
 *       }
 *     }]
 *   }]
 * }
 */

type MetaContact = { profile?: { name?: string }; wa_id: string };
type MetaMessage = {
  from: string;
  id: string;
  timestamp: string;
  type: string;
  text?: { body: string };
  image?: { id: string; mime_type: string; caption?: string; sha256?: string };
  video?: { id: string; mime_type: string; caption?: string };
  audio?: { id: string; mime_type: string; voice?: boolean };
  document?: { id: string; mime_type: string; filename?: string; caption?: string };
  sticker?: { id: string; mime_type: string };
  location?: { latitude: number; longitude: number; name?: string; address?: string };
  contacts?: any[];
  reaction?: { message_id: string; emoji: string };
  button?: { payload: string; text: string };
  interactive?: {
    type: string;
    button_reply?: { id: string; title: string };
    list_reply?: { id: string; title: string; description?: string };
  };
  context?: { from: string; id: string };
};
type MetaStatus = {
  id: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  timestamp: string;
  recipient_id: string;
  errors?: any[];
};

function toRemoteJid(waId: string): string {
  return `${waId}@s.whatsapp.net`;
}

function statusWeight(s: string | null | undefined): number {
  switch (s) {
    case 'read': return 3;
    case 'delivered': return 2;
    case 'sent': return 1;
    default: return 0;
  }
}

/** Extract a preview text + payload columns for a Meta message. */
function normalizeMessage(msg: MetaMessage) {
  let messageType = 'conversation';
  let text: string | null = null;
  const media: any = {};

  switch (msg.type) {
    case 'text':
      text = msg.text?.body || '';
      break;
    case 'image':
      messageType = 'imageMessage';
      text = msg.image?.caption || null;
      media.mediaCaption = msg.image?.caption || null;
      media.mediaMimetype = msg.image?.mime_type || 'image/jpeg';
      if (msg.image?.id) media.mediaUrl = `meta://${msg.image.id}`;
      break;
    case 'video':
      messageType = 'videoMessage';
      text = msg.video?.caption || null;
      media.mediaCaption = msg.video?.caption || null;
      media.mediaMimetype = msg.video?.mime_type || 'video/mp4';
      if (msg.video?.id) media.mediaUrl = `meta://${msg.video.id}`;
      break;
    case 'audio':
      messageType = 'audioMessage';
      media.mediaMimetype = msg.audio?.mime_type || 'audio/ogg';
      media.mediaIsPtt = msg.audio?.voice ?? true;
      if (msg.audio?.id) media.mediaUrl = `meta://${msg.audio.id}`;
      break;
    case 'document':
      messageType = 'documentMessage';
      text = msg.document?.caption || msg.document?.filename || null;
      media.mediaCaption = msg.document?.caption || null;
      media.mediaMimetype = msg.document?.mime_type || 'application/octet-stream';
      if (msg.document?.id) media.mediaUrl = `meta://${msg.document.id}`;
      break;
    case 'sticker':
      messageType = 'stickerMessage';
      media.mediaMimetype = msg.sticker?.mime_type || 'image/webp';
      if (msg.sticker?.id) media.mediaUrl = `meta://${msg.sticker.id}`;
      break;
    case 'location':
      messageType = 'locationMessage';
      text = msg.location?.name || msg.location?.address || '📍 Location';
      break;
    case 'interactive':
      messageType = 'templateButtonReplyMessage';
      text = msg.interactive?.button_reply?.title
          || msg.interactive?.list_reply?.title
          || 'Interactive reply';
      break;
    case 'button':
      messageType = 'templateButtonReplyMessage';
      text = msg.button?.text || msg.button?.payload || 'Button reply';
      break;
    case 'reaction':
      // Handled separately (updates message_reactions table). Skip main message insert.
      messageType = 'reaction';
      text = msg.reaction?.emoji || null;
      break;
    default:
      messageType = msg.type || 'conversation';
      text = null;
  }

  return { messageType, text, media };
}

/** Preview text for chat list. */
function previewFor(messageType: string, text: string | null): string {
  if (text && text.trim()) return text.slice(0, 100);
  switch (messageType) {
    case 'imageMessage': return '📷 Image';
    case 'videoMessage': return '🎥 Video';
    case 'audioMessage': return '🎵 Audio';
    case 'documentMessage': return '📄 Document';
    case 'stickerMessage': return '🌟 Sticker';
    case 'locationMessage': return '📍 Location';
    default: return '';
  }
}

async function safePusher(channel: string, event: string, data: any) {
  try { await pusherServer.trigger(channel, event, data); } catch (e: any) {
    console.error('[meta-webhook pusher]', e?.message);
  }
}

/**
 * Process a batch of Meta webhook entries.
 * Fire-and-forget from the route (already returned 200 to Meta).
 */
export async function processMetaWebhook(entries: any[]): Promise<void> {
  for (const entry of entries) {
    const wabaId = entry?.id;
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];

    for (const change of changes) {
      if (change?.field !== 'messages') continue;
      const value = change.value || {};
      const phoneNumberId: string | undefined = value?.metadata?.phone_number_id;
      if (!phoneNumberId) continue;

      // Resolve the tenant instance from phone_number_id (unique per WABA in Meta)
      const instance = await db.query.evolutionInstances.findFirst({
        where: eq(evolutionInstances.metaPhoneNumberId, phoneNumberId),
      });
      if (!instance) {
        console.warn(`[meta-webhook] No instance for phone_number_id=${phoneNumberId} (waba=${wabaId})`);
        continue;
      }
      const teamId = instance.teamId;
      const instanceId = instance.id;
      const pusherChannel = `team-${teamId}`;

      const metaContacts: MetaContact[] = Array.isArray(value.contacts) ? value.contacts : [];
      const contactByWaId: Record<string, string | undefined> = {};
      for (const c of metaContacts) contactByWaId[c.wa_id] = c.profile?.name;

      // ─── Incoming messages ───
      const metaMessages: MetaMessage[] = Array.isArray(value.messages) ? value.messages : [];
      for (const m of metaMessages) {
        if (m.type === 'reaction') {
          // Optional: handle reactions in the future. Skip storage for now.
          continue;
        }

        const remoteJid = toRemoteJid(m.from);
        const timestamp = new Date(parseInt(m.timestamp, 10) * 1000);
        const pushName = contactByWaId[m.from];
        const { messageType, text, media } = normalizeMessage(m);
        const preview = previewFor(messageType, text);

        try {
          const [chat] = await db.insert(chats).values({
            teamId,
            remoteJid,
            instanceId,
            name: pushName || remoteJid.split('@')[0],
            pushName: pushName || null,
            lastMessageText: preview,
            lastMessageTimestamp: timestamp,
            unreadCount: 1,
            lastMessageFromMe: false,
            lastMessageStatus: null,
            lastCustomerInteraction: timestamp,
          }).onConflictDoUpdate({
            target: [chats.teamId, chats.remoteJid, chats.instanceId],
            set: {
              lastMessageText: preview,
              lastMessageTimestamp: timestamp,
              unreadCount: sql`${chats.unreadCount} + 1`,
              lastMessageFromMe: false,
              lastCustomerInteraction: timestamp,
              ...(pushName ? { name: pushName, pushName: pushName } : {}),
            },
          }).returning({
            id: chats.id, remoteJid: chats.remoteJid, name: chats.name,
            profilePicUrl: chats.profilePicUrl, unreadCount: chats.unreadCount,
            instanceId: chats.instanceId,
          });

          const newMessage: any = {
            id: m.id,
            chatId: chat.id,
            fromMe: false,
            messageType,
            text,
            timestamp,
            status: 'delivered',
            isInternal: false,
            isAi: false,
            quotedMessageText: null,
            quotedMessageId: m.context?.id || null,
            ...media,
          };

          const [inserted] = await db.insert(messages).values(newMessage).onConflictDoNothing().returning({ id: messages.id });
          if (!inserted) continue; // duplicate

          await safePusher(pusherChannel, 'new-message', {
            ...newMessage,
            timestamp: timestamp.toISOString(),
            remoteJid,
            instance: instance.instanceName,
            instanceId,
            lastMessageTextPreview: preview,
          });
          await safePusher(pusherChannel, 'chat-list-update', {
            id: chat.id,
            lastMessageText: preview,
            lastMessageTimestamp: timestamp.toISOString(),
            lastMessageFromMe: false,
            lastMessageStatus: null,
            remoteJid,
            unreadCount: chat.unreadCount,
            name: chat.name,
            profilePicUrl: chat.profilePicUrl,
            instanceId: chat.instanceId,
          });

          // Trigger AI for non-group non-self text messages
          if (text || messageType === 'audioMessage') {
            scheduleAIProcessing(teamId, chat.id, instanceId);
          }
        } catch (err: any) {
          console.error('[meta-webhook] insert failed:', err?.message);
        }
      }

      // ─── Delivery / read receipts for messages WE sent ───
      const statuses: MetaStatus[] = Array.isArray(value.statuses) ? value.statuses : [];
      for (const s of statuses) {
        try {
          const dbStatus =
            s.status === 'read' ? 'read' :
            s.status === 'delivered' ? 'delivered' :
            s.status === 'sent' ? 'sent' : null;
          if (!dbStatus) continue;

          const currentMsg = await db.query.messages.findFirst({
            where: and(eq(messages.id, s.id), eq(messages.fromMe, true)),
            columns: { id: true, status: true, chatId: true, timestamp: true },
          });
          if (!currentMsg) continue;
          if (statusWeight(dbStatus) <= statusWeight(currentMsg.status)) continue;

          await db.update(messages).set({ status: dbStatus }).where(eq(messages.id, s.id));

          const chat = await db.query.chats.findFirst({
            where: eq(chats.id, currentMsg.chatId),
            columns: { id: true, lastMessageStatus: true, remoteJid: true, instanceId: true },
          });
          if (!chat) continue;

          await safePusher(pusherChannel, 'message-status-update', {
            messageId: s.id,
            status: dbStatus,
            instance: instance.instanceName,
            remoteJid: chat.remoteJid,
          });

          const latest = await db.query.messages.findFirst({
            where: eq(messages.chatId, chat.id),
            orderBy: [desc(messages.timestamp)],
            columns: { id: true },
          });
          if (latest?.id === s.id && statusWeight(dbStatus) > statusWeight(chat.lastMessageStatus)) {
            await db.update(chats).set({ lastMessageStatus: dbStatus }).where(eq(chats.id, chat.id));
            await safePusher(pusherChannel, 'chat-list-update', {
              id: chat.id,
              lastMessageStatus: dbStatus,
              remoteJid: chat.remoteJid,
              instanceId: chat.instanceId,
            });
          }
        } catch (err: any) {
          console.error('[meta-webhook status] error:', err?.message);
        }
      }
    }
  }
}
