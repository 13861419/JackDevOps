import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { AGGREGATE, EVENT, makeEvent, newChangeTraceId } from '../../events';
import { EVENT_STORE, type EventStore, type DomainEvent } from '../../events';
import { deterministicOn } from '../releases/release.types';

export interface FlagView {
  key: string;
  traceId: string;
  description: string;
  rolloutPercent: number;
  createdBy: string;
  createdAt: string;
  lastEvaluatedAt?: string;
}

@Injectable()
export class FlagsService {
  private lastEvaluatedAt = new Map<string, string>();

  constructor(@Inject(EVENT_STORE) private readonly eventStore: EventStore) {}

  async create(input: {
    key: string;
    description?: string;
    rolloutPercent: number;
    actorId: string;
  }): Promise<FlagView> {
    if (await this.get(input.key)) {
      throw new ConflictException(`flag '${input.key}' already exists`);
    }
    await this.eventStore.append(
      makeEvent({
        traceId: newChangeTraceId(),
        type: EVENT.flagCreated,
        aggregateType: AGGREGATE.flag,
        aggregateId: input.key,
        actor: { type: 'user', id: input.actorId },
        payload: { key: input.key, description: input.description ?? '', rolloutPercent: input.rolloutPercent },
      }),
    );
    return (await this.project(input.key)) as FlagView;
  }

  async setRollout(key: string, percent: number, actorId: string): Promise<FlagView> {
    const flag = await this.get(key);
    if (!flag) {
      throw new ConflictException(`flag '${key}' not found`);
    }
    await this.eventStore.append(
      makeEvent({
        traceId: flag.traceId,
        type: EVENT.flagRolloutChanged,
        aggregateType: AGGREGATE.flag,
        aggregateId: key,
        actor: { type: 'user', id: actorId },
        payload: { from: flag.rolloutPercent, to: percent },
      }),
    );
    return (await this.project(key)) as FlagView;
  }

  async list(): Promise<FlagView[]> {
    const created = await this.eventStore.listByType(EVENT.flagCreated);
    const views = await Promise.all(created.map((e) => this.project(e.aggregateId)));
    return views.filter((v): v is FlagView => v !== null);
  }

  async get(key: string): Promise<FlagView | null> {
    const created = await this.eventStore.listByType(EVENT.flagCreated);
    const found = created.find((e) => (e.payload as { key: string }).key === key);
    return found ? this.project(found.aggregateId) : null;
  }

  async evaluate(key: string, userId: string): Promise<{ enabled: boolean; rolloutPercent: number } | null> {
    const flag = await this.get(key);
    if (!flag) {
      return null;
    }
    const enabled = deterministicOn(`${userId}:${key}`, flag.rolloutPercent);
    this.lastEvaluatedAt.set(key, new Date().toISOString());
    await this.eventStore.append(
      makeEvent({
        traceId: flag.traceId,
        type: EVENT.flagEvaluated,
        aggregateType: AGGREGATE.flag,
        aggregateId: key,
        actor: { type: 'system', id: 'flags' },
        payload: { userId, enabled },
      }),
    );
    return { enabled, rolloutPercent: flag.rolloutPercent };
  }

  async staleFlags(maxAgeDays: number): Promise<FlagView[]> {
    const cutoff = Date.now() - maxAgeDays * 24 * 3600 * 1000;
    const all = await this.list();
    return all.filter((f) => {
      const last = this.lastEvaluatedAt.get(f.key);
      return !last || Date.parse(last) < cutoff;
    });
  }

  private async project(key: string): Promise<FlagView | null> {
    const events = await this.eventStore.listByAggregate(AGGREGATE.flag, key);
    if (events.length === 0) {
      return null;
    }
    let view: FlagView | null = null;
    for (const event of events) {
      if (event.type === EVENT.flagCreated) {
        view = {
          key: event.payload.key as string,
          traceId: event.traceId,
          description: (event.payload.description as string) ?? '',
          rolloutPercent: (event.payload.rolloutPercent as number) ?? 0,
          createdBy: event.actor.id,
          createdAt: event.occurredAt,
          lastEvaluatedAt: this.lastEvaluatedAt.get(key),
        };
      } else if (event.type === EVENT.flagRolloutChanged && view) {
        view.rolloutPercent = event.payload.to as number;
      }
    }
    return view;
  }
}

export type { DomainEvent };
