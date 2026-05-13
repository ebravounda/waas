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

const NOT_INSTALLED = 'meta-cloud plugin is not installed';

export class MetaCloudProvider implements WhatsAppProvider {
  readonly providerType = 'meta-cloud';

  constructor(_instance: WhatsAppInstanceConfig) {
    throw new Error(NOT_INSTALLED);
  }

  async sendText(_jid: string, _payload: SendTextPayload): Promise<SendResult> {
    throw new Error(NOT_INSTALLED);
  }
  async sendMedia(_jid: string, _payload: SendMediaPayload): Promise<SendResult> {
    throw new Error(NOT_INSTALLED);
  }
  async sendAudio(_jid: string, _payload: SendAudioPayload): Promise<SendResult> {
    throw new Error(NOT_INSTALLED);
  }
  async sendReaction(_jid: string, _payload: SendReactionPayload): Promise<SendResult> {
    throw new Error(NOT_INSTALLED);
  }
  async sendInteractive(_jid: string, _payload: SendInteractivePayload): Promise<SendResult> {
    throw new Error(NOT_INSTALLED);
  }
  async sendTemplate(_jid: string, _payload: SendTemplatePayload): Promise<SendResult> {
    throw new Error(NOT_INSTALLED);
  }
  async getConnectionStatus(): Promise<ConnectionStatus> {
    return 'unknown';
  }
  async disconnect(): Promise<void> {}
}
