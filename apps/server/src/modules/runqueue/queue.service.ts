import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Queue, QueueEvents, Worker } from 'bullmq';
import { RunExecutor } from './run-executor.service';

const QUEUE_NAME = 'jack-run-queue';

@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  readonly enabled: boolean;
  private readonly connection?: { host: string; port: number; maxRetriesPerRequest: null };
  private producer?: Queue;
  private worker?: Worker;
  private queueEvents?: QueueEvents;

  constructor(private readonly executor: RunExecutor) {
    const redisUrl = process.env.REDIS_URL ?? process.env.JACK_REDIS_URL;
    const mode = process.env.JACK_QUEUE_MODE ?? 'auto';
    this.enabled = Boolean(redisUrl) && mode !== 'memory';
    if (!redisUrl) {
      return;
    }
    const url = new URL(redisUrl);
    this.connection = {
      host: url.hostname,
      port: Number(url.port) || 6379,
      maxRetriesPerRequest: null,
    };
  }

  async onModuleInit(): Promise<void> {
    if (!this.enabled || !this.connection) {
      this.logger.log('queue mode: memory (set REDIS_URL to enable BullMQ distributed runs)');
      return;
    }
    this.producer = new Queue(QUEUE_NAME, { connection: this.connection });
    this.queueEvents = new QueueEvents(QUEUE_NAME, { connection: this.connection });
    this.worker = new Worker(
      QUEUE_NAME,
      async (job) => this.processRun(job.data.runId as string),
      { connection: this.connection, concurrency: Number(process.env.JACK_QUEUE_CONCURRENCY ?? 4) },
    );
    await this.worker.waitUntilReady();
    this.logger.log('BullMQ distributed run queue active');
  }

  async enqueueRun(runId: string): Promise<void> {
    if (!this.producer) {
      throw new Error('queue not enabled');
    }
    await this.producer.add('run', { runId }, { attempts: 1 });
  }

  waitForCompletion(runId: string): Promise<unknown> {
    if (!this.producer || !this.queueEvents) {
      return Promise.resolve(null);
    }
    return this.waitForJobAndFinish(runId);
  }

  private async waitForJobAndFinish(runId: string): Promise<unknown> {
    const jobs = await this.producer?.getJobs(['waiting', 'active', 'delayed']);
    const target = jobs?.find((j) => j.data.runId === runId);
    if (!target || !this.queueEvents) {
      return null;
    }
    return target.waitUntilFinished(this.queueEvents);
  }

  private async processRun(runId: string): Promise<unknown> {
    const spec = await this.executor.loadSpec(runId);
    if (!spec) {
      throw new Error(`run ${runId} spec not found`);
    }
    return this.executor.executeDag({
      runId,
      traceId: spec.traceId,
      workflowName: spec.workflowName,
      jobs: spec.jobs,
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.producer?.close();
    await this.queueEvents?.close();
  }
}
