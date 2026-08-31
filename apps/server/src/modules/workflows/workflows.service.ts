import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { AGGREGATE, EVENT, makeEvent, newChangeTraceId, newId } from '../../events';
import { EVENT_STORE, type EventStore } from '../../events';
import { JobRegistry } from './job-registry';
import { validateSpecDag, type WorkflowView, type WorkflowSpec } from './workflow.types';

@Injectable()
export class WorkflowsService {
  constructor(
    @Inject(EVENT_STORE) private readonly eventStore: EventStore,
    private readonly jobRegistry: JobRegistry,
  ) {}

  async create(input: {
    name: string;
    spec: WorkflowSpec;
    serviceId?: string;
    actorId: string;
  }): Promise<WorkflowView> {
    validateSpecDag(input.spec, this.jobRegistry.types());
    const id = newId('wf');
    const event = makeEvent({
      traceId: newChangeTraceId(),
      type: EVENT.workflowCreated,
      aggregateType: AGGREGATE.workflow,
      aggregateId: id,
      actor: { type: 'user', id: input.actorId },
      payload: {
        name: input.name,
        serviceId: input.serviceId ?? null,
        spec: input.spec,
      },
    });
    await this.eventStore.append(event);
    const view = await this.project(id);
    if (!view) {
      throw new ConflictException(`workflow ${id} projection failed`);
    }
    return view;
  }

  async list(): Promise<WorkflowView[]> {
    const created = await this.eventStore.listByType(EVENT.workflowCreated);
    const views = await Promise.all(created.map((e) => this.project(e.aggregateId)));
    return views.filter((v): v is WorkflowView => v !== null);
  }

  async get(id: string): Promise<WorkflowView | null> {
    return this.project(id);
  }

  private async project(id: string): Promise<WorkflowView | null> {
    const events = await this.eventStore.listByAggregate(AGGREGATE.workflow, id);
    if (events.length === 0) {
      return null;
    }
    let view: WorkflowView | null = null;
    for (const event of events) {
      if (event.type === EVENT.workflowCreated) {
        view = {
          id,
          traceId: event.traceId,
          name: event.payload.name as string,
          serviceId: (event.payload.serviceId as string | null) ?? undefined,
          spec: event.payload.spec as WorkflowSpec,
          createdAt: event.occurredAt,
        };
      }
    }
    return view;
  }
}
