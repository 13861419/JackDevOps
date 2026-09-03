import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { OpenAICompatProvider, type AgentRuntime, type ChatMessage } from '@jackdevops/agent-gateway';

@Injectable()
export class LlmService {
  readonly available: boolean;
  private runtime?: AgentRuntime;

  constructor() {
    const baseUrl = process.env.JACK_LLM_BASE_URL;
    const apiKey = process.env.JACK_LLM_API_KEY;
    this.available = Boolean(baseUrl && apiKey);
    if (baseUrl && apiKey) {
      this.runtime = new OpenAICompatProvider({
        name: process.env.JACK_LLM_PROVIDER ?? 'openai-compat',
        baseUrl,
        apiKey,
        model: process.env.JACK_LLM_MODEL ?? 'deepseek-chat',
        maxTokens: Number(process.env.JACK_LLM_MAX_TOKENS) || undefined,
      });
    }
  }

  requireRuntime(): AgentRuntime {
    if (!this.runtime) {
      throw new ServiceUnavailableException(
        'LLM not configured: set JACK_LLM_BASE_URL, JACK_LLM_API_KEY (and optional JACK_LLM_MODEL)',
      );
    }
    return this.runtime;
  }

  async chat(messages: ChatMessage[]): Promise<{ answer: string }> {
    const runtime = this.requireRuntime();
    const res = await runtime.chat(messages);
    return { answer: res.text };
  }
}
