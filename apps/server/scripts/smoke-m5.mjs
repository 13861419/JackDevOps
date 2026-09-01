#!/usr/bin/env node
// Smoke test for M5: preview environments (D8) + container-build job (D6).
// Usage: node scripts/smoke-m5.mjs [baseUrl] [token]
const base = process.argv[2] ?? 'http://localhost:3000';
const token = process.argv[3] ?? 'dev-admin-token';
const headers = { 'content-type': 'application/json', authorization: `Bearer ${token}` };

async function api(method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${method} ${path} -> ${res.status}: ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

const slug = `preview-demo-${Date.now().toString(36)}`;
const qs = await api('POST', '/onboarding/quickstart', { name: slug, language: 'node', ownerId: 'smoke' });
console.log('1) quickstart:', qs.service.slug);

const prNumber = 101;
const opened = await api('POST', `/webhooks/git/${slug}/pr`, { action: 'opened', number: prNumber, pull_request: { number: prNumber, title: 'feat: preview', head: { ref: 'feat/preview', sha: 'cafe123' } } });
console.log('2) PR opened -> preview:', opened.preview.status, opened.preview.url);
if (opened.preview.status !== 'ready' || !opened.preview.url.includes(`preview-pr-${prNumber}`)) {
  throw new Error('preview env not ready with deterministic URL');
}

const list = await api('GET', '/previews');
const mine = list.find((p) => p.serviceId === slug && p.prNumber === prNumber);
if (!mine) throw new Error('preview not listed');

const closed = await api('POST', `/webhooks/git/${slug}/pr`, { action: 'closed', number: prNumber });
console.log('3) PR closed -> preview:', closed.preview?.status);
if (closed.preview?.status !== 'destroyed') throw new Error('preview not destroyed on PR close');

const containerWf = await api('POST', '/workflows', {
  name: `${slug}-container`,
  spec: { jobs: [{ id: 'img', type: 'container-build', config: {} }] },
  actorId: 'smoke',
});
const cr = await api('POST', `/workflows/${containerWf.id}/runs`);
let crView = null;
for (let i = 0; i < 300; i++) {
  crView = await api('GET', `/runs/${cr.id}`);
  if (crView.status !== 'running') break;
  await new Promise((r) => setTimeout(r, 100));
}
console.log('4) container-build stub run:', crView.status);
if (crView.status !== 'succeeded') throw new Error('container-build stub run failed');

const auditPage = await api('GET', '/audit?limit=500');
const audit = auditPage.events ?? auditPage;
const previewEvents = audit.filter((e) => e.aggregateType === 'previewenv');
console.log('5) previewenv events in audit:', previewEvents.length, '| trace:', previewEvents[0]?.traceId.slice(0, 12));
console.log('SMOKE M5 OK');
