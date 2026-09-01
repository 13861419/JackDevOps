import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { ReleasesService } from './releases.service';
import { ZodValidationPipe } from '../../shared/zod.pipe';

const registerReleaseDto = z.object({
  runId: z.string().min(1),
  version: z.string().min(1).max(64),
  artifacts: z.array(z.string().max(200)).max(50).default([]),
  strategy: z.enum(['canary', 'blue-green', 'rolling']).default('canary'),
  actorId: z.string().min(1).default('web'),
});

const rollbackDto = z.object({
  reason: z.string().min(1).max(500),
  actorId: z.string().min(1).default('web'),
});

const approveDto = z.object({
  decision: z.enum(['approved', 'rejected']),
  aiSummary: z.string().max(2000).optional(),
  actorId: z.string().min(1).default('web'),
});

type RegisterReleaseDto = z.infer<typeof registerReleaseDto>;
type RollbackDto = z.infer<typeof rollbackDto>;
type ApproveDto = z.infer<typeof approveDto>;

@Controller('releases')
export class ReleasesController {
  constructor(private readonly releases: ReleasesService) {}

  @Post()
  register(@Body(new ZodValidationPipe(registerReleaseDto)) dto: RegisterReleaseDto) {
    return this.releases.register(dto);
  }

  @Get()
  list() {
    return this.releases.list();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.releases.get(id);
  }

  @Get(':id/notes')
  notes(@Param('id') id: string) {
    return this.releases.notes(id);
  }

  @Get(':id/provenance')
  provenance(@Param('id') id: string) {
    return this.releases.provenance(id);
  }

  @Post(':id/approve')
  approve(@Param('id') id: string, @Body(new ZodValidationPipe(approveDto)) dto: ApproveDto) {
    return this.releases.approve(id, dto);
  }

  @Post(':id/promote')
  promote(@Param('id') id: string) {
    return this.releases.promote(id, 'web');
  }

  @Post(':id/rollback')
  rollback(@Param('id') id: string, @Body(new ZodValidationPipe(rollbackDto)) dto: RollbackDto) {
    return this.releases.rollback(id, dto.reason, dto.actorId);
  }
}
