#!/usr/bin/env node
// Minimal OpenAI-compatible LLM stub for local smoke tests.
// Usage: node scripts/fake-llm.mjs [port]
import { createServer } from 'node:http';

const port = Number(process.argv[2] ?? 9999);

const server = createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
  });
  req.on('end', () => {
    let parsed = {};
    try {
      parsed = JSON.parse(body);
    } catch {
      parsed = {};
    }
    const userMsg = (parsed.messages ?? [])
      .filter((m) => m.role === 'user')
      .map((m) => m.content)
      .join(' ');
    const reply =
      `[fake-llm] 收到 ${userMsg.length} 字符上下文。` +
      '判断：扫描与构建均通过，无失败作业，建议放行；若失败，优先检查环境变量与依赖版本。';
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: reply } }], usage: { total_tokens: 42 } }));
  });
});

server.listen(port, () => console.log(`fake-llm listening on http://localhost:${port}`));
