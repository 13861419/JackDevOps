import { Module } from '@nestjs/common';
import { EventsModule } from './events';
import { WorkItemsModule } from './modules/workitems/workitems.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { WorkflowsModule } from './modules/workflows/workflows.module';
import { TemplatesModule } from './modules/templates/templates.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { NotifyModule } from './modules/notify/notify.module';
import { OnboardingModule } from './modules/onboarding/onboarding.module';

@Module({
  imports: [
    EventsModule,
    NotifyModule,
    WorkItemsModule,
    CatalogModule,
    WorkflowsModule,
    TemplatesModule,
    WebhooksModule,
    OnboardingModule,
  ],
})
export class AppModule {}
