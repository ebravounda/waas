import OpenAI from 'openai';
import { AIProvider, AIProviderConfig, AIMessage, ToolDefinition } from '../types';
import type { ChatCompletionTool } from 'openai/resources/chat/completions';
import fs from 'fs/promises';
import path from 'path';

export class OpenAIProvider implements AIProvider {
  private client: OpenAI;
  private model: string;
  private systemPrompt?: string;
  private attachments: { name: string; url: string; type: string; size: number }[];

  constructor(config: AIProviderConfig) {
    this.client = new OpenAI({ apiKey: config.apiKey });
    this.model = config.model;
    this.systemPrompt = config.systemPrompt;
    this.attachments = config.attachments || [];
  }

  private async getFileContent(url: string): Promise<{ data: string, mimeType: string } | null> {
    try {
        let fileData: string;
        let mimeType = 'application/octet-stream';
        
        const cleanPath = url.replace(/\\/g, '/');
        const filePath = path.join(process.cwd(), 'public', cleanPath.startsWith('/') ? cleanPath.slice(1) : cleanPath);
        
        try {
            await fs.access(filePath);
        } catch {
            return null;
        }

        const fileBuffer = await fs.readFile(filePath);
        fileData = fileBuffer.toString('base64');
            
        if (cleanPath.endsWith('.png')) mimeType = 'image/png';
        else if (cleanPath.endsWith('.jpg') || cleanPath.endsWith('.jpeg')) mimeType = 'image/jpeg';
        else if (cleanPath.endsWith('.webp')) mimeType = 'image/webp';
        else if (cleanPath.endsWith('.gif')) mimeType = 'image/gif';
        else if (cleanPath.endsWith('.txt') || cleanPath.endsWith('.md') || cleanPath.endsWith('.csv') || cleanPath.endsWith('.json')) mimeType = 'text/plain';

        return { data: fileData, mimeType };
    } catch (e) {
        return null;
    }
  }

  async generateResponse(messages: AIMessage[], tools?: ToolDefinition[]): Promise<AIMessage> {
    const formattedTools: ChatCompletionTool[] | undefined = tools?.map(t => ({
      type: 'function' as const, 
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      }
    }));

    // Sanitize message history to avoid OpenAI 400 error:
    // "messages with role 'tool' must be a response to a preceding message with 'tool_calls'"
    // Drop orphan tool messages and assistant.tool_calls that lack a matching tool response.
    const sanitized: AIMessage[] = [];
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      if (m.role === 'tool') {
        // Find the most recent assistant message with matching tool_call_id in sanitized list
        const matchingAssistantIdx = (() => {
          for (let j = sanitized.length - 1; j >= 0; j--) {
            const prev = sanitized[j];
            if (prev.role === 'assistant' && prev.toolCalls?.some(tc => tc.id === m.toolCallId)) {
              return j;
            }
            // If we hit a user/system message, stop looking (broke the chain)
            if (prev.role === 'user' || prev.role === 'system') return -1;
          }
          return -1;
        })();
        if (matchingAssistantIdx === -1) {
          // Orphan tool message - skip it
          continue;
        }
        sanitized.push(m);
      } else if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
        // Check that ALL tool_calls in this assistant message have corresponding tool responses
        // somewhere later in the original messages array
        const allHaveResponses = m.toolCalls.every(tc =>
          messages.slice(i + 1).some(later => later.role === 'tool' && later.toolCallId === tc.id)
        );
        if (allHaveResponses) {
          sanitized.push(m);
        } else {
          // Strip tool_calls (turn into plain assistant text message) to keep flow consistent
          sanitized.push({ ...m, toolCalls: undefined, content: m.content || '' });
        }
      } else {
        sanitized.push(m);
      }
    }

    const apiMessages: any[] = [...sanitized.map(m => {
        if (m.role === 'tool') {
            return {
                role: 'tool',
                tool_call_id: m.toolCallId,
                content: m.content
            };
        }
        return {
            role: m.role,
            content: m.content,
            tool_calls: m.toolCalls 
        };
    })];

    let finalSystemPrompt = this.systemPrompt || "";
    const systemImages: { type: 'image_url', image_url: { url: string } }[] = [];

    if (this.attachments.length > 0) {
        for (const att of this.attachments) {
            const file = await this.getFileContent(att.url);
            if (!file) continue;

            if (att.type.startsWith('image/')) {
                systemImages.push({
                    type: 'image_url',
                    image_url: { url: `data:${file.mimeType};base64,${file.data}` }
                });
            } else if (att.type.startsWith('text/') || att.name.endsWith('.txt') || att.name.endsWith('.md') || att.name.endsWith('.csv') || att.name.endsWith('.json')) {
                const textContent = Buffer.from(file.data, 'base64').toString('utf-8');
                finalSystemPrompt += `\n\n--- Knowledge Base (${att.name}) ---\n${textContent}\n--- End ---\n`;
            }
        }
    }

    const systemContent: any[] = [{ type: 'text', text: finalSystemPrompt }];
    systemImages.forEach(img => systemContent.push(img));

    const cleanMessages = apiMessages.filter(m => m.role !== 'system');
    cleanMessages.unshift({ role: 'system', content: systemContent });

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: cleanMessages,
      tools: formattedTools && formattedTools.length > 0 ? formattedTools : undefined,
    });

    const choice = response.choices[0].message;

    return {
      role: 'assistant',
      content: choice.content,
      toolCalls: choice.tool_calls
    };
  }

  async transcribeAudio(audioUrl: string): Promise<string> {
    try {
        const response = await fetch(audioUrl);
        const blob = await response.blob();
        const file = new File([blob], "audio.mp3", { type: blob.type });

        const transcription = await this.client.audio.transcriptions.create({
            file: file, 
            model: "whisper-1",
        });
        return transcription.text;
    } catch (e) {
        console.error(e);
        throw e;
    }
  }
}