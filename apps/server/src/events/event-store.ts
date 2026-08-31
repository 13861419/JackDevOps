import type { DomainEvent } from './domain-event';

export interface EventStore {
  append(event: DomainEvent): Promise<void>;
  listByTrace(traceId: string): Promise<DomainEvent[]>;
  listByAggregate(aggregateType: string, aggregateId: string): Promise<DomainEvent[]>;
  listByType(type: string): Promise<DomainEvent[]>;
  listAll(limit?: number, offset?: number): Promise<DomainEvent[]>;
}

export class InMemoryEventStore implements EventStore {
  private readonly events: DomainEvent[] = [];

  async append(event: DomainEvent): Promise<void> {
    this.events.push(event);
  }

  listByTrace(traceId: string): Promise<DomainEvent[]> {
    return Promise.resolve(this.events.filter((e) => e.traceId === traceId));
  }

  listByAggregate(aggregateType: string, aggregateId: string): Promise<DomainEvent[]> {
    return Promise.resolve(
      this.events.filter((e) => e.aggregateType === aggregateType && e.aggregateId === aggregateId),
    );
  }

  listByType(type: string): Promise<DomainEvent[]> {
    return Promise.resolve(this.events.filter((e) => e.type === type));
  }

  async listAll(limit = 100, offset = 0): Promise<DomainEvent[]> {
    const start = Math.max(0, this.events.length - offset);
    const end = Math.max(0, start - limit);
    return Promise.resolve(this.events.slice(end, start).reverse());
  }
}
