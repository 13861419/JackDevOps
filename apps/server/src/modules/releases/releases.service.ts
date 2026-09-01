import { ConflictException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { AGGREGATE, EVENT, makeEvent, newId } from '../../events';
import { EVENT_STORE, type EventStore, type DomainEvent } from '../../events';
import { LlmService } from '../ai/llm.service';
import { defaultSteps, type ReleaseStep, type ReleaseStrategyType } from './release.types';

export interface ReleaseApproval {
  decision: 'approved' | 'rejected';
  aiSummary?: string;
  actorId: string;
  at: string;
}

export interface ReleaseView {
  id: string;
  traceId: string;
  runId: string;
  version: string;
  artifacts: string[];
  strategy: ReleaseStrategyType;
  steps: ReleaseStep[];
  approvals: ReleaseApproval[];
  status: 'in_progress' | 'promoted' | 'rolled_back';
  reason?: string;
  redeployedFrom?: string;
  redeployedAt?: string;
  createdAt: string;
}

interface ReleaseAggregate {
  traceId: string;
  version: string;
  runId: string;
  artifacts: string[];
  strategy: ReleaseStrategyType;
  steps: ReleaseStep[];
  approvals: ReleaseApproval[];
  status: 'in_progress' | 'promoted' | 'rolled_back';
  reason?: string;
  redeployedFrom?: string;
  redeployedAt?: string;
  createdAt: string;
}

@Injectable()
export class ReleasesService {
  constructor(
    @Inject(EVENT_STORE) private readonly eventStore: EventStore,
    @Optional() private readonly llm?: LlmService,
  ) {}

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

  async approve(
    id: string,
    input: { decision: 'approved' | 'rejected'; aiSummary?: string; actorId: string },
  ): Promise<ReleaseView> {
    const aggregate = await this.load(id);
    if (!aggregate) {
      throw new NotFoundException(`release ${id} not found`);
    }
    if (aggregate.status !== 'in_progress') {
      throw new ConflictException(`release ${id} is ${aggregate.status}, cannot review`);
    }
    await this.eventStore.append(
      makeEvent({
        traceId: aggregate.traceId,
        type: EVENT.releaseApproved,
        aggregateType: AGGREGATE.release,
        aggregateId: id,
        actor: { type: 'user', id: input.actorId },
        payload: { decision: input.decision, aiSummary: input.aiSummary ?? null },
      }),
    );
    const view = await this.project(id);
    return view as ReleaseView;
  }

  async promote(id: string, actorId: string): Promise<ReleaseView> {
    const aggregate = await this.load(id);
    if (!aggregate) {
      throw new NotFoundException(`release ${id} not found`);
    }
    if (aggregate.status !== 'in_progress') {
      throw new ConflictException(`release ${id} is ${aggregate.status}, cannot promote`);
    }
    if (aggregate.strategy !== 'rolling' && !aggregate.approvals.some((a) => a.decision === 'approved')) {
      throw new ConflictException(
        `release ${id} requires an approval before promotion (strategy: ${aggregate.strategy})`,
      );
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
    const target = await this.findLastPromoted(id);
    if (target) {
      await this.eventStore.append(
        makeEvent({
          traceId: target.traceId,
          type: EVENT.releaseRedeployed,
          aggregateType: AGGREGATE.release,
          aggregateId: target.id,
          actor: { type: 'user', id: actorId },
          payload: { fromReleaseId: id, reason, artifacts: target.artifacts },
        }),
      );
    }
    const view = await this.project(id);
    return view as ReleaseView;
  }

  private async findLastPromoted(excludeId: string): Promise<ReleaseView | null> {
    const all = await this.list();
    const promoted = all
      .filter((r) => r.id !== excludeId && r.status === 'promoted')
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return promoted[0] ?? null;
  }

  async notes(id: string): Promise<{ notes: string; generatedBy: 'rules' | 'ai' }> {
    const aggregate = await this.load(id);
    if (!aggregate) {
      throw new NotFoundException(`release ${id} not found`);
    }
    const rulesNotes = [
      `# Release ${aggregate.version}`,
      `- 状态: ${aggregate.status}`,
      `- 策略: ${aggregate.strategy}`,
      `- 关联物: ${aggregate.artifacts.length ? aggregate.artifacts.join(', ') : '无'}`,
      `- 审批: ${aggregate.approvals.length ? aggregate.approvals.map((a) => `${a.decision} by ${a.actorId}`).join('; ') : '待审批'}`,
      `- 步骤: ${aggregate.steps.map((s) => `${s.weight}%(${s.status})`).join(' -> ')}`,
    ].join('\n');

    if (this.llm?.available) {
      try {
        const res = await this.llm.chat([
          { role: 'system', content: '你是发布经理助手，把结构化发布信息润色成一段给干系人的中文 Release Notes。' },
          { role: 'user', content: rulesNotes },
        ]);
        return { notes: res.answer, generatedBy: 'ai' };
      } catch {
        return { notes: rulesNotes, generatedBy: 'rules' };
      }
    }
    return { notes: rulesNotes, generatedBy: 'rules' };
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
          approvals: [],
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
      } else if (event.type === EVENT.releaseRedeployed && aggregate) {
        aggregate.redeployedFrom = event.payload.fromReleaseId as string;
        aggregate.redeployedAt = event.occurredAt;
      } else if (event.type === EVENT.releaseApproved && aggregate) {
        aggregate.approvals.push({
          decision: event.payload.decision as 'approved' | 'rejected',
          aiSummary: (event.payload.aiSummary as string | null) ?? undefined,
          actorId: event.actor.id,
          at: event.occurredAt,
        });
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
      approvals: aggregate.approvals,
      status: aggregate.status,
      reason: aggregate.reason,
      redeployedFrom: aggregate.redeployedFrom,
      redeployedAt: aggregate.redeployedAt,
      createdAt: aggregate.createdAt,
    };
  }
}

export type { DomainEvent };
