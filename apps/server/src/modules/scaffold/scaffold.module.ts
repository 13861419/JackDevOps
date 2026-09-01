import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { WorkflowsModule } from '../workflows/workflows.module';
import { ScaffoldController } from './scaffold.controller';
import { ScaffoldService } from './scaffold.service';

@Module({
  imports: [CatalogModule, WorkflowsModule],
  controllers: [ScaffoldController],
  providers: [ScaffoldService],
})
export class ScaffoldModule {}
