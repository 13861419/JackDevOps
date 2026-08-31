#!/usr/bin/env node
// JackDevOps Phase 1 acceptance gate: the "10-minute test".
// Verifies a fresh machine can go from zero to a green pipeline run.
// Usage: node scripts/ten-minute-test.mjs [baseUrl] [token]
const base = process.argv[2] ?? 'http://localhost:3000';
const token = process.argv[3] ?? 'dev-admin-token';
const startedAt = Date.now();
const LIMIT_MS = 10 * 60 * 1000;

async function api(method, path, body, allowFail = false, useToken = true) {
  const headers = { 'content-type': 'application/json' };
  if (useToken && token) {
    headers.authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok && !allowFail) {
    throw new Error(`${method} ${path} -> ${res.status}: ${text}`);
  }
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const steps = [];
function step(name, ms) {
  steps.push({ name, ms });
  console.log(`  [${String(steps.length).padStart(2, '0')}] ${name} (${ms}ms)`);
}

// Step 1: auth required without token
const t0 = Date.now();
const anon = await api('GET', '/workflows', undefined, true, false);
if (anon.status !== 403) {
  throw new Error(`expected 403 without token, got ${anon.status}`);
}
step('RBAC rejects unauthenticated access', Date.now() - t0);

// Step 2: onboarding quickstart
const t1 = Date.now();
const qs = await api('POST', '/onboarding/quickstart', {
  name: `acceptance-${Date.now().toString(36)}`,
  language: 'node',
  ownerId: 'acceptance',
});
step('quickstart: service + pipeline created', Date.now() - t1);

// Step 3: git webhook triggers a run
const t2 = Date.now();
const slug = qs.body.service.slug;
const hook = await api('POST', `/webhooks/git/${slug}`, {
  ref: 'refs/heads/main',
  after: `c0ffee${Date.now().toString(16)}`,
  pusher: { name: 'acceptance' },
});
const runId = hook.body.triggered[0].runId;
step('webhook triggered run', Date.now() - t2);

// Step 4: run finishes green
const t3 = Date.now();
let run = null;
for (let i = 0; i < 300; i++) {
  run = await api('GET', `/runs/${runId}`);
  if (run.body.status !== 'running') break;
  await new Promise((r) => setTimeout(r, 100));
}
if (run.body.status !== 'succeeded') {
  throw new Error(`run did not succeed: ${run.body.status}`);
}
step('run succeeded (all jobs green)', Date.now() - t3);

// Step 5: change fingerprint is intact
const t4 = Date.now();
const trace = await api('GET', `/runs/${runId}/trace`);
const traceIds = new Set(trace.body.map((e) => e.traceId));
if (traceIds.size !== 1) {
  throw new Error('change fingerprint broken: multiple traceIds');
}
step('change fingerprint intact (single traceId)', Date.now() - t4);

// Step 6: work item lifecycle (A1)
const t5 = Date.now();
const item = await api('POST', '/work-items', {
  title: 'acceptance follow-up',
  kind: 'task',
  actorId: 'acceptance',
});
await api('POST', `/work-items/${item.body.id}/status`, { to: 'todo', actorId: 'acceptance' });
step('work item lifecycle works', Date.now() - t5);

const total = Date.now() - startedAt;
console.log(`\nTOTAL: ${(total / 1000).toFixed(1)}s / 600s budget`);
console.log(total <= LIMIT_MS ? 'ACCEPTANCE PASS (10-minute test)' : 'ACCEPTANCE FAIL (over budget)');
if (total > LIMIT_MS) {
  process.exit(1);
}
