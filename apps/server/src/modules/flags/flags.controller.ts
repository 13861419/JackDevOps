import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { FlagsService } from './flags.service';
import { ZodValidationPipe } from '../../shared/zod.pipe';

const createFlagDto = z.object({
  key: z
    .string()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*([.][a-z0-9]+)*$/, 'key must be dot/kebab case'),
  description: z.string().max(500).optional(),
  rolloutPercent: z.number().int().min(0).max(100).default(0),
  actorId: z.string().min(1).default('web'),
});

const rolloutDto = z.object({
  percent: z.number().int().min(0).max(100),
  actorId: z.string().min(1).default('web'),
});

type CreateFlagDto = z.infer<typeof createFlagDto>;
type RolloutDto = z.infer<typeof rolloutDto>;

@Controller('flags')
export class FlagsController {
  constructor(private readonly flags: FlagsService) {}

  @Post()
  create(@Body(new ZodValidationPipe(createFlagDto)) dto: CreateFlagDto) {
    return this.flags.create(dto);
  }

  @Get()
  list() {
    return this.flags.list();
  }

  @Get('stale')
  stale(@Query('days') days: string) {
    return this.flags.staleFlags(Number(days) || 30);
  }

  @Get(':key/evaluate')
  evaluate(@Param('key') key: string, @Query('userId') userId: string) {
    return this.flags.evaluate(key, userId ?? 'anonymous');
  }

  @Post(':key/rollout')
  setRollout(
    @Param('key') key: string,
    @Body(new ZodValidationPipe(rolloutDto)) dto: RolloutDto,
  ) {
    return this.flags.setRollout(key, dto.percent, dto.actorId);
  }
}
