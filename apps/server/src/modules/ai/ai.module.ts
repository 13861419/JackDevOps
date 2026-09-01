import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { LlmService } from './llm.service';
import { WorkflowsModule } from '../workflows/workflows.module';
import { CatalogModule } from '../catalog/catalog.module';

@Module({
  imports: [WorkflowsModule, CatalogModule],
  controllers: [AiController],
  providers: [AiService, LlmService],
  exports: [LlmService],
})
export class AiModule {}
