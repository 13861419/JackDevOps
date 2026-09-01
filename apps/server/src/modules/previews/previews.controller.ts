import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { PreviewsService } from './previews.service';
import { ZodValidationPipe } from '../../shared/zod.pipe';

const requestDto = z.object({
  serviceId: z.string().min(1),
  prNumber: z.number().int().min(1),
  prTitle: z.string().max(300).optional(),
  branch: z.string().max(200).optional(),
  commit: z.string().max(100).optional(),
  ttlHours: z.number().int().min(1).max(720).optional(),
  actorId: z.string().min(1).default('web'),
});

const readyDto = z.object({
  url: z.string().max(500).optional(),
});

const deployDto = z.object({
  image: z.string().max(200).optional(),
});

type RequestDto = z.infer<typeof requestDto>;
type ReadyDto = z.infer<typeof readyDto>;
type DeployDto = z.infer<typeof deployDto>;

@Controller('previews')
export class PreviewsController {
  constructor(private readonly previews: PreviewsService) {}

  @Post()
  request(@Body(new ZodValidationPipe(requestDto)) dto: RequestDto) {
    return this.previews.request(dto);
  }

  @Get()
  list(@Query('serviceId') serviceId?: string) {
    return this.previews.list(serviceId);
  }

  @Get('expired')
  expired() {
    return this.previews.expired();
  }

  @Post(':id/ready')
  ready(@Param('id') id: string, @Body(new ZodValidationPipe(readyDto)) dto: ReadyDto) {
    return this.previews.markReady(id, dto.url);
  }

  @Post(':id/deploy')
  async deploy(@Param('id') id: string, @Body(new ZodValidationPipe(deployDto)) dto: DeployDto) {
    return this.previews.deploy(id, dto);
  }

  @Delete(':id')
  destroy(@Param('id') id: string) {
    return this.previews.destroy(id, 'api');
  }
}
