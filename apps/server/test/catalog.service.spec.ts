import { describe, expect, it } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { InMemoryEventStore } from '../src/events';
import { CatalogService } from '../src/modules/catalog/catalog.service';

describe('CatalogService (event-sourced, A2)', () => {
  const store = new InMemoryEventStore();
  const service = new CatalogService(store);

  it('registers a service and reads it back by slug', async () => {
    const view = await service.register({
      name: '支付网关',
      slug: 'pay-gateway',
      language: 'go',
      ownerId: 'ops',
    });
    const read = await service.get('pay-gateway');
    expect(read).not.toBeNull();
    expect(read?.id).toBe(view.id);
    expect(read?.traceId.startsWith('chg_')).toBe(true);
  });

  it('rejects duplicate slugs', async () => {
    await service.register({ name: '重复测试', slug: 'dup-svc', ownerId: 'u1' });
    await expect(
      service.register({ name: '重复测试', slug: 'dup-svc', ownerId: 'u1' }),
    ).rejects.toThrow(ConflictException);
  });

  it('lists all registered services from event projection', async () => {
    const all = await service.list();
    expect(all.length).toBeGreaterThanOrEqual(2);
  });
});
