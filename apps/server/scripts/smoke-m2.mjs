#!/usr/bin/env node
// Smoke test for M2: progressive delivery + feature flags + DORA metrics.
// Usage: node scripts/smoke-m2.mjs [baseUrl] [token]
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

const qs = await api('POST', '/onboarding/quickstart', {
  name: `release-demo-${Date.now().toString(36)}`,
  language: 'node',
  ownerId: 'smoke',
});
console.log('1) quickstart:', qs.service.slug);

const run = await api('POST', `/workflows/${qs.workflow.id}/runs`);
let runView = null;
for (let i = 0; i < 300; i++) {
  runView = await api('GET', `/runs/${run.id}`);
  if (runView.status !== 'running') break;
  await new Promise((r) => setTimeout(r, 100));
}
console.log('2) run:', runView.status);

const version = `v1.0.${Date.now().toString(36)}`;
const release = await api('POST', '/releases', {
  runId: run.id,
  version,
  artifacts: ['image:smoke'],
  strategy: 'canary',
  actorId: 'smoke',
});
console.log('3) release registered:', release.id, 'strategy:', release.strategy, 'steps:', release.steps.map((s) => s.weight).join('/'));

const promoted = await api('POST', `/releases/${release.id}/promote`);
console.log('4) promoted:', promoted.status, 'steps all succeeded:', promoted.steps.every((s) => s.status === 'succeeded'));

const flag = await api('POST', '/flags', { key: `smoke-flag-${Date.now().toString(36)}`, rolloutPercent: 100, actorId: 'smoke' });
const evaluation = await api('GET', `/flags/${flag.key}/evaluate?userId=smoke-user`);
console.log('5) flag evaluated:', JSON.stringify(evaluation));

const dora = await api('GET', '/metrics/dora?days=30');
console.log('6) DORA: deployments =', dora.deployments, '| CFR =', dora.changeFailureRate, '| freq/day =', dora.deploymentFrequencyPerDay);

const trace = await api('GET', `/runs/${run.id}/trace`);
const traceIds = new Set(trace.map((e) => e.traceId));
console.log('7) trace events:', trace.length, '| distinct traceIds:', traceIds.size);
if (traceIds.size !== 1) {
  throw new Error('fingerprint broken');
}
console.log('SMOKE OK');
