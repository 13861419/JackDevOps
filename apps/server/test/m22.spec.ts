import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryEventStore } from '../src/events';
import { MarketService } from '../src/modules/market/market.service';
import { JobRegistry } from '../src/modules/workflows/job-registry';
import { WorkflowsService } from '../src/modules/workflows/workflows.service';
import { WorkflowRunsService } from '../src/modules/workflows/workflow-runs.service';
import { RunExecutor } from '../src/modules/runqueue/run-executor.service';
import type { RunView } from '../src/modules/workflows/workflow-runs.service';

function waitForRun(runs: WorkflowRunsService, runId: string): Promise<RunView> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 8000;
    const tick = (): void => {
      const run = runs.get(runId);
      if (run && run.status !== 'running') {
        resolve(run);
      } else if (Date.now() > deadline) {
        reject(new Error('timeout waiting for run'));
      } else {
        setTimeout(tick, 10);
      }
    };
    tick();
  });
}

describe('plugin market (M22)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lists catalog with installed state', () => {
    const store = new InMemoryEventStore();
    const market = new MarketService(store, new JobRegistry());
    const plugins = market.list();
    expect(plugins.length).toBeGreaterThanOrEqual(4);
    expect(plugins.every((p) => p.installed === false)).toBe(true);
    expect(plugins.map((p) => p.slug)).toContain('npm-audit');
  });

  it('install registers a working job type; uninstall removes it', async () => {
    const store = new InMemoryEventStore();
    const registry = new JobRegistry();
    const market = new MarketService(store, registry);
    await market.install('npm-audit', 'ops');

    expect(registry.has('npm-audit')).toBe(true);
    expect(market.list().find((p) => p.slug === 'npm-audit')?.installed).toBe(true);

    await market.uninstall('npm-audit', 'ops');
    expect(registry.has('npm-audit')).toBe(false);
    expect(market.list().find((p) => p.slug === 'npm-audit')?.installed).toBe(false);
  });

  it('install twice conflicts; uninstall unknown plugin throws', async () => {
    const store = new InMemoryEventStore();
    const market = new MarketService(store, new JobRegistry());
    await market.install('prettier-check', 'ops');
    await expect(market.install('prettier-check', 'ops')).rejects.toThrow(/already installed/);
    await expect(market.uninstall('npm-audit', 'ops')).rejects.toThrow(/not installed/);
  });

  it('installed plugin runs as a real pipeline job and passes', async () => {
    const store = new InMemoryEventStore();
    const registry = new JobRegistry();
    const execImpl = vi.fn().mockResolvedValue({ stdout: 'audit ok', stderr: '' });
    const market = new MarketService(store, registry, execImpl);
    await market.install('npm-audit', 'ops');

    const workflows = new WorkflowsService(store, registry);
    const runs = new WorkflowRunsService(store, registry, new RunExecutor(store, registry));

    const wf = await workflows.create({
      name: 'market-gate',
      spec: { jobs: [{ id: 'gate', type: 'npm-audit', config: {} }] },
      actorId: 'u1',
    });
    const started = await runs.startRun(wf.id, 'u1');
    const finished = await waitForRun(runs, started.id);
    expect(finished.status).toBe('succeeded');
    expect(execImpl).toHaveBeenCalledWith('npm audit --audit-level=high', expect.anything());
  });

  it('failing plugin job fails the run (fail-closed)', async () => {
    const store = new InMemoryEventStore();
    const registry = new JobRegistry();
    const execImpl = vi.fn().mockRejectedValue({ code: 1, stderr: '3 high vulns' });
    const market = new MarketService(store, registry, execImpl);
    await market.install('npm-audit', 'ops');

    const workflows = new WorkflowsService(store, registry);
    const runs = new WorkflowRunsService(store, registry, new RunExecutor(store, registry));

    const wf = await workflows.create({
      name: 'market-gate-fail',
      spec: { jobs: [{ id: 'gate', type: 'npm-audit', config: {} }] },
      actorId: 'u1',
    });
    const started = await runs.startRun(wf.id, 'u1');
    const failed = await waitForRun(runs, started.id);
    expect(failed.status).toBe('failed');
  });
});
