import { describe, expect, it } from 'vitest';
import { InMemoryEventStore, EVENT } from '../src/events';
import { JobRegistry } from '../src/modules/workflows/job-registry';
import { WorkflowsService } from '../src/modules/workflows/workflows.service';
import { WorkflowRunsService } from '../src/modules/workflows/workflow-runs.service';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import { ReleasesService } from '../src/modules/releases/releases.service';
import { MetricsService } from '../src/modules/metrics/metrics.service';
import { SecretsService } from '../src/modules/secrets/secrets.service';

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

describe('A5 complete: DORA lead time for changes', () => {
  it('computes leadTimeMinutes from runStarted to releasePromoted', async () => {
    const store = new InMemoryEventStore();
    const catalog = new CatalogService(store);
    const registry = new JobRegistry();
    const workflows = new WorkflowsService(store, registry);
    const runs = new WorkflowRunsService(store, registry);
    const releases = new ReleasesService(store);
    const metrics = new MetricsService(store);

    const service = await catalog.register({ name: 'LT', slug: 'lt-svc', ownerId: 'ops' });
    const wf = await workflows.create({
      name: 'lt-cd',
      spec: { jobs: [{ id: 'build', type: 'build', config: { command: 'node -v' } }] },
      serviceId: service.id,
      actorId: 'u1',
    });
    const started = await runs.startRun(wf.id, 'u1');
    await waitForRun(runs, started.id);
    const release = await releases.register({
      runId: started.id,
      version: 'v1.0.0',
      artifacts: ['lt:v1.0.0'],
      strategy: 'rolling',
      actorId: 'u1',
    });
    await releases.promote(release.id, 'u1');

    const dora = await metrics.dora(30);
    expect(dora.leadTimeMinutes).not.toBeNull();
    expect(dora.leadTimeMinutes as number).toBeGreaterThanOrEqual(0);
    expect(dora.leadTimeMinutes as number).toBeLessThan(10);
  });
});

describe('F8: external secret references', () => {
  const store = new InMemoryEventStore();
  const catalog = new CatalogService(store);
  const secrets = new SecretsService(store, catalog);

  it('registers refs, resolves to external pointers, replaces and removes', async () => {
    await catalog.register({ name: '支付', slug: 'pay', ownerId: 'ops' });
    await secrets.register('pay', {
      key: 'DB_PASSWORD',
      provider: 'vault',
      ref: 'secret/pay/db',
      actorId: 'u1',
    });
    await secrets.register('pay', {
      key: 'API_KEY',
      provider: 'k8s-secret',
      ref: 'pay/api-key',
      actorId: 'u1',
    });

    const resolved = await secrets.resolve('pay', { actorId: 'u1' });
    expect(resolved.env.DB_PASSWORD).toBe('external://vault/secret/pay/db');
    expect(resolved.env.API_KEY).toBe('external://k8s-secret/pay/api-key');
    expect(resolved.count).toBe(2);

    await secrets.register('pay', { key: 'API_KEY', provider: 'vault', ref: 'pay/new-key', actorId: 'u1' });
    const afterReplace = await secrets.list('pay');
    expect(afterReplace.filter((s) => s.key === 'API_KEY')).toHaveLength(1);
    expect(afterReplace.find((s) => s.key === 'API_KEY')?.provider).toBe('vault');

    await secrets.remove('pay', 'DB_PASSWORD', 'u1');
    const final = await secrets.resolve('pay', { actorId: 'u1' });
    expect(Object.keys(final.env)).toEqual(['API_KEY']);

    await expect(secrets.resolve('ghost', { actorId: 'u1' })).rejects.toThrow(/not found/);
  });
});

describe('F9-lite: SLSA provenance', () => {
  it('records provenance on promote and exposes an attestation document', async () => {
    const store = new InMemoryEventStore();
    const catalog = new CatalogService(store);
    const registry = new JobRegistry();
    const workflows = new WorkflowsService(store, registry);
    const runs = new WorkflowRunsService(store, registry);
    const releases = new ReleasesService(store);

    const service = await catalog.register({ name: 'SLSA', slug: 'slsa-svc', ownerId: 'ops' });
    const wf = await workflows.create({
      name: 'slsa-cd',
      spec: { jobs: [{ id: 'build', type: 'build', config: { command: 'node -v' } }] },
      serviceId: service.id,
      actorId: 'alice',
    });
    const started = await runs.startRun(wf.id, 'alice', { commit: 'cafebabe' });
    await waitForRun(runs, started.id);
    const release = await releases.register({
      runId: started.id,
      version: 'v1.1.0',
      artifacts: ['slsa:v1.1.0'],
      strategy: 'rolling',
      actorId: 'u1',
    });
    await releases.promote(release.id, 'u1');

    const prov = await releases.provenance(release.id);
    expect(prov).not.toBeNull();
    expect(prov?.invocation.runId).toBe(started.id);
    expect(prov?.invocation.traceId).toBe(release.traceId);
    expect(prov?.invocation.triggeredBy).toBe('workflow-engine');
    expect(prov?.buildType).toContain('buildtypes/workflow-run');
    expect(prov?.artifacts).toEqual(['slsa:v1.1.0']);
    expect(await releases.provenance('rel_missing')).toBeNull();

    const events = await store.listByAggregate('release', release.id);
    expect(events.some((e) => e.type === EVENT.releaseProvenanceRecorded)).toBe(true);
  });
});
