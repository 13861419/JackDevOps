import { Module } from '@nestjs/common';
import { EventsModule } from './events';
import { WorkItemsModule } from './modules/workitems/workitems.module';
import { CatalogModule } from './modules/catalog/catalog.module';

@Module({
  imports: [EventsModule, WorkItemsModule, CatalogModule],
})
export class AppModule {}
