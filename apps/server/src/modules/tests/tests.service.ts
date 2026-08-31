import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AGGREGATE, EVENT, makeEvent, newChangeTraceId, newId } from '../../events';
import { EVENT_STORE, type EventStore, type DomainEvent } from '../../events';

export interface TestSuiteView {
  id: string;
  traceId: string;
  name: string;
  serviceId: string;
  command?: string;
  tags: string[];
  createdBy: string;
  createdAt: string;
}

export interface TestRunView {
  suiteId: string;
  traceId: string;
  passed: number;
  failed: number;
  durationMs: number;
  recordedAt: string;
}

export interface SelectionResult {
  suites: TestSuiteView[];
  reasons: Record<string, string[]>;
}

@Injectable()
export class TestsService {
  constructor(@Inject(EVENT_STORE) private readonly eventStore: EventStore) {}

  async create(input: {
    name: string;
    serviceId: string;
    command?: string;
    tags?: string[];
    actorId: string;
  }): Promise<TestSuiteView> {
    const existing = await this.list();
    if (existing.some((s) => s.name === input.name && s.serviceId === input.serviceId)) {
      throw new ConflictException(`suite '${input.name}' already exists for this service`);
    }
    const id = newId('suite');
    const event = makeEvent({
      traceId: newChangeTraceId(),
      type: EVENT.testSuiteCreated,
      aggregateType: AGGREGATE.testSuite,
      aggregateId: id,
      actor: { type: 'user', id: input.actorId },
      payload: {
        name: input.name,
        serviceId: input.serviceId,
        command: input.command ?? null,
        tags: input.tags ?? [],
      },
    });
    await this.eventStore.append(event);
    return (await this.project(event.aggregateId)) as TestSuiteView;
  }

  async list(): Promise<TestSuiteView[]> {
    const created = await this.eventStore.listByType(EVENT.testSuiteCreated);
    const views = await Promise.all(created.map((e) => this.project(e.aggregateId)));
    return views.filter((v): v is TestSuiteView => v !== null);
  }

  async record(input: {
    suiteId: string;
    passed: number;
    failed: number;
    durationMs: number;
    actorId: string;
  }): Promise<TestRunView> {
    const suite = await this.project(input.suiteId);
    if (!suite) {
      throw new NotFoundException(`test suite ${input.suiteId} not found`);
    }
    const event = makeEvent({
      traceId: suite.traceId,
      type: EVENT.testRunRecorded,
      aggregateType: AGGREGATE.testRun,
      aggregateId: input.suiteId,
      actor: { type: 'user', id: input.actorId },
      payload: { passed: input.passed, failed: input.failed, durationMs: input.durationMs },
    });
    await this.eventStore.append(event);
    return {
      suiteId: input.suiteId,
      traceId: suite.traceId,
      passed: input.passed,
      failed: input.failed,
      durationMs: input.durationMs,
      recordedAt: event.occurredAt,
    };
  }

  async history(suiteId: string): Promise<TestRunView[]> {
    const events = await this.eventStore.listByAggregate(AGGREGATE.testRun, suiteId);
    return events
      .filter((e) => e.type === EVENT.testRunRecorded)
      .map((e) => ({
        suiteId,
        traceId: e.traceId,
        passed: e.payload.passed as number,
        failed: e.payload.failed as number,
        durationMs: e.payload.durationMs as number,
        recordedAt: e.occurredAt,
      }));
  }

  async select(input: {
    serviceId: string;
    changedPaths: string[];
  }): Promise<{ suites: TestSuiteView[]; reasons: Record<string, string> }> {
    const all = await this.list();
    const candidates = all.filter((s) => s.serviceId === input.serviceId);
    const reasons: Record<string, string> = {};
    const selected = new Set<string>();

    for (const suite of candidates) {
      const history = await this.history(suite.id);
      const recentFailure = history.slice(-5).some((h) => h.failed > 0);
      const tagMatch = suite.tags.some((tag) =>
        input.changedPaths.some((p) => p.includes(tag) || tag.includes(p)),
      );
      if (tagMatch) {
        selected.add(suite.id);
        reasons[suite.id] = 'tag matches changed path';
      } else if (history.some((h) => h.failed > 0)) {
        selected.add(suite.id);
        reasons[suite.id] = 'recent failures in history';
      }
    }

    if (selected.size === 0 && candidates.length > 0) {
      for (const suite of candidates) {
        selected.add(suite.id);
        reasons[suite.id] = 'safe default: no signal matched';
      }
    }

    return {
      suites: candidates.filter((s) => selected.has(s.id)),
      reasons,
    };
  }

  private async project(id: string): Promise<TestSuiteView | null> {
    const events = await this.eventStore.listByAggregate(AGGREGATE.testSuite, id);
    if (events.length === 0) {
      return null;
    }
    let view: TestSuiteView | null = null;
    for (const event of events) {
      if (event.type === EVENT.testSuiteCreated) {
        view = {
          id,
          traceId: event.traceId,
          name: event.payload.name as string,
          serviceId: event.payload.serviceId as string,
          command: (event.payload.command as string | null) ?? undefined,
          tags: (event.payload.tags as string[]) ?? [],
          createdBy: event.actor.id,
          createdAt: event.occurredAt,
        };
      }
    }
    return view;
  }
}
