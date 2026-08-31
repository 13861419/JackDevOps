import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { TestsService } from './tests.service';
import { ZodValidationPipe } from '../../shared/zod.pipe';

const createSuiteDto = z.object({
  name: z.string().min(1).max(200),
  serviceId: z.string().min(1),
  command: z.string().max(500).optional(),
  tags: z.array(z.string().max(64)).max(20).optional(),
  actorId: z.string().min(1).default('web'),
});

const recordRunDto = z.object({
  passed: z.number().int().min(0),
  failed: z.number().int().min(0),
  durationMs: z.number().int().min(0).default(0),
  actorId: z.string().min(1).default('web'),
});

const selectDto = z.object({
  serviceId: z.string().min(1),
  changedPaths: z.array(z.string()).max(200).default([]),
});

type CreateSuiteDto = z.infer<typeof createSuiteDto>;
type RecordRunDto = z.infer<typeof recordRunDto>;
type SelectDto = z.infer<typeof selectDto>;

@Controller('test-suites')
export class TestsController {
  constructor(private readonly tests: TestsService) {}

  @Post()
  create(@Body(new ZodValidationPipe(createSuiteDto)) dto: CreateSuiteDto) {
    return this.tests.create(dto);
  }

  @Get()
  list(@Query('serviceId') serviceId?: string) {
    if (serviceId) {
      return this.tests.list().then((all) => all.filter((s) => s.serviceId === serviceId));
    }
    return this.tests.list();
  }

  @Post('select')
  select(@Body(new ZodValidationPipe(selectDto)) dto: SelectDto) {
    return this.tests.select(dto);
  }

  @Post(':id/runs')
  record(@Param('id') id: string, @Body(new ZodValidationPipe(recordRunDto)) dto: RecordRunDto) {
    return this.tests.record({ suiteId: id, ...dto });
  }

  @Get(':id/history')
  history(@Param('id') id: string) {
    return this.tests.history(id);
  }
}
