import { Module } from '@nestjs/common';
import { WorkItemsController } from './workitems.controller';
import { WorkItemsService } from './workitems.service';

@Module({
  controllers: [WorkItemsController],
  providers: [WorkItemsService],
})
export class WorkItemsModule {}
