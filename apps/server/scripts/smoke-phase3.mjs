#!/usr/bin/env node
// Smoke test for Phase 3: scaffold + TechDocs + drift + chained rollback + catalog-qa.
// Usage: node scripts/smoke-phase3.mjs [baseUrl] [token]
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

const slug = `p3-demo-${Date.now().toString(36)}`;
const sc = await api('POST', '/scaffold', { name: 'P3演示', slug, language: 'node', actorId: 'smoke' });
console.log('1) scaffold:', sc.service.slug, '| workflow:', sc.workflow.name, '| jobs:', sc.workflow.spec.jobs.map((j) => j.type).join('+'));

const doc = await api('PUT', `/docs/${slug}`, { content: `# ${slug}\n自动生成文档。`, actorId: 'smoke' });
console.log('2) doc:', doc.stale ? 'STALE' : 'fresh', '| updatedBy:', doc.updatedBy);

const run = await api('POST', `/workflows/${sc.workflow.id}/runs`);
let runView = null;
for (let i = 0; i < 300; i++) {
  runView = await api('GET', `/runs/${run.id}`);
  if (runView.status !== 'running') break;
  await new Promise((r) => setTimeout(r, 100));
}
console.log('3) run:', runView.status);

const version = `v3.0.${Date.now().toString(36)}`;
const release = await api('POST', '/releases', {
  runId: run.id,
  version,
  artifacts: [`registry/${slug}:${version}`],
  strategy: 'rolling',
  actorId: 'smoke',
});
await api('POST', `/releases/${release.id}/promote`);

const drift = await api('POST', `/drift/${slug}/check`, { image: `registry/${slug}:OLD` });
console.log('4) drift:', drift.hasDrift ? 'DETECTED' : 'clean', '| desired:', drift.desired.image);
if (!drift.hasDrift) throw new Error('drift should be detected');

const qa = await api('POST', '/ai/catalog-qa', { question: `${slug} 是什么服务？`, actorId: 'smoke' });
console.log('5) catalog-qa mode:', qa.mode, '| answer head:', qa.answer.slice(0, 60).replace(/\n/g, ' '));

await api('POST', `/secrets/${slug}`, { key: 'DB_PASSWORD', provider: 'vault', ref: 'secret/pay/db', actorId: 'smoke' });
const env = await api('POST', `/secrets/${slug}/resolve`, { actorId: 'smoke' });
console.log('6) secret ref resolved:', env.env.DB_PASSWORD);
if (env.env.DB_PASSWORD !== 'external://vault/secret/pay/db') throw new Error('secret ref resolution failed');

const prov = await api('GET', `/releases/${release.id}/provenance`);
console.log('7) provenance:', prov.buildType.split('/').pop(), '| artifacts:', prov.artifacts.join(','));
if (!prov.invocation.runId) throw new Error('provenance missing runId');

const dora = await api('GET', '/metrics/dora?days=30');
console.log('8) DORA leadTimeMinutes:', dora.leadTimeMinutes);
if (dora.leadTimeMinutes === null) throw new Error('lead time not computed');

console.log('SMOKE P3 OK');
