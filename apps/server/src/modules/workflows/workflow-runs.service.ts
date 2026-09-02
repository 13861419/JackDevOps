import { Inject, Injectable, NotFoundException, OnModuleInit, Optional } from '@nestjs/common';
import { AGGREGATE, EVENT, makeEvent, newId } from '../../events';
import { EVENT_STORE, type EventStore, type DomainEvent } from '../../events';
import { JobRegistry } from './job-registry';
import type { JobSpec, JobStatus, RunMeta, RunStatus } from './workflow.types';
import { NotifyService } from '../notify/notify.service';
export interface RunJobView {
  id: string;
  type: string;
  status: JobStatus;
}

export interface RunView {
  id: string;
  workflowId: string;
  workflowName: string;
  traceId: string;
  status: RunStatus;
  jobs: RunJobView[];
  meta?: RunMeta;
  startedAt: string;
  finishedAt?: string;
}

@Injectable()
export class WorkflowRunsService implements OnModuleInit {
  private readonly runs = new Map<string, RunView>();

  constructor(
    @Inject(EVENT_STORE) private readonly eventStore: EventStore,
    private readonly jobRegistry: JobRegistry,
    @Optional() private readonly notify?: NotifyService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.hydrate();
  }

  private async hydrate(): Promise<void> {
    const startedEvents = await this.eventStore.listByType(EVENT.runStarted);
    const completedByRun = new Map<string, DomainEvent>();
    for (const event of await this.eventStore.listByType(EVENT.runCompleted)) {
      completedByRun.set(event.aggregateId, event);
    }
    const workflowNames = new Map<string, string>();
    for (const event of await this.eventStore.listByType(EVENT.workflowCreated)) {
      workflowNames.set(event.aggregateId, event.payload.name as string);
    }
    const jobEventsByRun = new Map<string, DomainEvent[]>();
    for (const type of [EVENT.jobStarted, EVENT.jobSucceeded, EVENT.jobFailed, EVENT.jobSkipped]) {
      for (const event of await this.eventStore.listByType(type)) {
        const list = jobEventsByRun.get(event.aggregateId) ?? [];
        list.push(event);
        jobEventsByRun.set(event.aggregateId, list);
      }
    }
    for (const started of startedEvents) {
      if (this.runs.has(started.aggregateId)) {
        continue;
      }
      const jobIds = (started.payload.jobIds as string[]) ?? [];
      const jobStatus = new Map<string, JobStatus>();
      for (const event of jobEventsByRun.get(started.aggregateId) ?? []) {
        const jobId = event.payload.jobId as string;
        if (event.type === EVENT.jobSucceeded) {
          jobStatus.set(jobId, 'succeeded');
        } else if (event.type === EVENT.jobFailed) {
          jobStatus.set(jobId, 'failed');
        } else if (event.type === EVENT.jobSkipped) {
          jobStatus.set(jobId, 'skipped');
        } else if (!jobStatus.has(jobId)) {
          jobStatus.set(jobId, 'running');
        }
      }
      const completed = completedByRun.get(started.aggregateId);
      const view: RunView = {
        id: started.aggregateId,
        workflowId: started.payload.workflowId as string,
        workflowName: (workflowNames.get(started.payload.workflowId as string) ?? '-'),
        traceId: started.traceId,
        status: (completed?.payload.status as RunStatus) ?? 'running',
        jobs: jobIds.map((id) => ({ id, type: '', status: jobStatus.get(id) ?? 'pending' })),
        meta: (started.payload.meta as RunMeta) ?? undefined,
        startedAt: started.occurredAt,
        finishedAt: completed?.occurredAt,
      };
      this.runs.set(started.aggregateId, view);
    }
  }


