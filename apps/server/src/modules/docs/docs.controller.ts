import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { z } from 'zod';
import { DocsService } from './docs.service';
import { ZodValidationPipe } from '../../shared/zod.pipe';

const upsertDto = z.object({
  content: z.string().min(1).max(50_000),
  actorId: z.string().min(1).default('web'),
});

type UpsertDto = z.infer<typeof upsertDto>;

@Controller('docs')
export class DocsController {
  constructor(private readonly docs: DocsService) {}

  @Get()
  list() {
    return this.docs.list();
  }

  @Get(':slug')
  get(@Param('slug') slug: string) {
    return this.docs.get(slug);
  }

  @Put(':slug')
  upsert(@Param('slug') slug: string, @Body(new ZodValidationPipe(upsertDto)) dto: UpsertDto) {
    return this.docs.upsert(slug, dto);
  }
}
