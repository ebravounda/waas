import type {
  WhatsAppProvider,
  WhatsAppInstanceConfig,
  SendTextPayload,
  SendMediaPayload,
  SendAudioPayload,
  SendReactionPayload,
  SendInteractivePayload,
  SendTemplatePayload,
  SendResult,
  ConnectionStatus,
} from '@/lib/whatsapp/types';

const GRAPH_URL = 'https://graph.facebook.com';
const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v21.0';

/**
 * Clean a WhatsApp JID / raw phone to Meta's expected E.164 without leading +.
 * Meta expects raw digits like "34600123456".
 */
function toWaId(remoteJid: string): string {
  return remoteJid.replace('@s.whatsapp.net', '').replace('@g.us', '').replace(/\D/g, '');
}

async function readTextSafe(res: Response): Promise<any> {
  const txt = await res.text();
  try { return JSON.parse(txt); } catch { return { error: txt.slice(0, 400) }; }
}

/**
 * Meta Cloud API provider.
 * Uses the Graph API (`/v21.0/{phone_number_id}/messages`).
 */
export class MetaCloudProvider implements WhatsAppProvider {
  readonly providerType = 'meta-cloud';

  private token: string;
  private phoneNumberId: string;
  private wabaId: string;

  constructor(instance: WhatsAppInstanceConfig) {
    this.token = instance.metaToken || '';
    this.phoneNumberId = instance.metaPhoneNumberId || '';
    this.wabaId = (instance as any).metaWabaId || '';

    if (!this.token || !this.phoneNumberId) {
      throw new Error('MetaCloudProvider requires metaToken and metaPhoneNumberId');
    }
  }

  private async post(payload: any): Promise<SendResult> {
    try {
      const res = await fetch(`${GRAPH_URL}/${GRAPH_VERSION}/${this.phoneNumberId}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15000),
      });
      const data = await readTextSafe(res);
      if (!res.ok) {
        if (res.status === 429) return { success: false, error: 'Rate limited by Meta API', raw: data };
        const errMsg = data?.error?.message || data?.error || `Meta API error ${res.status}`;
        return { success: false, error: errMsg, raw: data };
      }
      const messageId = data?.messages?.[0]?.id;
      return { success: true, messageId, raw: data };
    } catch (e: any) {
      return { success: false, error: e?.message || 'Meta request failed' };
    }
  }

  /**
   * Upload a media file to Meta and return media_id. Required before sending
   * media messages that reference an ID (versus a public URL).
   */
  async uploadMedia(fileBuffer: Buffer, mimeType: string, filename = 'file.bin'): Promise<string | null> {
    try {
      const form = new FormData();
      form.append('messaging_product', 'whatsapp');
      form.append('type', mimeType);
      form.append('file', new Blob([fileBuffer as any], { type: mimeType }), filename);

      const res = await fetch(`${GRAPH_URL}/${GRAPH_VERSION}/${this.phoneNumberId}/media`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${this.token}` },
        body: form as any,
        signal: AbortSignal.timeout(30000),
      });
      const data = await readTextSafe(res);
      if (!res.ok) return null;
      return data?.id || null;
    } catch {
      return null;
    }
  }

  async sendText(remoteJid: string, payload: SendTextPayload): Promise<SendResult> {
    const body: any = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: toWaId(remoteJid),
      type: 'text',
      text: { body: payload.text, preview_url: true },
    };
    if (payload.quoted?.id) body.context = { message_id: payload.quoted.id };
    return this.post(body);
  }

  async sendMedia(remoteJid: string, payload: SendMediaPayload): Promise<SendResult> {
    // payload.mediaBase64 is a base64 string. We upload to Meta first to get an id.
    const buf = Buffer.from(payload.mediaBase64, 'base64');
    const mediaType = payload.mediaType; // 'image' | 'video' | 'document'
    const mediaId = await this.uploadMedia(buf, payload.mimetype, payload.fileName || `file.${mediaType}`);
    if (!mediaId) return { success: false, error: 'Failed to upload media to Meta' };

    const body: any = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: toWaId(remoteJid),
      type: mediaType,
      [mediaType]: {
        id: mediaId,
        ...(payload.caption ? { caption: payload.caption } : {}),
        ...(mediaType === 'document' && payload.fileName ? { filename: payload.fileName } : {}),
      },
    };
    if (payload.quoted?.id) body.context = { message_id: payload.quoted.id };
    return this.post(body);
  }

  async sendAudio(remoteJid: string, payload: SendAudioPayload): Promise<SendResult> {
    const buf = Buffer.from(payload.audioBase64, 'base64');
    // Meta requires OGG opus for voice notes (PTT). If mimetype differs the message
    // will send as audio (not as a voice note). Client is responsible for encoding.
    const mediaId = await this.uploadMedia(buf, payload.mimetype || 'audio/ogg', 'audio.ogg');
    if (!mediaId) return { success: false, error: 'Failed to upload media to Meta' };

    const body: any = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: toWaId(remoteJid),
      type: 'audio',
      audio: { id: mediaId },
    };
    if (payload.quoted?.id) body.context = { message_id: payload.quoted.id };
    return this.post(body);
  }

  async sendReaction(remoteJid: string, payload: SendReactionPayload): Promise<SendResult> {
    const body: any = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: toWaId(remoteJid),
      type: 'reaction',
      reaction: {
        message_id: payload.messageId,
        emoji: payload.emoji || '',
      },
    };
    return this.post(body);
  }

  async sendInteractive(remoteJid: string, payload: SendInteractivePayload): Promise<SendResult> {
    const body: any = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: toWaId(remoteJid),
      type: 'interactive',
      interactive: {
        type: payload.type,
        body: payload.body,
        ...(payload.header ? { header: payload.header } : {}),
        ...(payload.footer ? { footer: payload.footer } : {}),
        action: payload.action,
      },
    };
    return this.post(body);
  }

  async sendTemplate(remoteJid: string, payload: SendTemplatePayload): Promise<SendResult> {
    const body: any = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: toWaId(remoteJid),
      type: 'template',
      template: {
        name: payload.templateName,
        language: { code: payload.language || 'es' },
        ...(payload.components ? { components: payload.components } : {}),
      },
    };
    return this.post(body);
  }

  async getConnectionStatus(): Promise<ConnectionStatus> {
    if (!this.token || !this.phoneNumberId) return 'unknown';
    try {
      const res = await fetch(
        `${GRAPH_URL}/${GRAPH_VERSION}/${this.phoneNumberId}?fields=verified_name,quality_rating,display_phone_number`,
        {
          headers: { 'Authorization': `Bearer ${this.token}` },
          signal: AbortSignal.timeout(8000),
        }
      );
      if (res.status === 401 || res.status === 403) return 'close';
      if (!res.ok) return 'unknown';
      return 'open';
    } catch {
      return 'unknown';
    }
  }

  async disconnect(): Promise<void> {
    // Meta Cloud API doesn't expose a logout endpoint per-instance. The recommended
    // path is to unsubscribe the WABA from the app or to revoke the access token
    // in the Business Manager. We noop here — the caller should remove the DB row.
    return;
  }
}
