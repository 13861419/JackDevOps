import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { WorkflowsModule } from '../workflows/workflows.module';
import { WorkItemsModule } from '../workitems/workitems.module';
import { ReleasesModule } from '../releases/releases.module';
import { FlagsModule } from '../flags/flags.module';
import { TestsModule } from '../tests/tests.module';
import { DemoController } from './demo.controller';
import { DemoService } from './demo.service';

@Module({
  imports: [CatalogModule, WorkflowsModule, WorkItemsModule, ReleasesModule, FlagsModule, TestsModule],
  controllers: [DemoController],
  providers: [DemoService],
})
export class DemoModule {}
