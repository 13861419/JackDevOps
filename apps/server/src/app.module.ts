import { Module } from '@nestjs/common';
import { EventsModule } from './events';
import { AuthModule } from './modules/auth/auth.module';
import { WorkItemsModule } from './modules/workitems/workitems.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { WorkflowsModule } from './modules/workflows/workflows.module';
import { TemplatesModule } from './modules/templates/templates.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { NotifyModule } from './modules/notify/notify.module';
import { OnboardingModule } from './modules/onboarding/onboarding.module';
import { ReviewModule } from './modules/review/review.module';

@Module({
  imports: [
    EventsModule,
    NotifyModule,
    AuthModule,
    WorkItemsModule,
    CatalogModule,
    WorkflowsModule,
    TemplatesModule,
    WebhooksModule,
    OnboardingModule,
    ReviewModule,
  ],
})
export class AppModule {}
