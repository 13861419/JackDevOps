import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AGGREGATE, EVENT, makeEvent, newId } from '../../events';
import { EVENT_STORE, type EventStore, type DomainEvent } from '../../events';
import { defaultSteps, type ReleaseStep, type ReleaseStrategyType } from './release.types';

export interface ReleaseView {
  id: string;
  traceId: string;
  runId: string;
  version: string;
  artifacts: string[];
  strategy: ReleaseStrategyType;
  steps: ReleaseStep[];
  status: 'in_progress' | 'promoted' | 'rolled_back';
  reason?: string;
  createdAt: string;
}

interface ReleaseAggregate {
  traceId: string;
  version: string;
  runId: string;
  artifacts: string[];
  strategy: ReleaseStrategyType;
  steps: ReleaseStep[];
  status: 'in_progress' | 'promoted' | 'rolled_back';
  reason?: string;
  createdAt: string;
}

@Injectable()
export class ReleasesService {
  constructor(@Inject(EVENT_STORE) private readonly eventStore: EventStore) {}

  async register(input: {
    runId: string;
    version: string;
    artifacts: string[];
    strategy: ReleaseStrategyType;
    actorId: string;
  }): Promise<ReleaseView> {
    const started = await this.eventStore
      .listByAggregate(AGGREGATE.workflowRun, input.runId)
      .then((events) => events.find((e) => e.type === EVENT.runStarted));
    if (!started) {
      throw new NotFoundException(`run ${input.runId} not found`);
    }
    const dup = await this.eventStore
      .listByType(EVENT.releaseRegistered)
      .then((events) =>
        events.find((e) => (e.payload as { version: string }).version === input.version),
      );
    if (dup) {
      throw new ConflictException(`release version '${input.version}' already registered`);
    }

    const id = newId('rel');
    const strategy: ReleaseStrategyType = input.strategy ?? 'rolling';
    await this.eventStore.append(
      makeEvent({
        traceId: started.traceId,
        type: EVENT.releaseRegistered,
        aggregateType: AGGREGATE.release,
        aggregateId: id,
        actor: { type: 'user', id: input.actorId },
        payload: {
          runId: input.runId,
          version: input.version,
          artifacts: input.artifacts,
          strategy,
          steps: defaultSteps(strategy).map((weight) => ({ weight, status: 'pending' })),
        },
      }),
    );
    const view = await this.project(id);
    if (!view) {
      throw new ConflictException(`release ${id} projection failed`);
    }
    return view;
  }

  async promote(id: string, actorId: string): Promise<ReleaseView> {
    const aggregate = await this.load(id);
    if (!aggregate) {
      throw new NotFoundException(`release ${id} not found`);
    }
    if (aggregate.status !== 'in_progress') {
      throw new ConflictException(`release ${id} is ${aggregate.status}, cannot promote`);
    }
    for (const step of aggregate.steps) {
      if (step.status === 'pending') {
        step.status = 'succeeded';
        await this.eventStore.append(
          makeEvent({
            traceId: aggregate.traceId,
            type: EVENT.releaseStrategyStep,
            aggregateType: AGGREGATE.release,
            aggregateId: id,
            actor: { type: 'user', id: actorId },
            payload: { weight: step.weight, status: 'succeeded' },
          }),
        );
      }
    }
    await this.eventStore.append(
      makeEvent({
        traceId: aggregate.traceId,
        type: EVENT.releasePromoted,
        aggregateType: AGGREGATE.release,
        aggregateId: id,
        actor: { type: 'user', id: actorId },
        payload: { version: aggregate.version },
      }),
    );
    const view = await this.project(id);
    return view as ReleaseView;
  }

  async rollback(id: string, reason: string, actorId: string): Promise<ReleaseView> {
    const aggregate = await this.load(id);
    if (!aggregate) {
      throw new NotFoundException(`release ${id} not found`);
    }
    await this.eventStore.append(
      makeEvent({
        traceId: aggregate.traceId,
        type: EVENT.releaseRolledBack,
        aggregateType: AGGREGATE.release,
        aggregateId: id,
        actor: { type: 'user', id: actorId },
        payload: { reason, artifacts: aggregate.artifacts },
      }),
    );
    const view = await this.project(id);
    return view as ReleaseView;
  }

  async get(id: string): Promise<ReleaseView | null> {
    return this.project(id);
  }

  async list(): Promise<ReleaseView[]> {
    const registered = await this.eventStore.listByType(EVENT.releaseRegistered);
    const views = await Promise.all(registered.map((e) => this.project(e.aggregateId)));
    return views.filter((v): v is ReleaseView => v !== null);
  }

  private async load(id: string): Promise<ReleaseAggregate | null> {
    const events = await this.eventStore.listByAggregate(AGGREGATE.release, id);
    if (events.length === 0) {
      return null;
    }
    let aggregate: ReleaseAggregate | null = null;
    for (const event of events) {
      if (event.type === EVENT.releaseRegistered) {
        aggregate = {
          traceId: event.traceId,
          version: event.payload.version as string,
          runId: event.payload.runId as string,
          artifacts: (event.payload.artifacts as string[]) ?? [],
          strategy: (event.payload.strategy as ReleaseStrategyType) ?? 'rolling',
          steps: ((event.payload.steps as { weight: number; status: 'pending' }[]) ?? []).map(
            (s, index) => ({ index, weight: s.weight, status: 'pending' as const }),
          ),
          status: 'in_progress',
          createdAt: event.occurredAt,
        };
      } else if (event.type === EVENT.releaseStrategyStep && aggregate) {
        const step = aggregate.steps.find((s) => s.weight === (event.payload as { weight: number }).weight);
        if (step) {
          step.status = 'succeeded';
        }
      } else if (event.type === EVENT.releasePromoted && aggregate) {
        aggregate.status = 'promoted';
      } else if (event.type === EVENT.releaseRolledBack && aggregate) {
        aggregate.status = 'rolled_back';
        aggregate.reason = event.payload.reason as string;
      }
    }
    return aggregate;
  }

  private async project(id: string): Promise<ReleaseView | null> {
    const aggregate = await this.load(id);
    if (!aggregate) {
      return null;
    }
    return {
      id,
      traceId: aggregate.traceId,
      runId: aggregate.runId,
      version: aggregate.version,
      artifacts: aggregate.artifacts,
      strategy: aggregate.strategy,
      steps: aggregate.steps,
      status: aggregate.status,
      reason: aggregate.reason,
      createdAt: aggregate.createdAt,
    };
  }
}
