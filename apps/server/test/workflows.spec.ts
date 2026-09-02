import { RunExecutor } from '../src/modules/runqueue/run-executor.service';
import { describe, expect, it } from 'vitest';
import { InMemoryEventStore, EVENT, AGGREGATE } from '../src/events';
import { JobRegistry } from '../src/modules/workflows/job-registry';
import { WorkflowsService } from '../src/modules/workflows/workflows.service';
import { WorkflowRunsService } from '../src/modules/workflows/workflow-runs.service';
import { validateSpecDag } from '../src/modules/workflows/workflow.types';
import type { RunView } from '../src/modules/workflows/workflow.types';
import { TemplatesService } from '../src/modules/templates/templates.service';

describe('workflow DAG validation (D1)', () => {
  const registry = new JobRegistry();
  const known = registry.types();

  it('accepts a valid linear DAG', () => {
    expect(() =>
      validateSpecDag(
        {
          jobs: [
            { id: 'scan', type: 'scan' },
            { id: 'build', type: 'build', dependsOn: ['scan'] },
            { id: 'deploy', type: 'deploy', dependsOn: ['build'] },
          ],
        },
        known,
      ),
    ).not.toThrow();
  });

  it('rejects cycles', () => {
    expect(() =>
      validateSpecDag(
        {
          jobs: [
            { id: 'a', type: 'build', dependsOn: ['b'] },
            { id: 'b', type: 'test', dependsOn: ['a'] },
          ],
        },
        known,
      ),
    ).toThrow(/cycle/i);
  });

  it('rejects unknown dependencies and unknown job types', () => {
    expect(() =>
      validateSpecDag({ jobs: [{ id: 'a', type: 'build', dependsOn: ['ghost'] }] }, known),
    ).toThrow(/unknown job/i);
    expect(() =>
      validateSpecDag({ jobs: [{ id: 'a', type: 'cooking' as never }] }, known),
    ).toThrow(/unknown job type/i);
  });
});

function waitForRun(runs: WorkflowRunsService, runId: string): Promise<RunView> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 3000;
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

describe('WorkflowRunsService (D1 execution)', () => {
  const store = new InMemoryEventStore();
  const registry = new JobRegistry();
  const workflows = new WorkflowsService(store, registry);
  const runs = new WorkflowRunsService(store, registry, new RunExecutor(store, registry));

  it('runs a serial chain in order and emits an event chain with one traceId', async () => {
    const wf = await workflows.create({
      name: 'node-service-cd',
      spec: {
        jobs: [
          { id: 'scan', type: 'scan' },
          { id: 'build', type: 'build', dependsOn: ['scan'] },
          { id: 'deploy', type: 'deploy', dependsOn: ['build'] },
        ],
      },
      actorId: 'u1',
    });
    const run = await runs.startRun(wf.id, 'u1');
    const finished = await waitForRun(runs, run.id);
    expect(finished.status).toBe('succeeded');
    expect(finished.jobs.map((j) => j.status)).toEqual(['succeeded', 'succeeded', 'succeeded']);

    const trace = await runs.trace(run.id);
    expect(new Set(trace.map((e) => e.traceId)).size).toBe(1);
    const types = trace.map((e) => e.type);
    expect(types[0]).toBe(EVENT.workflowCreated);
    expect(types[1]).toBe(EVENT.runStarted);
    expect(types[types.length - 1]).toBe(EVENT.runCompleted);
    expect(trace.filter((e) => e.aggregateType === AGGREGATE.workflowRun).length).toBeGreaterThan(0);
  });

  it('propagates failure: downstream jobs are skipped, run fails', async () => {
    const wf = await workflows.create({
      name: 'with-agent-fail',
      spec: {
        jobs: [
          { id: 'build', type: 'build' },
          { id: 'agent', type: 'agent', dependsOn: ['build'] },
          { id: 'deploy', type: 'deploy', dependsOn: ['agent'] },
        ],
      },
      actorId: 'u1',
    });
    const run = await runs.startRun(wf.id, 'u1');
    const finished = await waitForRun(runs, run.id);
    expect(finished.status).toBe('failed');
    const byId = new Map(finished.jobs.map((j) => [j.id, j.status]));
    expect(byId.get('build')).toBe('succeeded');
    expect(byId.get('agent')).toBe('failed');
    expect(byId.get('deploy')).toBe('skipped');
  });

  it('runs independent jobs in parallel batches', async () => {
    const wf = await workflows.create({
      name: 'parallel-two',
      spec: {
        jobs: [
          { id: 'a', type: 'build' },
          { id: 'b', type: 'test' },
          { id: 'c', type: 'deploy', dependsOn: ['a', 'b'] },
        ],
      },
      actorId: 'u1',
    });
    const run = await runs.startRun(wf.id, 'u1');
    const finished = await waitForRun(runs, run.id);
    expect(finished.status).toBe('succeeded');
  });
});

describe('TemplatesService (D2)', () => {
  const store = new InMemoryEventStore();
  const registry = new JobRegistry();
  const workflows = new WorkflowsService(store, registry);
  const templates = new TemplatesService(store, workflows);

  it('seeds builtin templates idempotently and instantiates a workflow', async () => {
    await templates.onModuleInit();
    await templates.onModuleInit();
    const all = await templates.list();
    expect(all.length).toBe(3);

    const view = await templates.instantiate('builtin-node-service', {
      serviceId: 'svc_1',
      actorId: 'u1',
    });
    expect(view.name).toBe('Node.js 服务流水线');
    expect(view.serviceId).toBe('svc_1');
    expect(view.spec.jobs.length).toBe(4);
    await expect(templates.instantiate('ghost', { actorId: 'u1' })).rejects.toThrow();
  });
});
