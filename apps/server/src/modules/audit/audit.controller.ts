import { Controller, Get, Query, Req } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { EVENT_STORE, type EventStore, type DomainEvent, ListEventsOptions } from '../../events';
import type { AuthUser } from '../auth/auth.guard';

interface AuditRequest {
  user?: AuthUser;
}

@Controller('audit')
export class AuditController {
  constructor(@Inject(EVENT_STORE) private readonly eventStore: EventStore) {}

  @Get()
  async list(
    @Req() req: AuditRequest,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('traceId') traceId?: string,
    @Query('tenantId') tenantId?: string,
  ): Promise<{ total: number; events: DomainEvent[] }> {
    const limitNum = Math.min(Number(limit) || 100, 500);
    const user = req?.user;
    // Non-admin users are pinned to their own tenant; admins may query any tenant.
    const opts: ListEventsOptions | undefined =
      user?.role !== 'admin' && user?.tenantId
        ? { tenantId: user.tenantId }
        : tenantId
          ? { tenantId }
          : undefined;
    if (traceId) {
      return { total: 0, events: await this.eventStore.listByTrace(traceId, opts) };
    }
    return { total: 0, events: await this.eventStore.listAll(limitNum, Number(offset) || 0, opts) };
  }
}
