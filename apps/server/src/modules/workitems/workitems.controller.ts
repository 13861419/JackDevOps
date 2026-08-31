import { Body, Controller, Get, NotFoundException, Param, Post } from '@nestjs/common';
import { WorkItemsService } from './workitems.service';
import { changeStatusDto, createWorkItemDto, type ChangeStatusDto, type CreateWorkItemDto } from './workitems.dto';
import { ZodValidationPipe } from '../../shared/zod.pipe';
import type { DomainEvent } from '../../events';

@Controller('work-items')
export class WorkItemsController {
  constructor(private readonly workItems: WorkItemsService) {}

  @Post()
  create(@Body(new ZodValidationPipe(createWorkItemDto)) dto: CreateWorkItemDto) {
    return this.workItems.create(dto);
  }

  @Get()
  list() {
    return this.workItems.list();
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    const item = await this.workItems.get(id);
    if (!item) {
      throw new NotFoundException(`work item ${id} not found`);
    }
    return item;
  }

  @Post(':id/status')
  changeStatus(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(changeStatusDto)) dto: ChangeStatusDto,
  ) {
    return this.workItems.changeStatus(id, dto.to, dto.actorId);
  }

  @Get(':id/trace')
  trace(@Param('id') id: string): Promise<DomainEvent[]> {
    return this.workItems.trace(id);
  }
}
