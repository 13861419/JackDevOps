import { describe, expect, it } from 'vitest';
import { InMemoryEventStore, makeEvent, AGGREGATE, EVENT } from '../src/events';

function makeEventWithTenant(tenantId?: string) {
  return makeEvent({
    tenantId,
    type: EVENT.workItemCreated,
    aggregateType: AGGREGATE.workItem,
    aggregateId: 'wi_t',
    actor: { type: 'user', id: 'u1' },
    payload: { title: 'x' },
  });
}

describe('tenant-scoped event store (M23 Phase 1)', () => {
  it('makeEvent carries tenantId through to the stored event', () => {
    const e = makeEventWithTenant('acme');
    expect(e.tenantId).toBe('acme');
    expect(makeEventWithTenant(undefined).tenantId).toBeUndefined();
  });

  it('listByType filters by tenant; absent tenantId = global (backward compat)', async () => {
    const store = new InMemoryEventStore();
    await store.append(makeEventWithTenant('acme'));
    await store.append(makeEventWithTenant('other'));
    await store.append(makeEventWithTenant(undefined));

    const acme = await store.listByType(EVENT.workItemCreated, { tenantId: 'acme' });
    expect(acme.length).toBe(1);
    expect(acme[0].tenantId).toBe('acme');

    const all = await store.listByType(EVENT.workItemCreated);
    expect(all.length).toBe(3);
  });

  it('listByAggregate and listAll respect tenant scope', async () => {
    const store = new InMemoryEventStore();
    await store.append(makeEventWithTenant('acme'));
    await store.append(makeEventWithTenant('other'));

    const acmeAggregate = await store.listByAggregate(AGGREGATE.workItem, 'wi_x', { tenantId: 'acme' });
    expect(acmeAggregate.length).toBe(0);

    const acmeAll = await store.listAll(100, 0, { tenantId: 'acme' });
    expect(acmeAll.length).toBe(1);

    const globalEvents = await store.listAll(100, 0);
    expect(globalEvents.length).toBe(2);
  });

  it('listByTrace respects tenant scope', async () => {
    const store = new InMemoryEventStore();
    const acmeEvent = makeEventWithTenant('acme');
    await store.append(acmeEvent);
    await store.append(makeEventWithTenant(undefined));

    const scoped = await store.listByTrace(acmeEvent.traceId, { tenantId: 'acme' });
    expect(scoped.length).toBe(1);
    const empty = await store.listByTrace(acmeEvent.traceId, { tenantId: 'other' });
    expect(empty.length).toBe(0);
  });
});
