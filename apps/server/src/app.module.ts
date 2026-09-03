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
import { AiModule } from './modules/ai/ai.module';
import { ReleasesModule } from './modules/releases/releases.module';
import { FlagsModule } from './modules/flags/flags.module';
import { MetricsModule } from './modules/metrics/metrics.module';
import { TestsModule } from './modules/tests/tests.module';
import { AuditModule } from './modules/audit/audit.module';
import { PreviewsModule } from './modules/previews/previews.module';
import { ScaffoldModule } from './modules/scaffold/scaffold.module';
import { DocsModule } from './modules/docs/docs.module';
import { DriftModule } from './modules/drift/drift.module';
import { SecretsModule } from './modules/secrets/secrets.module';
import { DemoModule } from './modules/demo/demo.module';
import { RunQueueModule } from './modules/runqueue/runqueue.module';
import { MarketModule } from './modules/market/market.module';

@Module({
  imports: [
    EventsModule,
    NotifyModule,
    AuthModule,
    RunQueueModule,
    WorkItemsModule,
    CatalogModule,
    WorkflowsModule,
    TemplatesModule,
    WebhooksModule,
    OnboardingModule,
    ReviewModule,
    AiModule,
    ReleasesModule,
    FlagsModule,
    MetricsModule,
    TestsModule,
    AuditModule,
    PreviewsModule,
    ScaffoldModule,
    DocsModule,
    DriftModule,
    SecretsModule,
    DemoModule,
    MarketModule,
  ],
})
export class AppModule {}
