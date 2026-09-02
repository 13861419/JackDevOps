import { Inject, Injectable } from '@nestjs/common';
import { AGGREGATE, EVENT, makeEvent } from '../../events';
import { EVENT_STORE, type EventStore } from '../../events';
import { JobRegistry } from '../workflows/job-registry';
import type { JobSpec, JobStatus, RunMeta, RunStatus } from '../workflows/workflow.types';
import { NotifyService } from '../notify/notify.service';
import type { RunView } from '../workflows/workflow-runs.service';

export interface ExecuteDagInput {
  runId: string;
  traceId: string;
  workflowName: string;
  jobs: JobSpec[];
  meta?: RunMeta;
  onJobStatus?: (jobId: string, status: JobStatus) => void;
}

@Injectable()
export class RunExecutor {
  constructor(
    @Inject(EVENT_STORE) private readonly eventStore: EventStore,
    private readonly jobRegistry: JobRegistry,
    private readonly notify?: NotifyService,
  ) {}

  async executeDag(input: ExecuteDagInput): Promise<RunStatus> {
    const { runId, traceId, workflowName, jobs, meta } = input;
    const jobViews = jobs.map((j) => ({ id: j.id, type: j.type, status: 'pending' as JobStatus }));
    const succeeded = new Set<string>();
    const failed = new Set<string>();
    const pending = new Map(jobs.map((j) => [j.id, j]));
    const maxConcurrency = Number(process.env.JACK_MAX_CONCURRENCY ?? 8);

    const setJob = (jobId: string, status: JobStatus): void => {
      const jobView = jobViews.find((jv) => jv.id === jobId);
      if (jobView) {
        jobView.status = status;
      }
      input.onJobStatus?.(jobId, status);
    };

    while (pending.size > 0) {
      const ready = [...pending.values()].filter((j) => (j.dependsOn ?? []).every((d) => succeeded.has(d)));
      if (ready.length === 0) {
        break;
      }
      const bounded = maxConcurrency > 0 ? ready.slice(0, maxConcurrency) : ready;
      await Promise.all(
        bounded.map(async (job) => {
          await this.emit(traceId, EVENT.jobStarted, runId, { jobId: job.id, type: job.type });
          setJob(job.id, 'running');
          try {
            const handler = this.jobRegistry.get(job.type);
            const result = await handler.run({
              runId,
              jobId: job.id,
              traceId,
              config: job.config ?? {},
            });
            setJob(job.id, 'succeeded');
            await this.emit(traceId, EVENT.jobSucceeded, runId, { jobId: job.id, result });
          } catch (err) {
            setJob(job.id, 'failed');
            await this.emit(traceId, EVENT.jobFailed, runId, {
              jobId: job.id,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }),
      );
      for (const job of bounded) {
        pending.delete(job.id);
        if (jobViews.find((jv) => jv.id === job.id)?.status === 'succeeded') {
          succeeded.add(job.id);
        } else if (jobViews.find((jv) => jv.id === job.id)?.status === 'failed') {
          failed.add(job.id);
        }
      }
    }

    for (const jobId of pending.keys()) {
      const jobView = jobViews.find((jv) => jv.id === jobId);
      if (jobView && jobView.status === 'pending') {
        jobView.status = 'skipped';
        input.onJobStatus?.(jobId, 'skipped');
        await this.emit(traceId, EVENT.jobSkipped, runId, { jobId, reason: 'upstream failure' });
      }
    }

    const status: RunStatus = failed.size > 0 ? 'failed' : 'succeeded';
    await this.emit(traceId, EVENT.runCompleted, runId, { runId, status });
    try {
      const runView: RunView = {
        id: runId,
        workflowId: '',
        workflowName,
        traceId,
        status,
        jobs: jobViews,
        meta,
        startedAt: '',
      };
      await this.notify?.runCompleted(runView, workflowName);
    } catch (err) {
      console.warn(`[notify] run notification failed: ${String(err)}`);
    }
    return status;
  }

  async loadSpec(runId: string): Promise<{ jobs: JobSpec[]; traceId: string; workflowId: string; workflowName: string } | null> {
    const started = await this.eventStore
      .listByAggregate(AGGREGATE.workflowRun, runId)
      .then((events) => events.find((e) => e.type === EVENT.runStarted));
    if (!started) {
      return null;
    }
    const workflowId = started.payload.workflowId as string;
    const workflow = await this.eventStore
      .listByAggregate(AGGREGATE.workflow, workflowId)
      .then((events) => events.find((e) => e.type === EVENT.workflowCreated));
    if (!workflow) {
      return null;
    }
    return {
      jobs: (workflow.payload.spec as { jobs: JobSpec[] }).jobs,
      traceId: started.traceId,
      workflowId,
      workflowName: workflow.payload.name as string,
    };
  }

  private emit(traceId: string, type: string, aggregateId: string, payload: Record<string, unknown>): Promise<void> {
    return this.eventStore.append(
      makeEvent({
        traceId,
        type,
        aggregateType: AGGREGATE.workflowRun,
        aggregateId,
        actor: { type: 'system', id: 'workflow-engine' },
        payload,
      }),
    );
  }
}
