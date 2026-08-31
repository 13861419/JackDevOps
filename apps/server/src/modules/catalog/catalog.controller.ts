import { Body, ConflictException, Controller, Get, Param, Post } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { registerServiceDto, type RegisterServiceDto } from './catalog.dto';
import { ZodValidationPipe } from '../../shared/zod.pipe';
import { Roles } from '../auth/auth.guard';
import type { DomainEvent } from '../../events';

@Controller('services')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Post()
  @Roles('admin', 'pm')
  register(@Body(new ZodValidationPipe(registerServiceDto)) dto: RegisterServiceDto) {
    return this.catalog.register(dto);
  }

  @Get()
  list() {
    return this.catalog.list();
  }

  @Get(':slug')
  async get(@Param('slug') slug: string) {
    const service = await this.catalog.get(slug);
    if (!service) {
      throw new ConflictException(`service ${slug} not found`);
    }
    return service;
  }

  @Get(':slug/trace')
  trace(@Param('slug') slug: string): Promise<DomainEvent[]> {
    return this.catalog.trace(slug);
  }
}
