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
}

function matchesTenant(event: DomainEvent, opts?: ListEventsOptions): boolean {
  if (!opts?.tenantId) {
    return true;
  }
  return event.tenantId === opts.tenantId;
}

export class InMemoryEventStore implements EventStore {
  private readonly events: DomainEvent[] = [];

  constructor(private readonly bus?: { publish(event: DomainEvent): void }) {}

  async append(event: DomainEvent): Promise<void> {
    this.events.push(event);
    this.bus?.publish(event);
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
