import { Controller, Get, Query } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { EVENT_STORE, type EventStore, type DomainEvent } from '../../events';

@Controller('audit')
export class AuditController {
  constructor(@Inject(EVENT_STORE) private readonly eventStore: EventStore) {}

  @Get()
  async list(
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('traceId') traceId?: string,
    @Query('tenantId') tenantId?: string,
  ): Promise<{ total: number; events: DomainEvent[] }> {
    const limitNum = Math.min(Number(limit) || 100, 500);
    const opts = tenantId ? { tenantId } : undefined;
    if (traceId) {
      return { total: 0, events: await this.eventStore.listByTrace(traceId, opts) };
    }
    return { total: 0, events: await this.eventStore.listAll(limitNum, Number(offset) || 0, opts) };
  }
}
