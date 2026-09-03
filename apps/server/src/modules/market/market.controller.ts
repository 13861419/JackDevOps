import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { MarketService } from './market.service';
import { ZodValidationPipe } from '../../shared/zod.pipe';

const actorDto = z.object({
  actorId: z.string().min(1).max(64).default('web'),
});

@Controller('market')
export class MarketController {
  constructor(private readonly market: MarketService) {}

  @Get()
  list() {
    return { plugins: this.market.list(), installed: this.market.listInstalled() };
  }

  @Post(':slug/install')
  install(@Param('slug') slug: string, @Body(new ZodValidationPipe(actorDto)) dto: { actorId: string }) {
    return this.market.install(slug, dto.actorId);
  }

  @Delete(':slug')
  uninstall(@Param('slug') slug: string, @Body(new ZodValidationPipe(actorDto)) dto: { actorId: string }) {
    return this.market.uninstall(slug, dto.actorId);
  }
}
