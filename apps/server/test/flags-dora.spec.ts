import { describe, expect, it } from 'vitest';
import { InMemoryEventStore, EVENT, AGGREGATE, makeEvent, newChangeTraceId, newId } from '../src/events';
import { FlagsService } from '../src/modules/flags/flags.service';
import { MetricsService } from '../src/modules/metrics/metrics.service';

describe('feature flags (F5)', () => {
  const store = new InMemoryEventStore();
  const flags = new FlagsService(store);

  it('evaluates deterministically per user', async () => {
    await flags.create({ key: 'new-checkout', rolloutPercent: 50, actorId: 'u1' });
    const first = await flags.evaluate('new-checkout', 'user-a');
    const second = await flags.evaluate('new-checkout', 'user-a');
    expect(first).not.toBeNull();
    expect(first?.enabled).toBe(second?.enabled);
  });

  it('rollout 100 enables everyone, 0 disables everyone', async () => {
    await flags.create({ key: 'all-on', rolloutPercent: 100, actorId: 'u1' });
    expect((await flags.evaluate('all-on', 'any-user'))?.enabled).toBe(true);
    await flags.create({ key: 'all-off', rolloutPercent: 0, actorId: 'u1' });
    expect((await flags.evaluate('all-off', 'any-user'))?.enabled).toBe(false);
  });

  it('flags without evaluation are stale', async () => {
    await flags.create({ key: 'never-evaluated', rolloutPercent: 10, actorId: 'u1' });
    const stale = await flags.staleFlags(30);
    expect(stale.some((f) => f.key === 'never-evaluated')).toBe(true);
  });

  it('rejects duplicate flag keys', async () => {
    await flags.create({ key: 'dup-key', rolloutPercent: 0, actorId: 'u1' });
    await expect(flags.create({ key: 'dup-key', rolloutPercent: 0, actorId: 'u1' })).rejects.toThrow(
      /already exists/,
    );
  });
});

describe('DORA metrics projection (F6)', () => {
  it('projects deployment frequency and change failure rate from events', async () => {
    const store = new InMemoryEventStore();
    const traceId = newChangeTraceId();
    const workflowId = newId('wf');
    const events: DomainEvent[] = [
      makeEvent({
        traceId,
        type: EVENT.runStarted,
        aggregateType: AGGREGATE.workflowRun,
        aggregateId: newId('run'),
        actor: { type: 'system', id: 'engine' },
        payload: { workflowId },
      }),
      makeEvent({
        traceId,
        type: EVENT.runCompleted,
        aggregateType: AGGREGATE.workflowRun,
        aggregateId: newId('run'),
        actor: { type: 'system', id: 'engine' },
        payload: { status: 'succeeded' },
      }),
      makeEvent({
        traceId,
        type: EVENT.runCompleted,
        aggregateType: AGGREGATE.workflowRun,
        aggregateId: newId('run'),
        actor: { type: 'system', id: 'engine' },
        payload: { status: 'failed' },
      }),
    ];
    for (const event of events) {
      await store.append(event);
    }

    const metrics = new MetricsService(store);
    const dora = await metrics.dora(30);
    expect(dora.deployments).toBe(1);
    expect(dora.changeFailureRate).toBe(0.5);
  });

  it('records an ai.completed event with run traceId (E4/E5 seam)', async () => {
    const store = new InMemoryEventStore();
    const traceId = newChangeTraceId();
    await store.append(
      makeEvent({
        traceId,
        type: EVENT.aiCompleted,
        aggregateType: AGGREGATE.ai,
        aggregateId: newId('ai'),
        actor: { type: 'agent', id: 'ai-copilot' },
        payload: { kind: 'diagnosis', summary: 'ok' },
      }),
    );
    const events = await store.listByTrace(traceId);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe(EVENT.aiCompleted);
  });
});
