import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { AGGREGATE, EVENT, makeEvent, newId, newChangeTraceId } from '../../events';
import { EVENT_STORE, type EventStore, type DomainEvent } from '../../events';

export interface ServiceView {
  id: string;
  traceId: string;
  name: string;
  slug: string;
  repoUrl?: string;
  language?: string;
  ownerId: string;
  description?: string;
  registeredAt: string;
}

@Injectable()
export class CatalogService {
  constructor(@Inject(EVENT_STORE) private readonly eventStore: EventStore) {}

  async register(input: {
    name: string;
    slug?: string;
    repoUrl?: string;
    language?: string;
    ownerId: string;
    description?: string;
  }): Promise<ServiceView> {
    const slug = input.slug?.trim() || this.deriveSlug(input.name);
    const existing = await this.get(slug);
    if (existing) {
      throw new ConflictException(`service slug '${slug}' already registered`);
    }
    const id = newId('svc');
    const event = makeEvent({
      traceId: newChangeTraceId(),
      type: EVENT.serviceRegistered,
      aggregateType: AGGREGATE.service,
      aggregateId: id,
      actor: { type: 'user', id: input.ownerId },
      payload: {
        name: input.name,
        slug,
        repoUrl: input.repoUrl ?? null,
        language: input.language ?? null,
        description: input.description ?? null,
      },
    });
    await this.eventStore.append(event);
    return { ...this.project(id, event) } as ServiceView;
  }

  private deriveSlug(name: string): string {
    const ascii = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return ascii || `svc-${Date.now().toString(36)}`;
  }

  async get(slug: string): Promise<ServiceView | null> {
    const registered = await this.eventStore.listByType(EVENT.serviceRegistered);
    const found = registered.find((e) => e.payload.slug === slug);
    return found ? this.project(found.aggregateId, found) : null;
  }

  async list(): Promise<ServiceView[]> {
    const registered = await this.eventStore.listByType(EVENT.serviceRegistered);
    return registered.map((e) => this.project(e.aggregateId, e));
  }

  async trace(slug: string): Promise<DomainEvent[]> {
    const service = await this.get(slug);
    if (!service) {
      throw new ConflictException(`service ${slug} not found`);
    }
    return this.eventStore.listByTrace(service.traceId);
  }

  private project(id: string, created: DomainEvent): ServiceView {
    return {
      id,
      traceId: created.traceId,
      name: created.payload.name as string,
      slug: created.payload.slug as string,
      repoUrl: (created.payload.repoUrl as string | null) ?? undefined,
      language: (created.payload.language as string | null) ?? undefined,
      ownerId: created.actor.id,
      description: (created.payload.description as string | null) ?? undefined,
      registeredAt: created.occurredAt,
    };
  }
}
