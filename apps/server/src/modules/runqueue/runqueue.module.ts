import { Global, Module } from '@nestjs/common';
import { JobRegistry } from '../workflows/job-registry';
import { NotifyModule } from '../notify/notify.module';
import { RunExecutor } from './run-executor.service';
import { QueueService } from './queue.service';

@Global()
@Module({
  imports: [NotifyModule],
  providers: [JobRegistry, RunExecutor, QueueService],
  exports: [JobRegistry, RunExecutor, QueueService],
})
export class RunQueueModule {}
