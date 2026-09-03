import { describe, expect, it } from 'vitest';
import { InMemoryEventStore, makeEvent, AGGREGATE, EVENT } from '../src/events';
import { PreviewsService } from '../src/modules/previews/previews.service';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import type { DomainEvent } from '../src/events';

describe('aggregate snapshots (M26)', () => {
  it('append assigns monotonic aggregateVersion per aggregate', async () => {
    const store = new InMemoryEventStore();
    const a = makeEvent({
      type: EVENT.workItemCreated,
      aggregateType: AGGREGATE.workItem,
      aggregateId: 'wi_1',
      actor: { type: 'user', id: 'u' },
      payload: {},
    });
    const b = makeEvent({
      type: EVENT.workItemStatusChanged,
      aggregateType: AGGREGATE.workItem,
      aggregateId: 'wi_1',
      actor: { type: 'user', id: 'u' },
      payload: {},
    });
    await store.append(a);
    await store.append(b);
    expect(a.aggregateVersion).toBe(1);
    expect(b.aggregateVersion).toBe(2);
  });

  it('saveSnapshot/loadSnapshot roundtrip', async () => {
    const store = new InMemoryEventStore();
    expect(await store.loadSnapshot(AGGREGATE.workItem, 'wi_9')).toBeNull();
    await store.saveSnapshot(AGGREGATE.workItem, 'wi_9', 42, { status: 'done' });
    expect(await store.loadSnapshot(AGGREGATE.workItem, 'wi_9')).toEqual({
      version: 42,
      state: { status: 'done' },
    });
    await store.saveSnapshot(AGGREGATE.workItem, 'wi_9', 50, { status: 'v2' });
    expect((await store.loadSnapshot(AGGREGATE.workItem, 'wi_9'))?.version).toBe(50);
  });

  it('previews load replays only events after the snapshot', async () => {
    const store = new InMemoryEventStore();
    const catalog = new CatalogService(store);
    const previews = new PreviewsService(store, catalog, async () => false, async () => false);
    await catalog.register({ name: '快照', slug: 'snap-svc', ownerId: 'ops' });
    const preview = await previews.request({ serviceId: 'snap-svc', prNumber: 26, actorId: 't' });

    // Snapshot taken as-of version 2 (request + auto-ready).
    await store.saveSnapshot(AGGREGATE.previewEnv, preview.id, 2, {
      traceId: preview.traceId,
      serviceId: 'snap-svc',
      prNumber: 26,
      status: 'ready',
      url: 'http://old-url',
      createdAt: preview.createdAt,
      ttlHours: 72,
    });

    // A newer event (version 3) arrives after the snapshot.
    await store.append(
      makeEvent({
        traceId: preview.traceId,
        type: EVENT.previewEnvReady,
        aggregateType: AGGREGATE.previewEnv,
        aggregateId: preview.id,
        actor: { type: 'system', id: 'test' },
        payload: { url: 'http://new-url' },
      }),
    );

    const ready = await previews.get(preview.id);
    expect(ready?.status).toBe('ready');
    expect(ready?.url).toBe('http://new-url');
  });

  it('auto-snapshots when enough events accumulate since the last snapshot', async () => {
    const store = new InMemoryEventStore();
    const catalog = new CatalogService(store);
    const previews = new PreviewsService(store, catalog, async () => false, async () => false);
    await catalog.register({ name: '自快照', slug: 'autosnap-svc', ownerId: 'ops' });
    const preview = await previews.request({ serviceId: 'autosnap-svc', prNumber: 27, actorId: 't' });

    const events: DomainEvent[] = [];
    for (let i = 0; i < 25; i += 1) {
      const e = makeEvent({
        traceId: preview.traceId,
        type: EVENT.previewEnvReady,
        aggregateType: AGGREGATE.previewEnv,
        aggregateId: preview.id,
        actor: { type: 'system', id: 'test' },
        payload: { url: `http://u/${i}` },
      });
      events.push(e);
      await store.append(e);
    }
    // a read triggers the incremental fold and the auto-snapshot save
    await previews.get(preview.id);

    const snap = await store.loadSnapshot(AGGREGATE.previewEnv, preview.id);
    expect(snap).not.toBeNull();
    expect(snap?.version).toBe(events[events.length - 1].aggregateVersion);
    const view = await previews.get(preview.id);
    expect(view?.status).toBe('ready');
  });
});
