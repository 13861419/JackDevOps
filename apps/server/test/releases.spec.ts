import { describe, expect, it } from 'vitest';
import { InMemoryEventStore, EVENT, AGGREGATE, makeEvent, newId } from '../src/events';
import { WorkflowsService } from '../src/modules/workflows/workflows.service';
import { WorkflowRunsService } from '../src/modules/workflows/workflow-runs.service';
import { JobRegistry } from '../src/modules/workflows/job-registry';
import { ReleasesService } from '../src/modules/releases/releases.service';
import type { RunView } from '../src/modules/workflows/workflow.types';

function waitForRun(runs: WorkflowRunsService, runId: string): Promise<RunView> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 5000;
    const tick = (): void => {
      const run = runs.get(runId);
      if (run && run.status !== 'running') {
        resolve(run);
      } else if (Date.now() > deadline) {
        reject(new Error('timeout'));
      } else {
        setTimeout(tick, 5);
      }
    };
    tick();
  });
}

describe('releases (D4 progressive delivery)', () => {
  const store = new InMemoryEventStore();
  const registry = new JobRegistry();
  const workflows = new WorkflowsService(store, registry);
  const runs = new WorkflowRunsService(store, registry);
  const releases = new ReleasesService(store);

  it('registers a release inheriting the run change fingerprint, promotes via canary steps after approval', async () => {
    const wf = await workflows.create({
      name: 'release-flow',
      spec: { jobs: [{ id: 'build', type: 'build' }] },
      actorId: 'u1',
    });
    const run = await runs.startRun(wf.id, 'u1');
    await waitForRun(runs, run.id);

    const release = await releases.register({
      runId: run.id,
      version: 'v1.0.0',
      artifacts: ['image:1.0.0'],
      strategy: 'canary',
      actorId: 'ops',
    });
    expect(release.traceId).toBe(run.traceId);
    expect(release.status).toBe('in_progress');
    expect(release.steps.map((s) => s.weight)).toEqual([10, 50, 100]);

    await expect(releases.promote(release.id, 'ops')).rejects.toThrow(/requires an approval/);

    await releases.approve(release.id, { decision: 'approved', aiSummary: '风险低，放行', actorId: 'approver' });
    const promoted = await releases.promote(release.id, 'ops');
    expect(promoted.status).toBe('promoted');
    expect(promoted.steps.every((s) => s.status === 'succeeded')).toBe(true);
    expect(promoted.approvals[0].aiSummary).toBe('风险低，放行');

    const trace = await store.listByTrace(run.traceId);
    const types = trace.map((e) => e.type);
    expect(types).toContain(EVENT.releaseRegistered);
    expect(types).toContain(EVENT.releaseApproved);
    expect(types).toContain(EVENT.releaseStrategyStep);
    expect(types).toContain(EVENT.releasePromoted);
  });

  it('rejecting an approval keeps the release blocked', async () => {
    const wf = await workflows.create({
      name: 'reject-flow',
      spec: { jobs: [{ id: 'build', type: 'build' }] },
      actorId: 'u1',
    });
    const run = await runs.startRun(wf.id, 'u1');
    await waitForRun(runs, run.id);
    const release = await releases.register({
      runId: run.id,
      version: `v-reject-${Date.now()}`,
      artifacts: [],
      strategy: 'canary',
      actorId: 'ops',
    });
    await releases.approve(release.id, { decision: 'rejected', actorId: 'approver' });
    await expect(releases.promote(release.id, 'ops')).rejects.toThrow(/requires an approval/);
  });

  it('rolls back a release with reason', async () => {
    const wf = await workflows.create({
      name: 'rollback-flow',
      spec: { jobs: [{ id: 'build', type: 'build' }] },
      actorId: 'u1',
    });
    const run = await runs.startRun(wf.id, 'u1');
    await waitForRun(runs, run.id);
    const release = await releases.register({
      runId: run.id,
      version: `v-${Date.now()}`,
      artifacts: [],
      strategy: 'blue-green',
      actorId: 'ops',
    });
    const rolled = await releases.rollback(release.id, '错误率上升', 'ops');
    expect(rolled.status).toBe('rolled_back');
    expect(rolled.reason).toBe('错误率上升');
  });

  it('rejects duplicate versions', async () => {
    const wf = await workflows.create({
      name: 'dup-flow',
      spec: { jobs: [{ id: 'build', type: 'build' }] },
      actorId: 'u1',
    });
    const run = await runs.startRun(wf.id, 'u1');
    await waitForRun(runs, run.id);
    const version = `v-unique-${Date.now()}`;
    await releases.register({ runId: run.id, version, artifacts: [], strategy: 'rolling', actorId: 'u1' });
    await expect(
      releases.register({ runId: run.id, version, artifacts: [], strategy: 'rolling', actorId: 'u1' }),
    ).rejects.toThrow(/already registered/);
  });
});
