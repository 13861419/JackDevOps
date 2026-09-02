import { Module } from '@nestjs/common';
import { WorkflowsController, RunsController } from './workflows.controller';
import { WorkflowsService } from './workflows.service';
import { WorkflowRunsService } from './workflow-runs.service';

@Module({
  controllers: [WorkflowsController, RunsController],
  providers: [WorkflowsService, WorkflowRunsService],
  exports: [WorkflowsService, WorkflowRunsService],
})
export class WorkflowsModule {}
