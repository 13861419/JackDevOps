import { Inject, Injectable } from '@nestjs/common';
import { EVENT, type DomainEvent } from '../../events';
import { EVENT_STORE, type EventStore } from '../../events';

export interface DoraMetrics {
  windowDays: number;
  deployments: number;
  deploymentFrequencyPerDay: number;
  changeFailureRate: number | null;
  mttrMinutes: number | null;
  leadTimeMinutes: null;
}

@Injectable()
export class MetricsService {
  constructor(@Inject(EVENT_STORE) private readonly eventStore: EventStore) {}

  async dora(days: number): Promise<DoraMetrics> {
    const windowStart = Date.now() - days * 24 * 3600 * 1000;
    const completed = (await this.eventStore.listByType(EVENT.runCompleted)).filter(
      (e) => Date.parse(e.occurredAt) >= windowStart,
    );
    const started = await this.eventStore.listByType(EVENT.runStarted);

    const succeeded = completed.filter((e) => e.payload.status === 'succeeded');
    const failed = completed.filter((e) => e.payload.status === 'failed');
    const total = succeeded.length + failed.length;

    const workflowByRun = new Map<string, string>();
    for (const event of started) {
      workflowByRun.set(event.aggregateId, event.payload.workflowId as string);
    }

    const mttrValues: number[] = [];
    for (const failure of failed) {
      const workflowId = workflowByRun.get((failure.payload as { runId: string }).runId);
      const recovery = completed.find(
        (e) =>
          e.payload.status === 'succeeded' &&
          workflowByRun.get((e.payload as { runId: string }).runId) === workflowId &&
          Date.parse(e.occurredAt) > Date.parse(failure.occurredAt),
      );
      if (recovery) {
        mttrValues.push((Date.parse(recovery.occurredAt) - Date.parse(failure.occurredAt)) / 60000);
      }
    }

    return {
      windowDays: days,
      deployments: succeeded.length,
      deploymentFrequencyPerDay: Number((succeeded.length / days).toFixed(2)),
      changeFailureRate: total === 0 ? null : Number((failed.length / total).toFixed(3)),
      mttrMinutes:
        mttrValues.length === 0
          ? null
          : Math.round((mttrValues.reduce((a, b) => a + b, 0) / mttrValues.length / 60000) * 10) / 10,
      leadTimeMinutes: null,
    };
  }
}
