import { describe, expect, it } from 'vitest';
import { InMemoryEventStore } from '../src/events';
import { JobRegistry } from '../src/modules/workflows/job-registry';
import { WorkflowsService } from '../src/modules/workflows/workflows.service';
import { WorkflowRunsService } from '../src/modules/workflows/workflow-runs.service';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import { WorkItemsService } from '../src/modules/workitems/workitems.service';
import { ReleasesService } from '../src/modules/releases/releases.service';
import { MetricsService } from '../src/modules/metrics/metrics.service';
import { RunExecutor } from '../src/modules/runqueue/run-executor.service';

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

describe('A5 end-to-end: work item to release lead time', () => {
  it('attributes promoted releases back to linked work items', async () => {
    const store = new InMemoryEventStore();
    const catalog = new CatalogService(store);
    const registry = new JobRegistry();
    const workflows = new WorkflowsService(store, registry);
    const runs = new WorkflowRunsService(store, registry, new RunExecutor(store, registry));
    const releases = new ReleasesService(store);
    const metrics = new MetricsService(store);
    const workItems = new WorkItemsService(store);

    const service = await catalog.register({ name: '链路', slug: 'lead-svc', ownerId: 'ops' });
    const wf = await workflows.create({
      name: 'lead-cd',
      spec: { jobs: [{ id: 'build', type: 'build', config: { command: 'node -v' } }] },
      serviceId: service.id,
      actorId: 'u1',
    });
    const wi = await workItems.create({
      title: '需求：全链路度量',
      kind: 'requirement',
      serviceId: service.id,
      actorId: 'u1',
    });

    const started = await runs.startRun(wf.id, 'u1', { workItemIds: [wi.id] });
    await waitForRun(runs, started.id);
    const release = await releases.register({
      runId: started.id,
      version: 'lt-v1',
      artifacts: ['lead:v1'],
      strategy: 'rolling',
      actorId: 'u1',
    });
    await releases.promote(release.id, 'u1');

    const report = await metrics.leadTime(30);
    expect(report.items).toHaveLength(1);
    expect(report.items[0].title).toBe('需求：全链路度量');
    expect(report.items[0].workItemId).toBe(wi.id);
    expect(report.items[0].leadTimeMinutes).toBeGreaterThanOrEqual(0);
    expect(report.medianLeadTimeMinutes).not.toBeNull();
  });
});

describe('F9 FinOps: cost attribution per service', () => {
  it('attributes run cost to the owning service', async () => {
    const store = new InMemoryEventStore();
    const catalog = new CatalogService(store);
    const registry = new JobRegistry();
    const workflows = new WorkflowsService(store, registry);
    const runs = new WorkflowRunsService(store, registry, new RunExecutor(store, registry));
    const releases = new ReleasesService(store);
    const metrics = new MetricsService(store);

    const service = await catalog.register({ name: '成本', slug: 'fin-svc', ownerId: 'ops' });
    const wf = await workflows.create({
      name: 'fin-cd',
      spec: { jobs: [{ id: 'build', type: 'build', config: { command: 'node -v' } }] },
      serviceId: service.id,
      actorId: 'u1',
    });
    const started = await runs.startRun(wf.id, 'u1');
    await waitForRun(runs, started.id);
    const release = await releases.register({
      runId: started.id,
      version: 'fin-v1',
      artifacts: ['fin:v1'],
      strategy: 'rolling',
      actorId: 'u1',
    });
    await releases.promote(release.id, 'u1');

    const report = await metrics.costs(30);
    const row = report.services.find((s) => s.serviceId === 'fin-svc');
    expect(row?.runCount).toBe(1);
    expect(row?.costUsd).toBeGreaterThanOrEqual(0);
    expect(report.rate.perRunMinute).toBeGreaterThan(0);
  });
});
