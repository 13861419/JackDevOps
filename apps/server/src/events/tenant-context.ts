import { AsyncLocalStorage } from 'node:async_hooks';

const tenantContext = new AsyncLocalStorage<{ tenantId?: string }>();

/**
 * Runs fn within a tenant scope; makeEvent picks up the tenantId automatically
 * for every domain event created inside the callback (F2 Phase 2).
 */
export function runWithTenant<T>(tenantId: string | undefined, fn: () => T): T {
  return tenantContext.run({ tenantId }, fn);
}

export function currentTenantId(): string | undefined {
  return tenantContext.getStore()?.tenantId;
}
