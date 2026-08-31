import { describe, expect, it } from 'vitest';
import { OpenAICompatProvider } from '../src/openai-compat';

describe('OpenAICompatProvider contract (agent-gateway)', () => {
  it('sends model + messages and unwraps choices[0].message.content', async () => {
    let captured: { url: string; init: RequestInit } | null = null;
    const provider = new OpenAICompatProvider({
      name: 'deepseek',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-test',
      fetchImpl: (async (url: string, init: RequestInit) => {
        captured = { url, init };
        return new Response(
          JSON.stringify({ choices: [{ message: { content: '分析结论：风险低' } }] }),
          { status: 200 },
        );
      }) as typeof fetch,
    });

    const res = await provider.chat([
      { role: 'system', content: 'you are a devops copilot' },
      { role: 'user', content: 'analyze this deployment' },
    ]);

    expect(provider.name).toBe('deepseek');
    expect(provider.model).toBe('deepseek-chat');
    expect(captured).not.toBeNull();
    expect(captured?.url).toBe('https://api.example.com/v1/chat/completions');
    const body = JSON.parse(captured!.init.body as string);
    expect(body.model).toBe('deepseek-chat');
    expect(body.messages).toHaveLength(2);
    expect(res.text).toBe('分析结论：风险低');
  });

  it('throws a clear error on non-2xx', async () => {
    const provider = new OpenAICompatProvider({
      name: 'deepseek',
      baseUrl: 'https://api.example.com/v1',
      fetchImpl: (async () => new Response('{"error":"bad key"}', { status: 401 })) as typeof fetch,
    });
    await expect(provider.chat([{ role: 'user', content: 'hi' }])).rejects.toThrow(/401/);
  });
});
