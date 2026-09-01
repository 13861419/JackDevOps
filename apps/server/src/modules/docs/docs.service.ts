import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AGGREGATE, EVENT, makeEvent, newId } from '../../events';
import { EVENT_STORE, type EventStore, type DomainEvent } from '../../events';
import { CatalogService } from '../catalog/catalog.service';

export interface DocView {
  slug: string;
  content?: string;
  updatedAt?: string;
  updatedBy?: string;
  stale: boolean;
  staleReason?: string;
}

@Injectable()
export class DocsService {
  constructor(
    @Inject(EVENT_STORE) private readonly eventStore: EventStore,
    private readonly catalog: CatalogService,
  ) {}

  async upsert(
    slug: string,
    input: { content: string; actorId: string },
  ): Promise<DocView> {
    const service = await this.resolveService(slug);
    if (!service) {
      throw new NotFoundException(`service ${slug} not found`);
    }
    await this.eventStore.append(
      makeEvent({
        traceId: service.traceId,
        type: EVENT.docUpdated,
        aggregateType: AGGREGATE.doc,
        aggregateId: docId(slug),
        actor: { type: 'user', id: input.actorId },
        payload: { slug, content: input.content.slice(0, 50_000) },
      }),
    );
    return this.get(slug) as Promise<DocView>;
  }

  async get(slug: string): Promise<DocView | null> {
    const events = await this.eventStore.listByAggregate(AGGREGATE.doc, docId(slug));
    const updated = [...events].reverse().find((e) => e.type === EVENT.docUpdated);
    if (!updated) {
      return { slug, stale: true, staleReason: 'no documentation yet' };
    }
    const promoted = await this.eventStore.listByType(EVENT.releasePromoted);
    const newer = promoted.find((e) => e.occurredAt > updated.occurredAt);
    return {
      slug,
      content: (updated.payload.content as string) ?? '',
      updatedAt: updated.occurredAt,
      updatedBy: updated.actor.id,
      stale: newer !== undefined,
      staleReason: newer ? `release promoted at ${newer.occurredAt} is newer than the doc` : undefined,
    };
  }

  async list(): Promise<DocView[]> {
    const services = await this.catalog.list();
    const docs = await Promise.all(services.map((s) => this.get(s.slug)));
    return docs.filter((d): d is DocView => d !== null);
  }

  private async resolveService(idOrSlug: string) {
    const bySlug = await this.catalog.get(idOrSlug);
    if (bySlug) {
      return bySlug;
    }
    const all = await this.catalog.list();
    return all.find((s) => s.id === idOrSlug) ?? null;
  }
}

function docId(slug: string): string {
  return `doc:${slug}`;
}

export type { DomainEvent };
