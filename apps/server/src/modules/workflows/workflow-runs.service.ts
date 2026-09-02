import { Inject, Injectable, NotFoundException, OnModuleInit, Optional } from '@nestjs/common';
import { AGGREGATE, EVENT, makeEvent, newId } from '../../events';
import { EVENT_STORE, type EventStore, type DomainEvent } from '../../events';
import { JobRegistry } from './job-registry';
import type { JobSpec, JobStatus, RunMeta, RunStatus } from './workflow.types';
import { NotifyService } from '../notify/notify.service';
import { RunExecutor } from '../runqueue/run-executor.service';
import { QueueService } from '../runqueue/queue.service';

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
    private readonly executor: RunExecutor,
    @Optional() private readonly queue?: QueueService,
    @Optional() private readonly notify?: NotifyService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.hydrate();
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

    if (this.queue?.enabled) {
      await this.queue.enqueueRun(runId);
      void this.queue.waitForCompletion(runId).then((status) => {
        view.status = (status as RunStatus) ?? 'succeeded';
        view.finishedAt = new Date().toISOString();
        for (const jv of view.jobs) {
          if (jv.status === 'running' || jv.status === 'pending') {
            jv.status = 'succeeded';
          }
        }
      }).catch(() => undefined);
    } else {
      void this.executor
        .executeDag({
          runId,
          traceId: view.traceId,
          workflowName: view.workflowName,
          jobs: spec.jobs,
          meta,
          onJobStatus: (jobId, status) => {
            const jv = view.jobs.find((x) => x.id === jobId);
            if (jv) {
              jv.status = status;
            }
          },
        })
        .then((status) => {
          view.status = status;
          view.finishedAt = new Date().toISOString();
        })
        .catch(() => undefined);
    }
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
}
