import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { DriftService } from './drift.service';
import { ZodValidationPipe } from '../../shared/zod.pipe';

const checkDto = z.object({
  image: z.string().max(300).optional(),
  actorId: z.string().min(1).default('web'),
});

type CheckDto = z.infer<typeof checkDto>;

@Controller('drift')
export class DriftController {
  constructor(private readonly drift: DriftService) {}

  @Post(':slug/check')
  check(@Param('slug') slug: string, @Body(new ZodValidationPipe(checkDto)) dto: CheckDto) {
    return this.drift.check(slug, { image: dto.image }, dto.actorId);
  }

  @Post(':slug/reconcile')
  reconcile(@Param('slug') slug: string, @Body(new ZodValidationPipe(checkDto)) dto: CheckDto) {
    return this.drift.reconcile(slug, dto.actorId);
  }

  @Get(':slug')
  latest(@Param('slug') slug: string) {
    return this.drift.latest(slug);
  }
}
