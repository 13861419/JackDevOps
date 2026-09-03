import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryEventStore, EVENT } from '../src/events';
import { NotifyService } from '../src/modules/notify/notify.service';
import { parseDiffToFiles } from '../src/modules/review/review.rules';
import { ReviewService } from '../src/modules/review/review.service';
import { GitWebhookService } from '../src/modules/webhooks/git-webhook.service';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import { JobRegistry } from '../src/modules/workflows/job-registry';
import { WorkflowsService } from '../src/modules/workflows/workflows.service';
import { WorkflowRunsService } from '../src/modules/workflows/workflow-runs.service';
import { RunExecutor } from '../src/modules/runqueue/run-executor.service';
import { PreviewsService } from '../src/modules/previews/previews.service';

const SAMPLE_DIFF = `diff --git a/src/app.ts b/src/app.ts
index 111..222 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,3 +1,5 @@
 existing
+added line 1
+added line 2
-deleted line
diff --git a/src/util.ts b/src/util.ts
index 333..444 100644
--- a/src/util.ts
+++ b/src/util.ts
@@ -1,2 +1,2 @@
 context
-old util
+new util
diff --git a/tests/app.spec.ts b/tests/app.spec.ts
index 555..666 100644
--- a/tests/app.spec.ts
+++ b/tests/app.spec.ts
@@ -1,2 +1,4 @@
 existing
+covers added line 1
+covers added line 2
`;

describe('diff parsing (M18)', () => {
  it('maps per-file additions and deletions from unified diff', () => {
    const files = parseDiffToFiles(SAMPLE_DIFF);
    expect(files).toEqual([
      { path: 'src/app.ts', additions: 2, deletions: 1 },
      { path: 'src/util.ts', additions: 1, deletions: 1 },
      { path: 'tests/app.spec.ts', additions: 2, deletions: 0 },
    ]);
  });
});

describe('AI review via dsh (M18)', () => {
  beforeEach(() => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'fake-key');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('records aiSummary from dsh output when key is set', async () => {
    const store = new InMemoryEventStore();
    const svc = new ReviewService(store, undefined, async () => ({
      stdout: '- risk: unchecked null in checkout path\n- nit: naming',
      stderr: '',
    }));
    const result = await svc.reviewPullRequest(
      {
        title: 'feat: discount',
        description: 'Adds discount calculation with full test coverage and reviewed rollout plan',
        files: [
          { path: 'src/app.ts', additions: 2, deletions: 1 },
          { path: 'tests/app.spec.ts', additions: 2, deletions: 0 },
        ],
        diff: SAMPLE_DIFF,
      },
      'tester',
    );
    expect(result.aiSummary).toContain('risk');
    const events = await store.listByType(EVENT.reviewCompleted);
    const last = events[events.length - 1];
    expect(last.payload.aiSummary).toContain('risk');
    expect(last.payload.findings).toEqual([]);
  });

  it('skips AI step with note when DEEPSEEK_API_KEY missing', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', '');
    const store = new InMemoryEventStore();
    let called = 0;
    const svc = new ReviewService(store, undefined, async () => {
      called += 1;
      return { stdout: '', stderr: '' };
    });
    const result = await svc.reviewPullRequest(
      { title: 'feat: x', files: [], diff: SAMPLE_DIFF },
      'tester',
    );
    expect(called).toBe(0);
    expect(result.aiNote).toMatch(/AI review skipped/);
    expect(result.aiSummary).toBeUndefined();
  });
});

describe('PR webhook AI review integration (M18)', () => {
  const statusCalls: { url: string; body: Record<string, unknown> }[] = [];

  beforeEach(() => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-key');
    vi.stubEnv('JACK_GITHUB_TOKEN', 'gh-token');
    vi.stubGlobal('fetch', (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('.diff')) {
        return new Response(SAMPLE_DIFF, { status: 200 });
      }
      if (url.includes('/statuses/')) {
        statusCalls.push({ url, body: JSON.parse(String(init?.body)) });
        return new Response('{"ok":true}', { status: 201 });
      }
      return new Response('{}', { status: 404 });
    }) as typeof fetch);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    statusCalls.length = 0;
  });

  it('PR opened with diff_url runs rules+AI review and writes back ai-review status', async () => {
    const store = new InMemoryEventStore();
    const catalog = new CatalogService(store);
    const registry = new JobRegistry();
    const workflows = new WorkflowsService(store, registry);
    const runs = new WorkflowRunsService(store, registry, new RunExecutor(store, registry));
    const review = new ReviewService(
      store,
      new NotifyService(),
      async () => ({ stdout: 'No significant issues found', stderr: '' }),
    );
    const webhook = new GitWebhookService(
      catalog,
      workflows,
      runs,
      new PreviewsService(store, catalog),
      review,
    );
    await catalog.register({ name: '评审', slug: 'review-svc', ownerId: 'ops' });

    const res = await webhook.handlePullRequest('review-svc', {
      action: 'opened',
      number: 21,
      pull_request: {
        number: 21,
        title: 'feat: discount engine',
        body: 'Implements the discount engine with reviewed rollout plan and full test coverage',
        head: { ref: 'feat/discount', sha: 'rev21sha' },
        diff_url: 'https://github.com/octo/hello/pull/21.diff',
      },
      repository: { full_name: 'octo/hello' },
    });

    const reviewView = res.review as { verdict: string; aiSummary?: string } | undefined;
    expect(res.preview?.status).toBe('ready');
    expect(reviewView).toBeTruthy();
    expect(reviewView?.verdict).toBe('pass');
    expect(reviewView?.aiSummary).toContain('No significant issues');

    expect(statusCalls.length).toBe(1);
    expect(statusCalls[0].url).toContain('/repos/octo/hello/statuses/rev21sha');
    expect(statusCalls[0].body).toMatchObject({ state: 'success', context: 'jackdevops/ai-review' });
  });

  it('PR without diff_url skips AI review entirely', async () => {
    const store = new InMemoryEventStore();
    const catalog = new CatalogService(store);
    const registry = new JobRegistry();
    const workflows = new WorkflowsService(store, registry);
    const runs = new WorkflowRunsService(store, registry, new RunExecutor(store, registry));
    const webhook = new GitWebhookService(
      catalog,
      workflows,
      runs,
      new PreviewsService(store, catalog),
    );

    await catalog.register({ name: '无评审', slug: 'noreview-svc', ownerId: 'ops' });
    const res = await webhook.handlePullRequest('noreview-svc', {
      action: 'opened',
      number: 5,
      pull_request: { number: 5, title: 'docs: readme', head: { ref: 'docs', sha: 'sha5' } },
    });
    expect(res.review).toBeUndefined();
  });
});
