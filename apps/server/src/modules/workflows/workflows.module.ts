import { Module } from '@nestjs/common';
import { WorkflowsController, RunsController } from './workflows.controller';
import { WorkflowsService } from './workflows.service';
import { WorkflowRunsService } from './workflow-runs.service';
import { JobRegistry } from './job-registry';

@Module({
  controllers: [WorkflowsController, RunsController],
  providers: [WorkflowsService, WorkflowRunsService, JobRegistry],
  exports: [WorkflowsService, WorkflowRunsService],
})
export class WorkflowsModule {}
