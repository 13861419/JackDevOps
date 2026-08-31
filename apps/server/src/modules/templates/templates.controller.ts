import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { TemplatesService } from './templates.service';
import { instantiateDto, type InstantiateDto } from './templates.dto';
import { ZodValidationPipe } from '../../shared/zod.pipe';

@Controller('templates')
export class TemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  @Get()
  list() {
    return this.templates.list();
  }

  @Post(':slug/instantiate')
  instantiate(@Param('slug') slug: string, @Body(new ZodValidationPipe(instantiateDto)) dto: InstantiateDto) {
    return this.templates.instantiate(slug, dto);
  }
}
