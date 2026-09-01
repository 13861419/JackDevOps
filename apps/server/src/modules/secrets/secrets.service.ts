import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AGGREGATE, EVENT, makeEvent, newChangeTraceId } from '../../events';
import { EVENT_STORE, type EventStore, type DomainEvent } from '../../events';
import { CatalogService } from '../catalog/catalog.service';

export interface SecretRefView {
  serviceId: string;
  key: string;
  provider: string;
  ref: string;
  registeredAt: string;
  registeredBy: string;
}

@Injectable()
export class SecretsService {
  constructor(
    @Inject(EVENT_STORE) private readonly eventStore: EventStore,
    private readonly catalog: CatalogService,
  ) {}

  async register(
    slug: string,
    input: { key: string; provider: string; ref: string; actorId: string },
  ): Promise<SecretRefView> {
    const service = await this.resolveService(slug);
    if (!service) {
      throw new NotFoundException(`service ${slug} not found`);
    }
    const existing = await this.list(slug);
    if (existing.some((s) => s.key === input.key)) {
      await this.eventStore.append(
        makeEvent({
          traceId: service.traceId,
          type: EVENT.secretRefDeleted,
          aggregateType: AGGREGATE.service,
          aggregateId: service.slug,
          actor: { type: 'user', id: input.actorId },
          payload: { key: input.key, reason: 'replaced' },
        }),
      );
    }
    await this.eventStore.append(
      makeEvent({
        traceId: service.traceId,
        type: EVENT.secretRefRegistered,
        aggregateType: AGGREGATE.service,
        aggregateId: service.slug,
        actor: { type: 'user', id: input.actorId },
        payload: { key: input.key, provider: input.provider, ref: input.ref },
      }),
    );
    return {
      serviceId: service.slug,
      key: input.key,
      provider: input.provider,
      ref: input.ref,
      registeredAt: new Date().toISOString(),
      registeredBy: input.actorId,
    };
  }

  async list(slug: string): Promise<SecretRefView[]> {
    const service = await this.resolveService(slug);
    if (!service) {
      throw new NotFoundException(`service ${slug} not found`);
    }
    const events = await this.eventStore.listByAggregate(AGGREGATE.service, service.slug);
    const byKey = new Map<string, SecretRefView>();
    for (const event of events) {
      if (event.type === EVENT.secretRefRegistered) {
        byKey.set(event.payload.key as string, {
          serviceId: service.slug,
          key: event.payload.key as string,
          provider: event.payload.provider as string,
          ref: event.payload.ref as string,
          registeredAt: event.occurredAt,
          registeredBy: event.actor.id,
        });
      } else if (event.type === EVENT.secretRefDeleted) {
        byKey.delete(event.payload.key as string);
      }
    }
    return [...byKey.values()];
  }

  async resolve(
    slug: string,
    input: { keys?: string[]; actorId: string },
  ): Promise<{ serviceId: string; env: Record<string, string>; count: number }> {
    const refs = await this.list(slug);
    const env: Record<string, string> = {};
    for (const ref of refs) {
      if (input.keys && input.keys.length > 0 && !input.keys.includes(ref.key)) {
        continue;
      }
      env[ref.key] = `external://${ref.provider}/${ref.ref}`;
    }
    return { serviceId: slug, env, count: Object.keys(env).length };
  }

  async remove(slug: string, key: string, actorId: string): Promise<{ removed: boolean }> {
    const refs = await this.list(slug);
    if (!refs.some((s) => s.key === key)) {
      throw new NotFoundException(`secret ref ${key} not found on ${slug}`);
    }
    const service = await this.resolveService(slug);
    if (!service) {
      throw new NotFoundException(`service ${slug} not found`);
    }
    await this.eventStore.append(
      makeEvent({
        traceId: service.traceId,
        type: EVENT.secretRefDeleted,
        aggregateType: AGGREGATE.service,
        aggregateId: service.slug,
        actor: { type: 'user', id: actorId },
        payload: { key, reason: 'manual' },
      }),
    );
    return { removed: true };
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

export type { DomainEvent };