  async startRun(workflowId: string, actorId: string, meta?: RunMeta): Promise<RunView> {
    const workflow = await this.eventStore
      .listByAggregate(AGGREGATE.workflow, workflowId)
      .then((events) => events.find((e) => e.type === EVENT.workflowCreated));
    if (!workflow) {
      throw new NotFoundException(`workflow ${workflowId} not found`);
    }
    const spec = workflow.payload.spec as { jobs: JobSpec[] };
    const runId = newId('run');
    const view: RunView = {
      id: runId,
      workflowId,
      workflowName: workflow.payload.name as string,
      traceId: workflow.traceId,
      status: 'running',
      jobs: spec.jobs.map((j) => ({ id: j.id, type: j.type, status: 'pending' as JobStatus })),
      meta,
      startedAt: new Date().toISOString(),
    };
    this.runs.set(runId, view);
    await this.emit(view.traceId, EVENT.runStarted, runId, {
      workflowId,
      jobIds: spec.jobs.map((j) => j.id),
      meta: meta ?? null,
      triggeredBy: actorId,
    });
    void this.execute(spec.jobs, view).catch(() => undefined);
    return view;
  }

  get(runId: string): RunView | null {
    return this.runs.get(runId) ?? null;
  }

  list(): RunView[] {
    return [...this.runs.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  async trace(runId: string): Promise<DomainEvent[]> {
    const run = this.runs.get(runId);
    if (!run) {
      throw new NotFoundException(`run ${runId} not found`);
    }
    return this.eventStore.listByTrace(run.traceId);
  }

  private async execute(jobs: JobSpec[], view: RunView): Promise<void> {
    const succeeded = new Set<string>();
    const failed = new Set<string>();
    const pending = new Map(jobs.map((j) => [j.id, j]));
    const maxConcurrency = Number(process.env.JACK_MAX_CONCURRENCY ?? 8);

    while (pending.size > 0) {
      const ready = [...pending.values()].filter((j) =>
        (j.dependsOn ?? []).every((d) => succeeded.has(d)),
      );
      if (ready.length === 0) {
        break;
      }
      const bounded = maxConcurrency > 0 ? ready.slice(0, maxConcurrency) : ready;
      await Promise.all(bounded.map((job) => this.runJob(job, view)));
      for (const job of bounded) {
        pending.delete(job.id);
        const jobView = view.jobs.find((jv) => jv.id === job.id);
        if (jobView?.status === 'succeeded') {
          succeeded.add(job.id);
        } else if (jobView?.status === 'failed') {
          failed.add(job.id);
        }
      }
    }

    for (const job of pending.values()) {
      await this.skipJob(job.id, view);
    }

    const status: RunStatus = failed.size > 0 ? 'failed' : 'succeeded';
    await this.finishRun(view, status);
  }

  private async runJob(job: JobSpec, view: RunView): Promise<void> {
    const jobView = view.jobs.find((jv) => jv.id === job.id);
    if (!jobView) {
      return;
    }
    await this.emit(view.traceId, EVENT.jobStarted, view.id, { jobId: job.id, type: job.type });
    jobView.status = 'running';
    try {
      const handler = this.jobRegistry.get(job.type);
      const result = await handler.run({
        runId: view.id,
        jobId: job.id,
        traceId: view.traceId,
        config: job.config ?? {},
      });
      jobView.status = 'succeeded';
      await this.emit(view.traceId, EVENT.jobSucceeded, view.id, { jobId: job.id, result });
    } catch (err) {
      jobView.status = 'failed';
      await this.emit(view.traceId, EVENT.jobFailed, view.id, {
        jobId: job.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async skipJob(jobId: string, view: RunView): Promise<void> {
    const jobView = view.jobs.find((jv) => jv.id === jobId);
    if (jobView && jobView.status === 'pending') {
      jobView.status = 'skipped';
      await this.emit(view.traceId, EVENT.jobSkipped, view.id, {
        jobId,
        reason: 'upstream failure',
      });
    }
  }

  private async finishRun(view: RunView, status: RunStatus): Promise<void> {
    view.status = status;
    view.finishedAt = new Date().toISOString();
    await this.emit(view.traceId, EVENT.runCompleted, view.id, { runId: view.id, status });
    try {
      await this.notify?.runCompleted(view, view.workflowName);
    } catch (err) {
      console.warn(`[notify] run notification failed: ${String(err)}`);
    }
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
