import { describe, expect, it } from 'vitest';
import { InMemoryEventStore, EVENT, AGGREGATE } from '../src/events';
import { JobRegistry } from '../src/modules/workflows/job-registry';
import { WorkflowsService } from '../src/modules/workflows/workflows.service';
import { WorkflowRunsService } from '../src/modules/workflows/workflow-runs.service';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import { ReleasesService } from '../src/modules/releases/releases.service';
import { DocsService } from '../src/modules/docs/docs.service';
import { DriftService } from '../src/modules/drift/drift.service';
import { ScaffoldService } from '../src/modules/scaffold/scaffold.service';
import { AiService } from '../src/modules/ai/ai.service';
import { LlmService } from '../src/modules/ai/llm.service';

function waitForRun(runs: WorkflowRunsService, runId: string): Promise<{ status: string; id: string }> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 5000;
    const tick = (): void => {
      const run = runs.get(runId);
      if (run && run.status !== 'running') {
        resolve(run);
      } else if (Date.now() > deadline) {
        reject(new Error('timeout waiting for run to finish'));
      } else {
        setTimeout(tick, 5);
      }
    };
    tick();
  });
}

describe('golden-path scaffold (Phase 3)', () => {
  const store = new InMemoryEventStore();
  const catalog = new CatalogService(store);
  const workflows = new WorkflowsService(store, new JobRegistry());
  const scaffold = new ScaffoldService(store, catalog, workflows);

  it('creates service + bound workflow + scaffold.applied on one trace', async () => {
    const result = await scaffold.apply({
      name: '推荐服务',
      slug: 'rec-svc',
      language: 'node',
      actorId: 'u1',
    });
    expect(result.service.slug).toBe('rec-svc');
    expect(result.workflow.name).toBe('rec-svc-pipeline');
    expect(result.workflow.serviceId).toBe(result.service.id);
    expect(result.workflow.spec.jobs.map((j) => j.type)).toEqual(['build', 'test']);

    const events = await store.listByTrace(result.traceId);
    const applied = events.find((e) => e.type === EVENT.scaffoldApplied);
    expect(applied?.aggregateType).toBe(AGGREGATE.service);
    expect(applied?.payload).toMatchObject({ language: 'node', jobTypes: ['build', 'test'] });
  });
});

describe('TechDocs (Phase 3)', () => {
  const store = new InMemoryEventStore();
  const catalog = new CatalogService(store);
  const docs = new DocsService(store, catalog);

  it('starts stale without docs, fresh after upsert', async () => {
    await catalog.register({ name: '搜索', slug: 'search-svc', ownerId: 'ops' });
    const empty = await docs.get('search-svc');
    expect(empty?.stale).toBe(true);
    expect(empty?.staleReason).toMatch(/no documentation/);

    const saved = await docs.upsert('search-svc', { content: '# 搜索服务\n负责全文检索。', actorId: 'u1' });
    expect(saved.stale).toBe(false);
    expect(saved.content).toContain('# 搜索服务');
    expect(saved.updatedBy).toBe('u1');

    await expect(docs.upsert('ghost-svc', { content: 'x', actorId: 'u1' })).rejects.toThrow(/not found/);
  });
});

describe('drift detection + reconcile (Phase 3)', () => {
  const store = new InMemoryEventStore();
  const catalog = new CatalogService(store);
  const registry = new JobRegistry();
  const workflows = new WorkflowsService(store, registry);
  const runs = new WorkflowRunsService(store, registry);
  const releases = new ReleasesService(store);
  const drift = new DriftService(store, catalog, workflows, runs);

  it('compares actual vs latest promoted artifacts and records events', async () => {
    const service = await catalog.register({ name: '推送', slug: 'push-svc', ownerId: 'ops' });
    const wf = await workflows.create({
      name: 'push-cd',
      spec: { jobs: [{ id: 'build', type: 'build', config: { command: 'node -v' } }] },
      serviceId: service.id,
      actorId: 'u1',
    });
    const started = await runs.startRun(wf.id, 'u1');
    await waitForRun(runs, started.id);
    const release = await releases.register({
      runId: started.id,
      version: 'v2.0.0',
      artifacts: ['registry/push:v2.0.0'],
      strategy: 'rolling',
      actorId: 'u1',
    });
    await releases.promote(release.id, 'u1');

    const report = await drift.check('push-svc', { image: 'registry/push:v1.9.9' }, 'u1');
    expect(report.hasDrift).toBe(true);
    expect(report.desired.image).toBe('registry/push:v2.0.0');
    expect(report.drifts[0]).toMatchObject({ field: 'image', desired: 'registry/push:v2.0.0', actual: 'registry/push:v1.9.9' });

    const again = await drift.check('push-svc', { image: 'registry/push:v2.0.0' }, 'u1');
    expect(again.hasDrift).toBe(false);

    const latest = await drift.latest('push-svc');
    expect(latest?.hasDrift).toBe(false);

    const reconciled = await drift.reconcile('push-svc', 'u1');
    expect(reconciled.reconciled).toBe(true);
    const events = await store.listByTrace(service.traceId);
    expect(events.some((e) => e.type === EVENT.driftReconciled)).toBe(true);
  });
});

describe('chained rollback redeploy (Phase 3)', () => {
  const store = new InMemoryEventStore();
  const catalog = new CatalogService(store);
  const registry = new JobRegistry();
  const workflows = new WorkflowsService(store, registry);
  const runs = new WorkflowRunsService(store, registry);
  const releases = new ReleasesService(store);

  it('rollback appends release.redeployed on the last stable release', async () => {
    const service = await catalog.register({ name: '网关2', slug: 'gw2', ownerId: 'ops' });
    const wf = await workflows.create({
      name: 'gw2-cd',
      spec: { jobs: [{ id: 'build', type: 'build', config: { command: 'node -v' } }] },
      serviceId: service.id,
      actorId: 'u1',
    });

    const mkRelease = async (version: string) => {
      const started = await runs.startRun(wf.id, 'u1');
      await waitForRun(runs, started.id);
      const rel = await releases.register({
        runId: started.id,
        version,
        artifacts: [`gw2:${version}`],
        strategy: 'rolling',
        actorId: 'u1',
      });
      await releases.promote(rel.id, 'u1');
      return rel;
    };
    const stable = await mkRelease('v1');
    const bad = await mkRelease('v2');

    const rolledBack = await releases.rollback(bad.id, 'bad regression', 'u1');
    expect(rolledBack.status).toBe('rolled_back');

    const stableAfter = await releases.get(stable.id);
    expect(stableAfter?.redeployedFrom).toBe(bad.id);
    expect(stableAfter?.redeployedAt).toBeTruthy();
  });
});

describe('catalog QA agent (Phase 3)', () => {
  const store = new InMemoryEventStore();
  const catalog = new CatalogService(store);
  const registry = new JobRegistry();
  const ai = new AiService(
    store,
    new LlmService(),
    new WorkflowRunsService(store, registry),
    new WorkflowsService(store, registry),
    catalog,
  );

  it('falls back to rules answer mentioning the matched service', async () => {
    await catalog.register({ name: '订单中心', slug: 'order-center', ownerId: 'ops' });
    const res = await ai.catalogQa('order-center 现在部署的什么版本？', 'u1');
    expect(res.mode).toBe('rules');
    expect(res.answer).toContain('order-center');
    expect(res.answer).toContain('订单中心');

    const miss = await ai.catalogQa('宇宙的终极答案是什么', 'u1');
    expect(miss.answer).toContain('未在目录中识别到相关服务');
  });
});
