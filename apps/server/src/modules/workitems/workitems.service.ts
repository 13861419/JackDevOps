import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  AGGREGATE,
  EVENT,
  makeEvent,
  newChangeTraceId,
  newId,
} from '../../events/domain-event';
import { EVENT_STORE, type EventStore, type DomainEvent } from '../../events';
import {
  canTransition,
  WorkItemView,
  WorkItemKind,
  WorkItemStatus,
} from './workitem.types';

@Injectable()
export class WorkItemsService {
  constructor(@Inject(EVENT_STORE) private readonly eventStore: EventStore) {}

  async create(input: {
    title: string;
    kind: WorkItemKind;
    serviceId?: string;
    actorId: string;
  }): Promise<WorkItemView> {
    const id = newId('wi');
    const traceId = newChangeTraceId();
    const event = makeEvent({
      traceId,
      type: EVENT.workItemCreated,
      aggregateType: AGGREGATE.workItem,
      aggregateId: id,
      actor: { type: 'user', id: input.actorId },
      payload: {
        title: input.title,
        kind: input.kind,
        serviceId: input.serviceId ?? null,
      },
    });
    await this.eventStore.append(event);
    return this.project(id) as Promise<WorkItemView>;
  }

  async changeStatus(
    id: string,
    to: WorkItemStatus,
    actorId: string,
  ): Promise<WorkItemView> {
    const current = await this.project(id);
    if (!current) {
      throw new ConflictException(`work item ${id} not found`);
    }
    if (!canTransition(current.status, to)) {
      throw new ConflictException(`invalid transition: ${current.status} -> ${to}`);
    }
    const event = makeEvent({
      traceId: current.traceId,
      type: EVENT.workItemStatusChanged,
      aggregateType: AGGREGATE.workItem,
      aggregateId: id,
      actor: { type: 'user', id: actorId },
      payload: { from: current.status, to },
    });
    await this.eventStore.append(event);
    return this.project(id) as Promise<WorkItemView>;
  }

  async get(id: string): Promise<WorkItemView | null> {
    return this.project(id);
  }

  async list(): Promise<WorkItemView[]> {
    const created = await this.eventStore.listByType(EVENT.workItemCreated);
    const views = await Promise.all(
      created.map((e) => this.project(e.aggregateId)),
    );
    return views.filter((v): v is WorkItemView => v !== null);
  }

  async trace(id: string): Promise<DomainEvent[]> {
    const item = await this.project(id);
    if (!item) {
      throw new ConflictException(`work item ${id} not found`);
    }
    return this.eventStore.listByTrace(item.traceId);
  }

  private async project(id: string): Promise<WorkItemView | null> {
    const events = await this.eventStore.listByAggregate(AGGREGATE.workItem, id);
    if (events.length === 0) {
      return null;
    }
    let view: WorkItemView | null = null;
    for (const event of events) {
      if (event.type === EVENT.workItemCreated) {
        view = {
          id,
          traceId: event.traceId,
          kind: event.payload.kind as WorkItemKind,
          title: event.payload.title as string,
          status: 'backlog',
          serviceId: (event.payload.serviceId as string | undefined) ?? undefined,
          createdBy: event.actor.id,
          createdAt: event.occurredAt,
        };
      } else if (event.type === EVENT.workItemStatusChanged && view) {
        view.status = event.payload.to as WorkItemStatus;
      }
    }
    return view;
  }
}
