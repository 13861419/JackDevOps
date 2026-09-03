import { describe, expect, it } from 'vitest';
import { InMemoryEventStore, makeEvent, AGGREGATE, EVENT, runWithTenant, currentTenantId } from '../src/events';
import { TenantInterceptor } from '../src/modules/auth/tenant.interceptor';
import { AuditController } from '../src/modules/audit/audit.controller';

describe('tenant propagation (M24 Phase 2)', () => {
  it('makeEvent auto-attaches tenantId inside runWithTenant scope', () => {
    const event = runWithTenant('acme', () =>
      makeEvent({
        type: EVENT.workItemCreated,
        aggregateType: AGGREGATE.workItem,
        aggregateId: 'wi_x',
        actor: { type: 'user', id: 'u1' },
        payload: {},
      }),
    );
    expect(event.tenantId).toBe('acme');
    expect(currentTenantId()).toBeUndefined();
  });

  it('explicit tenantId on makeEvent wins over ambient scope', () => {
    const event = runWithTenant('ambient', () =>
      makeEvent({
        tenantId: 'explicit',
        type: EVENT.workItemCreated,
        aggregateType: AGGREGATE.workItem,
        aggregateId: 'wi_x',
        actor: { type: 'user', id: 'u1' },
        payload: {},
      }),
    );
    expect(event.tenantId).toBe('explicit');
  });

  it('TenantInterceptor scopes the handler execution to the user tenant', () => {
    const interceptor = new TenantInterceptor();
    let captured: string | undefined;
    const http = {
      switchToHttp: () => ({
        getRequest: () => ({ user: { id: 'u9', role: 'dev', tenantId: 'acme' } }),
      }),
    } as unknown as ExecutionContextLike;
    interceptor.intercept(http, {
      handle: () => {
        captured = currentTenantId();
        return 'value' as never;
      },
    } as never);
    expect(captured).toBe('acme');
  });

  it('audit endpoint pins non-admin users to their own tenant', async () => {
    const store = new InMemoryEventStore();
    const acmeEvent = runWithTenant('acme', () =>
      makeEvent({
        type: EVENT.workItemCreated,
        aggregateType: AGGREGATE.workItem,
        aggregateId: 'wi_a',
        actor: { type: 'user', id: 'u1' },
        payload: {},
      }),
    );
    await store.append(acmeEvent);

    const controller = new AuditController(store);
    const pinned = await controller.list({ user: { id: 'u1', role: 'dev', tenantId: 'acme' } });
    expect(pinned.events.length).toBe(1);
    expect(pinned.events[0].tenantId).toBe('acme');

    const admin = await controller.list({ user: { id: 'a', role: 'admin', tenantId: 'default' } });
    expect(admin.events.length).toBe(1);

    const scoped = await controller.list(
      { user: { id: 'a', role: 'admin' } },
      '100',
      '0',
      undefined,
      'acme',
    );
    expect(scoped.events.length).toBe(1);
  });
});

interface ExecutionContextLike {
  switchToHttp(): unknown;
}
