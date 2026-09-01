import { describe, expect, it } from 'vitest';
import { InMemoryEventStore, EVENT } from '../src/events';
import { JobRegistry } from '../src/modules/workflows/job-registry';
import { WorkflowsService } from '../src/modules/workflows/workflows.service';
import { WorkflowRunsService } from '../src/modules/workflows/workflow-runs.service';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import { PreviewsService } from '../src/modules/previews/previews.service';
import { GitWebhookService } from '../src/modules/webhooks/git-webhook.service';
import { previewEnvName, previewUrl } from '../src/modules/previews/preview.types';
import type { RunView } from '../src/modules/workflows/workflow.types';

describe('preview environments (D8)', () => {
  const store = new InMemoryEventStore();
  const catalog = new CatalogService(store);
  const previews = new PreviewsService(store, catalog);

  it('requests a preview env, auto-ready with deterministic URL and env name', async () => {
    const service = await catalog.register({ name: '订单服务', slug: 'order-svc', ownerId: 'ops' });
    const preview = await previews.request({
      serviceId: service.id,
      prNumber: 7,
      prTitle: 'feat: discount',
      branch: 'feat/discount',
      commit: 'abc123',
      actorId: 'webhook',
    });
    expect(preview.status).toBe('ready');
    expect(preview.url).toBe(previewUrl('order-svc', 7));
    expect(previewEnvName(7)).toBe('preview-pr-7');
    expect(preview.ttlHours).toBe(72);
    expect(preview.prTitle).toBe('feat: discount');

    const again = previews.request({ serviceId: service.id, prNumber: 7, actorId: 'webhook' });
    await expect(again).rejects.toThrow(/already/);
  });

  it('destroys by PR and reports expired via TTL', async () => {
    const service = await catalog.register({ name: '计费服务', slug: 'billing-svc', ownerId: 'ops' });
    await previews.request({ serviceId: service.id, prNumber: 9, ttlHours: 1, actorId: 'webhook' });

    const destroyed = await previews.destroyByPr(service.id, 9);
    expect(destroyed?.status).toBe('destroyed');
    expect(destroyed?.destroyedAt).toBeTruthy();
    expect(await previews.destroyByPr(service.id, 9)).toBeNull();

    const fresh = await previews.request({ serviceId: service.id, prNumber: 10, ttlHours: 1, actorId: 'webhook' });
    expect((await previews.expired()).some((p) => p.id === fresh.id)).toBe(false);
    const inTwoHours = new Date(Date.now() + 2 * 3600_000);
    expect((await previews.expired(inTwoHours)).some((p) => p.id === fresh.id)).toBe(true);
  });
});

describe('PR webhook lifecycle (D8)', () => {
  const store = new InMemoryEventStore();
  const catalog = new CatalogService(store);
  const registry = new JobRegistry();
  const workflows = new WorkflowsService(store, registry);
  const runs = new WorkflowRunsService(store, registry);
  const webhook = new GitWebhookService(catalog, workflows, runs, new PreviewsService(store, catalog));

  it('opened → preview created; closed → preview destroyed', async () => {
    await catalog.register({ name: '网关', slug: 'gateway', ownerId: 'ops' });

    const opened = await webhook.handlePullRequest('gateway', {
      action: 'opened',
      number: 42,
      pull_request: { number: 42, title: 'fix: auth', head: { ref: 'fix/auth', sha: 'deadbeef' } },
    });
    expect(opened.preview?.status).toBe('ready');
    expect(opened.preview?.url).toContain('preview-pr-42');

    const closed = await webhook.handlePullRequest('gateway', { action: 'closed', number: 42 });
    expect(closed.action).toBe('closed');
    expect(closed.preview?.status).toBe('destroyed');

    const reClosed = await webhook.handlePullRequest('gateway', { action: 'closed', number: 42 });
    expect(reClosed.preview).toBeUndefined();
  });

  it('ignores non-lifecycle actions and unknown services fail loudly', async () => {
    await catalog.register({ name: '库存', slug: 'inventory', ownerId: 'ops' });
    const skipped = await webhook.handlePullRequest('inventory', { action: 'labeled', number: 5 });
    expect(skipped.action).toBe('labeled');
    expect(skipped.preview).toBeUndefined();

    await expect(webhook.handlePullRequest('ghost', { action: 'opened', number: 1 })).rejects.toThrow(
      /not found/,
    );
  });
});

describe('container-build job (D6)', () => {
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

  it('stub passes when no image configured, run succeeds with executed=false', async () => {
    const store2 = new InMemoryEventStore();
    const registry = new JobRegistry();
    const workflows = new WorkflowsService(store2, registry);
    const runs = new WorkflowRunsService(store2, registry);

    const wf = await workflows.create({
      name: 'container-noop',
      spec: { jobs: [{ id: 'img', type: 'container-build', config: {} }] },
      actorId: 'u1',
    });
    const started = await runs.startRun(wf.id, 'u1');
    const finished = await waitForRun(runs, started.id);
    expect(finished.status).toBe('succeeded');
    const trace = await runs.trace(started.id);
    const succeeded = trace.find((e) => e.type === EVENT.jobSucceeded);
    expect(succeeded?.payload).toMatchObject({ result: { executed: false, note: 'no image configured; stub pass' } });
  });
});
