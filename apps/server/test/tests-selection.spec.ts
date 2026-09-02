import { RunExecutor } from '../src/modules/runqueue/run-executor.service';
import { describe, expect, it } from 'vitest';
import { InMemoryEventStore, EVENT, AGGREGATE, makeEvent, newChangeTraceId } from '../src/events';
import { TestsService } from '../src/modules/tests/tests.service';

describe('test suite management and smart selection (C1/C4)', () => {
  const store = new InMemoryEventStore();
  const tests = new TestsService(store);

  it('creates suites and lists them per service', async () => {
    const s1 = await tests.create({ name: 'unit', serviceId: 'svc-1', tags: ['unit'], actorId: 'u1' });
    await tests.create({ name: 'e2e', serviceId: 'svc-1', tags: ['e2e', 'slow'], actorId: 'u1' });
    await tests.create({ name: 'other', serviceId: 'svc-2', tags: ['unit'], actorId: 'u1' });
    expect(s1.id.startsWith('suite_')).toBe(true);

    const forSvc1 = await tests.list().then((all) => all.filter((s) => s.serviceId === 'svc-1'));
    expect(forSvc1).toHaveLength(2);
  });

  it('selects suites by tag match on changed paths', async () => {
    const { suites, reasons } = await tests.select({
      serviceId: 'svc-1',
      changedPaths: ['src/e2e-helper.ts'],
    });
    expect(suites.some((s) => s.name === 'e2e')).toBe(true);
    for (const suite of suites) {
      expect(reasons[suite.id]).toContain('tag');
    }
  });

  it('includes suites with recent failures', async () => {
    const all = await tests.list();
    const unit = all.find((s) => s.name === 'unit');
    if (!unit) {
      throw new Error('unit suite missing');
    }
    await tests.record({ suiteId: unit.id, passed: 3, failed: 1, durationMs: 100, actorId: 'ci' });
    const { suites, reasons } = await tests.select({
      serviceId: 'svc-1',
      changedPaths: ['src/unrelated.ts'],
    });
    expect(suites.some((s) => s.name === 'unit')).toBe(true);
    expect(reasons[unit.id]).toContain('failures');
  });

  it('falls back to all service suites when nothing matches', async () => {
    const { suites } = await tests.select({ serviceId: 'svc-2', changedPaths: ['nothing/matches.ts'] });
    expect(suites.length).toBe(1);
  });
});

describe('audit query (F3)', () => {
  const store = new InMemoryEventStore();

  it('listAll returns newest first with limit/offset', async () => {
    for (let i = 0; i < 5; i++) {
      await store.append(
        makeEvent({
          traceId: newChangeTraceId(),
          type: EVENT.serviceRegistered,
          aggregateType: AGGREGATE.service,
          aggregateId: `svc-${i}`,
          actor: { type: 'user', id: 'u1' },
          payload: { key: `s-${i}`, description: '', rolloutPercent: 0 },
        }),
      );
    }
    const page1 = await store.listAll(2, 0);
    expect(page1.length).toBe(2);
    const all = await store.listAll(100, 0);
    expect(all.length).toBe(5);
  });
});
