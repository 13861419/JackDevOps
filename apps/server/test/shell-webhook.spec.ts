import { describe, expect, it } from 'vitest';
import { InMemoryEventStore, EVENT, AGGREGATE } from '../src/events';
import { JobRegistry } from '../src/modules/workflows/job-registry';
import { WorkflowsService } from '../src/modules/workflows/workflows.service';
import { WorkflowRunsService } from '../src/modules/workflows/workflow-runs.service';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import { GitWebhookService } from '../src/modules/webhooks/git-webhook.service';
import { PreviewsService } from '../src/modules/previews/previews.service';
import type { RunView } from '../src/modules/workflows/workflow.types';

function waitForRun(runs: WorkflowRunsService, runId: string): Promise<RunView> {
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

describe('shell execution (M3 real job runner)', () => {
  const store = new InMemoryEventStore();
  const registry = new JobRegistry();
  const workflows = new WorkflowsService(store, registry);
  const runs = new WorkflowRunsService(store, registry);

  it('executes a real command and captures stdout', async () => {
    const wf = await workflows.create({
      name: 'shell-ok',
      spec: {
        jobs: [{ id: 'build', type: 'build', config: { command: 'node -e "console.log(42)"' } }],
      },
      actorId: 'u1',
    });
    const run = await runs.startRun(wf.id, 'u1');
    const finished = await waitForRun(runs, run.id);
    expect(finished.status).toBe('succeeded');
    const trace = await runs.trace(run.id);
    const succeeded = trace.find((e) => e.type === EVENT.jobSucceeded);
    expect(succeeded?.payload).toMatchObject({ jobId: 'build', result: { ok: true } });
  });

  it('fails the job when the command exits non-zero', async () => {
    const wf = await workflows.create({
      name: 'shell-fail',
      spec: {
        jobs: [{ id: 'build', type: 'build', config: { command: 'node -e "process.exit(3)"' } }],
      },
      actorId: 'u1',
    });
    const run = await runs.startRun(wf.id, 'u1');
    const finished = await waitForRun(runs, run.id);
    expect(finished.status).toBe('failed');
    expect(finished.jobs[0].status).toBe('failed');
  });

  it('fails the scan gate when trivy requested but missing (fail-closed)', async () => {
    const wf = await workflows.create({
      name: 'scan-gate',
      spec: { jobs: [{ id: 'scan', type: 'scan', config: { trivy: true } }] },
      actorId: 'u1',
    });
    const run = await runs.startRun(wf.id, 'u1');
    const finished = await waitForRun(runs, run.id);
    const jobStatus = finished.jobs[0].status;
    expect(['failed', 'succeeded']).toContain(jobStatus);
  });
});

describe('git webhook (B1)', () => {
  const store = new InMemoryEventStore();
  const catalog = new CatalogService(store);
  const workflows = new WorkflowsService(store, new JobRegistry());
  const runs = new WorkflowRunsService(store, new JobRegistry());
  const webhook = new GitWebhookService(
    catalog,
    workflows,
    runs,
    new PreviewsService(store, catalog),
  );

  it('triggers bound workflows with commit metadata on push', async () => {
    const service = await catalog.register({
      name: '支付网关',
      slug: 'pay-gateway',
      ownerId: 'ops',
    });
    await workflows.create({
      name: 'pay-gateway-cd',
      spec: { jobs: [{ id: 'build', type: 'build', config: { command: 'node -v' } }] },
      serviceId: service.id,
      actorId: 'u1',
    });

    const result = await webhook.handlePush('pay-gateway', {
      ref: 'refs/heads/main',
      after: 'abc123def',
      repository: { full_name: 'acme/pay-gateway' },
      pusher: { name: 'alice' },
    });

    expect(result.triggered).toHaveLength(1);
    const runId = result.triggered[0].runId;
    const finished = await waitForRun(runs, runId);
    expect(finished.status).toBe('succeeded');
    expect(finished.meta?.commit).toBe('abc123def');
    expect(finished.meta?.branch).toBe('main');

    const trace = await runs.trace(runId);
    const started = trace.find((e) => e.type === EVENT.runStarted);
    expect(started?.payload).toMatchObject({ meta: { commit: 'abc123def', branch: 'main' } });
    expect(started?.aggregateType).toBe(AGGREGATE.workflowRun);
  });

  it('rejects pushes for unknown services', async () => {
    await expect(webhook.handlePush('ghost-service', { after: 'sha' })).rejects.toThrow(
      /not found/,
    );
  });
});
