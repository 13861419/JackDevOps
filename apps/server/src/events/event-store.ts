import type { DomainEvent } from './domain-event';

export interface EventStore {
  append(event: DomainEvent): Promise<void>;
  listByTrace(traceId: string): Promise<DomainEvent[]>;
  listByAggregate(aggregateType: string, aggregateId: string): Promise<DomainEvent[]>;
  listByType(type: string): Promise<DomainEvent[]>;
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
}
