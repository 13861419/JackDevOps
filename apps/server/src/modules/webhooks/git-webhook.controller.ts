import { Body, Controller, Param, Post } from '@nestjs/common';
import { GitWebhookService } from './git-webhook.service';

@Controller('webhooks')
export class GitWebhookController {
  constructor(private readonly webhookService: GitWebhookService) {}

  @Post('git/:slug')
  onPush(@Param('slug') slug: string, @Body() body: unknown) {
    return this.webhookService.handlePush(slug, body as Parameters<GitWebhookService['handlePush']>[1]);
  }
}
