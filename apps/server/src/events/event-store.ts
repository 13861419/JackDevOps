import type { DomainEvent } from './domain-event';

export interface ListEventsOptions {
  tenantId?: string;
}

export interface EventStore {
  append(event: DomainEvent): Promise<void>;
  listByTrace(traceId: string, opts?: ListEventsOptions): Promise<DomainEvent[]>;
  listByAggregate(
    aggregateType: string,
    aggregateId: string,
    opts?: ListEventsOptions,
  ): Promise<DomainEvent[]>;
  listByType(type: string, opts?: ListEventsOptions): Promise<DomainEvent[]>;
  listAll(limit?: number, offset?: number, opts?: ListEventsOptions): Promise<DomainEvent[]>;
  /** Persist a projection snapshot; callers replay only events with aggregateVersion > snapshot.version */
  saveSnapshot(
    aggregateType: string,
    aggregateId: string,
    lastVersion: number,
    state: unknown,
  ): Promise<void>;
  loadSnapshot(
    aggregateType: string,
    aggregateId: string,
  ): Promise<{ version: number; state: unknown } | null>;
}

export interface AggregateSnapshot {
  version: number;
  state: unknown;
}

function matchesTenant(event: DomainEvent, opts?: ListEventsOptions): boolean {
  if (!opts?.tenantId) {
    return true;
  }
  return event.tenantId === opts.tenantId;
}

export class InMemoryEventStore implements EventStore {
  private readonly events: DomainEvent[] = [];
  private readonly versions = new Map<string, number>();
  private readonly snapshots = new Map<string, AggregateSnapshot>();

  constructor(private readonly bus?: { publish(event: DomainEvent): void }) {}

  async append(event: DomainEvent): Promise<void> {
    const key = `${event.aggregateType}:${event.aggregateId}`;
    const version = (this.versions.get(key) ?? 0) + 1;
    this.versions.set(key, version);
    event.aggregateVersion = version;
    this.events.push(event);
    this.bus?.publish(event);
  }

  async saveSnapshot(
    aggregateType: string,
    aggregateId: string,
    lastVersion: number,
    state: unknown,
  ): Promise<void> {
    this.snapshots.set(`${aggregateType}:${aggregateId}`, { version: lastVersion, state });
  }

  async loadSnapshot(aggregateType: string, aggregateId: string): Promise<AggregateSnapshot | null> {
    return this.snapshots.get(`${aggregateType}:${aggregateId}`) ?? null;
  }

  async listByTrace(traceId: string, opts?: ListEventsOptions): Promise<DomainEvent[]> {
    return Promise.resolve(this.events.filter((e) => e.traceId === traceId && matchesTenant(e, opts)));
  }

  async listByAggregate(
    aggregateType: string,
    aggregateId: string,
    opts?: ListEventsOptions,
  ): Promise<DomainEvent[]> {
    return Promise.resolve(
      this.events.filter((e) => {
        if (e.aggregateType !== aggregateType || e.aggregateId !== aggregateId) {
          return false;
        }
        return matchesTenant(e, opts);
      }),
    );
  }

  async listByType(type: string, opts?: ListEventsOptions): Promise<DomainEvent[]> {
    return Promise.resolve(
      this.events.filter((e) => e.type === type && matchesTenant(e, opts)),
    );
  }

  async listAll(limit = 100, offset = 0, opts?: ListEventsOptions): Promise<DomainEvent[]> {
    const scoped = this.events.filter((e) => matchesTenant(e, opts));
    const start = Math.max(0, scoped.length - offset);
    const end = Math.max(0, start - limit);
    return Promise.resolve(scoped.slice(end, start).reverse());
  }
}
