import { Body, Controller, Post } from '@nestjs/common';
import { z } from 'zod';
import { DemoService } from './demo.service';
import { ZodValidationPipe } from '../../shared/zod.pipe';

const seedDto = z.object({
  force: z.boolean().default(false),
  actorId: z.string().min(1).default('web'),
});

type SeedDto = z.infer<typeof seedDto>;

@Controller('demo')
export class DemoController {
  constructor(private readonly demo: DemoService) {}

  @Post('seed')
  seed(@Body(new ZodValidationPipe(seedDto)) dto: SeedDto) {
    return this.demo.seed(dto.actorId, dto.force);
  }
}
