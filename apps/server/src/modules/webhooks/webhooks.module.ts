import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { WorkflowsModule } from '../workflows/workflows.module';
import { GitWebhookController } from './git-webhook.controller';
import { GitWebhookService } from './git-webhook.service';

@Module({
  imports: [CatalogModule, WorkflowsModule],
  controllers: [GitWebhookController],
  providers: [GitWebhookService],
})
export class WebhooksModule {}
