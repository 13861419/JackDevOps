import { Body, Controller, Get, NotFoundException, Param, Post } from '@nestjs/common';
import { WorkflowsService } from './workflows.service';
import { WorkflowRunsService } from './workflow-runs.service';
import { createWorkflowDto, workflowSpecDto, type CreateWorkflowDto } from './workflows.dto';
import { ZodValidationPipe } from '../../shared/zod.pipe';
import { Roles } from '../auth/auth.guard';

@Controller('workflows')
export class WorkflowsController {
  constructor(
    private readonly workflows: WorkflowsService,
    private readonly runs: WorkflowRunsService,
  ) {}

  @Post()
  @Roles('admin', 'pm', 'dev')
  create(@Body(new ZodValidationPipe(createWorkflowDto)) dto: CreateWorkflowDto) {
    return this.workflows.create(dto);
  }

  @Get()
  list() {
    return this.workflows.list();
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    const wf = await this.workflows.get(id);
    if (!wf) {
      throw new NotFoundException(`workflow ${id} not found`);
    }
    return wf;
  }

  @Post(':id/runs')
  @Roles('admin', 'dev', 'ops')
  async startRun(@Param('id') id: string) {
    return this.runs.startRun(id, 'api');
  }
}

@Controller('runs')
export class RunsController {
  constructor(private readonly runs: WorkflowRunsService) {}

  @Get()
  list() {
    return this.runs.list();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.runs.get(id) ?? null;
  }

  @Get(':id/trace')
  trace(@Param('id') id: string) {
    return this.runs.trace(id);
  }
}
