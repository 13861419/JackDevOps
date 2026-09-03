import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryEventStore } from '../src/events';
import { NotifyService } from '../src/modules/notify/notify.service';
import { buildApprovalCard, formatApprovalRequested } from '../src/modules/notify/notify.payloads';
import { ReleasesService } from '../src/modules/releases/releases.service';
import { JobRegistry } from '../src/modules/workflows/job-registry';
import { WorkflowsService } from '../src/modules/workflows/workflows.service';
import { WorkflowRunsService } from '../src/modules/workflows/workflow-runs.service';
import { RunExecutor } from '../src/modules/runqueue/run-executor.service';
import type { ApprovalCardInput } from '../src/modules/notify/notify.payloads';

const cardInput: ApprovalCardInput = {
  releaseId: 'rel_test',
  version: 'v1.2.3',
  strategy: 'canary',
  consoleUrl: 'http://localhost:5173/#/releases',
  actorId: 'ops',
};

describe('approval card payloads (M19)', () => {
  it('dingtalk action card carries button', () => {
    const card = buildApprovalCard('dingtalk', cardInput);
    const action = card.actionCard as { btns: { title: string; actionURL: string }[] };
    expect(card.msgtype).toBe('actionCard');
    expect(action.btns[0].actionURL).toBe(cardInput.consoleUrl);
    expect(action.text).toContain('v1.2.3');
  });

  it('feishu interactive card and wecom markdown shapes', () => {
    const feishu = buildApprovalCard('feishu', cardInput);
    expect(feishu.msg_type).toBe('interactive');
    const card = feishu.card as { elements: { tag: string }[] };
    expect(card.elements.some((e) => e.tag === 'action')).toBe(true);

    const wecom = buildApprovalCard('wecom', cardInput);
    expect(wecom.msgtype).toBe('markdown');

    const slack = buildApprovalCard('slack', cardInput);
    expect(slack.text).toContain('v1.2.3');
    expect(formatApprovalRequested(cardInput)).toContain('策略: canary');
  });
});

describe('NotifyService.approvalRequested (M19)', () => {
  const posts: { url: string; body: Record<string, unknown> }[] = [];

  beforeEach(() => {
    posts.length = 0;
    vi.stubEnv('NOTIFY_WEBHOOK_URL', 'https://im.example/hook');
    vi.stubEnv('NOTIFY_PROVIDER', 'dingtalk');
    vi.stubGlobal('fetch', (async (input: string | URL | Request, init?: RequestInit) => {
      posts.push({ url: String(input), body: JSON.parse(String(init?.body)) });
      return new Response('{"ok":true}', { status: 200 });
    }) as typeof fetch);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('posts dingtalk action card when configured', async () => {
    const svc = new NotifyService();
    const res = await svc.approvalRequested(cardInput);
    expect(res.sent).toBe(true);
    expect(posts[0].body).toMatchObject({ msgtype: 'actionCard' });
  });

  it('skips gracefully when IM notify is not configured', async () => {
    vi.stubEnv('NOTIFY_WEBHOOK_URL', '');
    const svc = new NotifyService();
    const res = await svc.approvalRequested(cardInput);
    expect(res.sent).toBe(false);
    expect(res.note).toMatch(/not configured/);
    expect(posts.length).toBe(0);
  });
});

describe('release registration triggers approval card (M19)', () => {
  const posts: Record<string, unknown>[] = [];

  beforeEach(() => {
    vi.stubEnv('NOTIFY_WEBHOOK_URL', 'https://im.example/hook');
    vi.stubEnv('NOTIFY_PROVIDER', 'feishu');
    vi.stubGlobal('fetch', (async (_input: string | URL | Request, init?: RequestInit) => {
      posts.push(JSON.parse(String(init?.body)));
      return new Response('{"ok":true}', { status: 200 });
    }) as typeof fetch);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    posts.length = 0;
  });

  async function setup() {
    const store = new InMemoryEventStore();
    const registry = new JobRegistry();
    const workflows = new WorkflowsService(store, registry);
    const runs = new WorkflowRunsService(store, registry, new RunExecutor(store, registry));
    const notify = new NotifyService();
    const releases = new ReleasesService(store, notify);
    const wf = await workflows.create({
      name: 'rel',
      spec: { jobs: [{ id: 'b', type: 'build', config: { command: 'echo ok' } }] },
      actorId: 'u1',
    });
    const run = await runs.startRun(wf.id, 'u1');
    return { releases, runId: run.id };
  }

  it('canary registration posts interactive card to IM', async () => {
    const { releases, runId } = await setup();
    const release = await releases.register({
      runId,
      version: `v19-${Date.now()}`,
      artifacts: [],
      strategy: 'canary',
      actorId: 'ops',
    });
    for (let i = 0; i < 40 && posts.length === 0; i += 1) {
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(posts.length).toBe(1);
    const card = posts[0] as { msg_type: string; card: { header: { title: { content: string } } } };
    expect(card.msg_type).toBe('interactive');
    expect(card.card.header.title.content).toContain('发布审批');
    expect(release.strategy).toBe('canary');
  });

  it('rolling strategy requires no approval and sends no card', async () => {
    const { releases, runId } = await setup();
    await releases.register({
      runId,
      version: `v19b-${Date.now()}`,
      artifacts: [],
      strategy: 'rolling',
      actorId: 'ops',
    });
    await new Promise((r) => setTimeout(r, 200));
    expect(posts.length).toBe(0);
  });
});
