import type { AgentRuntime, ChatMessage, ChatOptions, ChatResult } from './types';

export interface OpenAICompatConfig {
  name: string;
  baseUrl: string;
  apiKey: string;
  model?: string;
  fetchImpl?: typeof fetch;
}

export class OpenAICompatProvider implements AgentRuntime {
  readonly name: string;
  readonly model: string;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: OpenAICompatConfig) {
    this.name = config.name;
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.apiKey = config.apiKey;
    this.model = config.model ?? 'deepseek-chat';
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async chat(messages: ChatMessage[], opts?: ChatOptions): Promise<ChatResult> {
    const res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        temperature: opts?.temperature ?? 0.2,
        max_tokens: opts?.maxTokens ?? 1024,
        stream: false,
      }),
    });
    if (!res.ok) {
      throw new Error(`llm ${this.name} -> ${res.status}: ${await res.text()}`);
    }
    const body = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: Record<string, unknown>;
    };
    const text = body.choices?.[0]?.message?.content ?? '';
    return { text, usage: body.usage };
  }
}
