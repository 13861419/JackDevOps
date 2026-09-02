import { Controller, Get, Query } from '@nestjs/common';
import { MetricsService } from './metrics.service';

@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get('dora')
  dora(@Query('days') days?: string) {
    return this.metrics.dora(Number(days) || 30);
  }

  @Get('lead-time')
  leadTime(@Query('days') days?: string) {
    return this.metrics.leadTime(Number(days) || 30);
  }

  @Get('costs')
  costs(@Query('days') days?: string) {
    return this.metrics.costs(Number(days) || 30);
  }
}
