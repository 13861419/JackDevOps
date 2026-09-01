import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { WorkflowsModule } from '../workflows/workflows.module';
import { DriftController } from './drift.controller';
import { DriftService } from './drift.service';

@Module({
  imports: [CatalogModule, WorkflowsModule],
  controllers: [DriftController],
  providers: [DriftService],
})
export class DriftModule {}
