import OpenAI from 'openai';
import { AIProvider, AIProviderConfig, AIMessage, ToolDefinition } from '../types';
import type { ChatCompletionTool } from 'openai/resources/chat/completions';

/**
 * Groq provider — uses the OpenAI SDK pointed at Groq's OpenAI-compatible endpoint.
 * https://console.groq.com/docs/openai
 *
 * Notes:
 * - Groq supports text chat + tool calling (functions) on its Llama / Mixtral models.
 * - Groq does NOT support audio transcription via this endpoint (uses whisper-large-v3
 *   via a different REST endpoint). We expose transcribeAudio as a no-op throw.
 * - Image input is not supported on most Groq models, so we ignore attachments
 *   except for text/markdown/json (appended as knowledge base into the system prompt).
 */
export class GroqProvider implements AIProvider {
  private client: OpenAI;
  private model: string;
  private systemPrompt?: string;
  private attachments: { name: string; url: string; type: string; size: number }[];
  private temperature: number;
  private maxTokens: number;

  constructor(config: AIProviderConfig) {
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: 'https://api.groq.com/openai/v1',
    });
    this.model = config.model;
    this.systemPrompt = config.systemPrompt;
    this.attachments = config.attachments || [];
    this.temperature = config.temperature ?? 0.7;
    this.maxTokens = config.maxOutputTokens ?? 1000;
  }

  async generateResponse(messages: AIMessage[], tools?: ToolDefinition[]): Promise<AIMessage> {
    const formattedTools: ChatCompletionTool[] | undefined = tools?.map(t => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));

    // Sanitize history (same logic as OpenAI provider): drop orphan tool messages,
    // strip dangling tool_calls without a paired tool response.
    const sanitized: AIMessage[] = [];
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      if (m.role === 'tool') {
        const matchingAssistantIdx = (() => {
          for (let j = sanitized.length - 1; j >= 0; j--) {
            const prev = sanitized[j];
            if (prev.role === 'assistant' && prev.toolCalls?.some(tc => tc.id === m.toolCallId)) return j;
            if (prev.role === 'user' || prev.role === 'system') return -1;
          }
          return -1;
        })();
        if (matchingAssistantIdx === -1) continue;
        sanitized.push(m);
      } else if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
        const allHaveResponses = m.toolCalls.every(tc =>
          messages.slice(i + 1).some(later => later.role === 'tool' && later.toolCallId === tc.id)
        );
        if (allHaveResponses) sanitized.push(m);
        else sanitized.push({ ...m, toolCalls: undefined, content: m.content || '' });
      } else {
        sanitized.push(m);
      }
    }

    // Build system prompt with any text knowledge attachments inlined.
    let finalSystemPrompt = this.systemPrompt || '';
    if (this.attachments.length > 0) {
      for (const att of this.attachments) {
        const isText =
          att.type?.startsWith('text/') ||
          ['.txt', '.md', '.csv', '.json'].some(ext => att.name.endsWith(ext));
        if (!isText) continue;
        try {
          // Attachments live under public/uploads/ai-attachments/* with URL starting with /uploads/
          const fs = await import('fs/promises');
          const path = await import('path');
          const cleanPath = att.url.replace(/\\/g, '/');
          const filePath = path.join(process.cwd(), 'public', cleanPath.startsWith('/') ? cleanPath.slice(1) : cleanPath);
          const content = await fs.readFile(filePath, 'utf-8');
          finalSystemPrompt += `\n\n--- Knowledge Base (${att.name}) ---\n${content}\n--- End ---\n`;
        } catch {
          // ignore unreadable files
        }
      }
    }

    const apiMessages: any[] = sanitized.map(m => {
      if (m.role === 'tool') {
        return {
          role: 'tool',
          tool_call_id: m.toolCallId,
          content: typeof m.content === 'string' ? m.content : '',
        };
      }
      const hasToolCalls = m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0;
      const safeContent = m.content === null || m.content === undefined
        ? (hasToolCalls ? null : '')
        : m.content;
      return {
        role: m.role,
        content: safeContent,
        tool_calls: m.toolCalls,
      };
    });

    // Inject/replace system message
    const filtered = apiMessages.filter(m => m.role !== 'system');
    if (finalSystemPrompt) filtered.unshift({ role: 'system', content: finalSystemPrompt });

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: filtered,
      tools: formattedTools && formattedTools.length > 0 ? formattedTools : undefined,
      temperature: this.temperature,
      max_tokens: this.maxTokens,
    });

    const choice = response.choices[0].message;
    return {
      role: 'assistant',
      content: choice.content,
      toolCalls: choice.tool_calls,
    };
  }

  async transcribeAudio(audioUrl: string): Promise<string> {
    // Groq exposes whisper-large-v3 on POST /openai/v1/audio/transcriptions.
    try {
      const audioRes = await fetch(audioUrl);
      const blob = await audioRes.blob();
      const file = new File([blob], 'audio.mp3', { type: blob.type || 'audio/mpeg' });
      const transcription = await this.client.audio.transcriptions.create({
        file,
        model: 'whisper-large-v3',
      });
      return transcription.text;
    } catch (e: any) {
      console.error('[groq] transcription failed', e?.message);
      throw e;
    }
  }
}
