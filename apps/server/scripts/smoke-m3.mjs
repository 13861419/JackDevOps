#!/usr/bin/env node
// End-to-end smoke test for M3: service -> workflow (real shell jobs) -> git webhook -> run -> trace.
// Usage: node scripts/smoke-m3.mjs [baseUrl]
const base = process.argv[2] ?? 'http://localhost:3000';

async function api(method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`${method} ${path} -> ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

const slug = `smoke-${Date.now().toString(36)}`;
const service = await api('POST', '/services', {
  name: 'Smoke Demo',
  slug,
  ownerId: 'smoke',
});
console.log('1) service registered:', service.id);

const workflow = await api('POST', '/workflows', {
  name: 'smoke-cd',
  serviceId: service.id,
  actorId: 'smoke',
  spec: {
    jobs: [
      {
        id: 'scan',
        type: 'scan',
        config: { command: `node -e "console.log('scan gate: no vulnerabilities')"` },
      },
      {
        id: 'build',
        type: 'build',
        dependsOn: ['scan'],
        config: { command: `node -e "console.log('building artifact... done')"` },
      },
    ],
  },
});
console.log('2) workflow created:', workflow.id, 'jobs:', workflow.spec.jobs.length);

const hook = await api('POST', `/webhooks/git/${slug}`, {
  ref: 'refs/heads/main',
  after: 'f00dcafe1234',
  repository: { full_name: `acme/${slug}` },
  pusher: { name: 'alice' },
});
const runId = hook.triggered[0].runId;
console.log('3) webhook triggered run:', runId);

let run;
for (let i = 0; i < 100; i++) {
  run = await api('GET', `/runs/${runId}`);
  if (run.status !== 'running') break;
  await new Promise((r) => setTimeout(r, 100));
}
if (run.status !== 'succeeded') {
  throw new Error(`run did not succeed: ${run.status}`);
}
console.log(
  '4) run:',
  run.status,
  '| commit:',
  run.meta?.commit,
  '| branch:',
  run.meta?.branch,
);

const trace = await api('GET', `/runs/${runId}/trace`);
const jobOutputs = trace.filter((e) => e.type === 'job.succeeded');
for (const e of jobOutputs) {
  console.log(`5) ${e.payload.jobId} -> ${String(e.payload.result.stdout).trim()}`);
}
const traceIds = new Set(trace.map((e) => e.traceId));
console.log('6) trace events:', trace.length, '| distinct traceIds:', traceIds.size);
if (traceIds.size !== 1) {
  throw new Error('change fingerprint broken: multiple traceIds in one run');
}
console.log('SMOKE OK');
