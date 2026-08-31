import { Module } from '@nestjs/common';
import { EventsModule } from './events';
import { WorkItemsModule } from './modules/workitems/workitems.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { WorkflowsModule } from './modules/workflows/workflows.module';
import { TemplatesModule } from './modules/templates/templates.module';

@Module({
  imports: [EventsModule, WorkItemsModule, CatalogModule, WorkflowsModule, TemplatesModule],
})
export class AppModule {}
