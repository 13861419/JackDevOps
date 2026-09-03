import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryEventStore } from '../src/events';
import { NotifyService } from '../src/modules/notify/notify.service';
import { JobRegistry } from '../src/modules/workflows/job-registry';
import { WorkflowsService } from '../src/modules/workflows/workflows.service';
import { WorkflowRunsService } from '../src/modules/workflows/workflow-runs.service';
import { RunExecutor } from '../src/modules/runqueue/run-executor.service';
import { GitWebhookService } from '../src/modules/webhooks/git-webhook.service';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import { PreviewsService } from '../src/modules/previews/previews.service';
import type { RunView } from '../src/modules/workflows/workflow-runs.service';

function makeRun(status: 'succeeded' | 'failed'): RunView {
  return {
    id: 'run_test',
    workflowId: 'wf_1',
    workflowName: 'ci',
    traceId: 'trace_x',
    status,
    jobs: [],
    meta: { commit: 'abc123', repoUrl: 'octo/hello' },
    startedAt: new Date().toISOString(),
  };
}

interface CapturedCall {
  url: string;
  token: string | undefined;
  body: Record<string, unknown>;
}

function stubFetch(): CapturedCall[] {
  const calls: CapturedCall[] = [];
  vi.stubGlobal('fetch', async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      token: (init?.headers as Record<string, string> | undefined)?.authorization,
      body: JSON.parse(String(init?.body)),
    });
    return new Response(JSON.stringify({ ok: true }), { status: 201 });
  });
  return calls;
}

describe('github commit status writeback (M17)', () => {
  beforeEach(() => {
    vi.stubEnv('JACK_GITHUB_TOKEN', 'test-token');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('posts success status with context and description', async () => {
    const calls = stubFetch();
    const svc = new NotifyService();
    const res = await svc.postCommitStatus(makeRun('succeeded'), 'build-and-test');
    expect(res.sent).toBe(true);
    expect(res.state).toBe('success');
    expect(calls[0].url).toBe('https://api.github.com/repos/octo/hello/statuses/abc123');
    expect(calls[0].token).toBe('Bearer test-token');
    expect(calls[0].body).toMatchObject({
      state: 'success',
      context: 'jackdevops/pipeline',
      description: 'build-and-test succeeded',
    });
  });

  it('posts failure status for failed runs', async () => {
    const calls = stubFetch();
    const svc = new NotifyService();
    const res = await svc.postCommitStatus(makeRun('failed'), 'build');
    expect(res.state).toBe('failure');
    expect(calls[0].body).toMatchObject({ state: 'failure' });
  });

  it('skips when token missing or meta lacks commit/repo', async () => {
    const calls = stubFetch();
    const svc = new NotifyService();
    vi.stubEnv('JACK_GITHUB_TOKEN', '');
    expect((await svc.postCommitStatus(makeRun('succeeded'), 'w')).note).toMatch(/not set/);

    vi.stubEnv('JACK_GITHUB_TOKEN', 'test-token');
    const noMeta = makeRun('succeeded');
    noMeta.meta = {};
    const res = await svc.postCommitStatus(noMeta, 'w');
    expect(res.sent).toBe(false);
    expect(res.note).toMatch(/missing commit or repository/);
    expect(calls.length).toBe(0);
  });

  it('reports api errors without throwing', async () => {
    vi.stubGlobal('fetch', async () => new Response('{"message":"boom"}', { status: 500 }));
    const svc = new NotifyService();
    const res = await svc.postCommitStatus(makeRun('succeeded'), 'w');
    expect(res.sent).toBe(false);
    expect(res.note).toMatch(/github api responded 500/);
  });
});

describe('status writeback wired through run lifecycle (M17)', () => {
  beforeEach(() => {
    vi.stubEnv('JACK_GITHUB_TOKEN', 'test-token');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  function waitForRun(runs: WorkflowRunsService, runId: string): Promise<RunView> {
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + 5000;
      const tick = (): void => {
        const run = runs.get(runId);
        if (run && run.status !== 'running') {
          resolve(run);
        } else if (Date.now() > deadline) {
          reject(new Error('timeout waiting for run'));
        } else {
          setTimeout(tick, 5);
        }
      };
      tick();
    });
  }

  it('webhook-triggered push run posts commit status end to end', async () => {
    const store = new InMemoryEventStore();
    const catalog = new CatalogService(store);
    const registry = new JobRegistry();
    const workflows = new WorkflowsService(store, registry);
    const notify = new NotifyService();
    const runs = new WorkflowRunsService(store, registry, new RunExecutor(store, registry, notify));
    const webhook = new GitWebhookService(
      catalog,
      workflows,
      runs,
      new PreviewsService(store, catalog),
    );

    const service = await catalog.register({
      name: '回写',
      slug: 'writeback-svc',
      ownerId: 'ops',
      repoUrl: 'https://github.com/octo/hello',
    });
    await workflows.create({
      name: 'ci',
      serviceId: service.id,
      spec: { jobs: [{ id: 't', type: 'build', config: { command: 'echo ok' } }] },
      actorId: 'u1',
    });

    const calls = stubFetch();
    const result = await webhook.handlePush('writeback-svc', {
      ref: 'refs/heads/main',
      commit: 'cafe1234',
      repository: { full_name: 'octo/hello' },
      pusher: { name: 'octo' },
    });

    expect(result.triggered.length).toBe(1);
    const run = await waitForRun(runs, result.triggered[0].runId);
    expect(run.status).toBe('succeeded');
    expect(run.meta?.repoUrl).toBe('octo/hello');
    expect(run.meta?.commit).toBe('cafe1234');

    for (let i = 0; i < 40 && calls.length === 0; i += 1) {
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0].url).toContain('/repos/octo/hello/statuses/cafe123');
    expect(calls[0].body).toMatchObject({ state: 'success' });
  });
});
