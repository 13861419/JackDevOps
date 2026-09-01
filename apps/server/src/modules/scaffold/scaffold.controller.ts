import { Body, Controller, Get, Post } from '@nestjs/common';
import { z } from 'zod';
import { ScaffoldService } from './scaffold.service';
import { ZodValidationPipe } from '../../shared/zod.pipe';

const scaffoldDto = z.object({
  name: z.string().min(1).max(200),
  slug: z.string().min(1).max(80).regex(/^[a-z0-9-]+$/, 'slug must be kebab-case'),
  language: z.string().min(1).max(40),
  description: z.string().max(500).optional(),
  repoUrl: z.string().max(300).optional(),
  actorId: z.string().min(1).default('web'),
});

type ScaffoldDto = z.infer<typeof scaffoldDto>;

@Controller('scaffold')
export class ScaffoldController {
  constructor(private readonly scaffold: ScaffoldService) {}

  @Post()
  apply(@Body(new ZodValidationPipe(scaffoldDto)) dto: ScaffoldDto) {
    return this.scaffold.apply(dto);
  }

  @Get('golden-path')
  goldenPath() {
    return this.scaffold.goldenPath();
  }
}
