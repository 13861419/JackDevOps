import { Inject, Injectable } from '@nestjs/common';
import { EVENT, type DomainEvent } from '../../events';
import { EVENT_STORE, type EventStore } from '../../events';

export interface DoraMetrics {
  windowDays: number;
  deployments: number;
  deploymentFrequencyPerDay: number;
  changeFailureRate: number | null;
  mttrMinutes: number | null;
  leadTimeMinutes: number | null;
}

export interface LeadTimeItem {
  workItemId: string;
  title: string;
  serviceId?: string;
  createdAt: string;
  promotedAt: string;
  leadTimeMinutes: number;
}

export interface LeadTimeReport {
  windowDays: number;
  items: LeadTimeItem[];
  medianLeadTimeMinutes: number | null;
}

@Injectable()
export class MetricsService {
  constructor(@Inject(EVENT_STORE) private readonly eventStore: EventStore) {}

  async leadTime(days: number): Promise<LeadTimeReport> {
    const windowStart = Date.now() - days * 24 * 3600 * 1000;
    const started = await this.eventStore.listByType(EVENT.runStarted);
    const registered = await this.eventStore.listByType(EVENT.releaseRegistered);
    const promoted = await this.eventStore.listByType(EVENT.releasePromoted);
    const created = await this.eventStore.listByType(EVENT.workItemCreated);

    const registeredByAggregate = new Map<string, string>();
    for (const event of registered) {
      registeredByAggregate.set(event.aggregateId, event.payload.runId as string);
    }
    const promotedByRelease = new Map<string, string>();
    for (const event of promoted) {
      promotedByRelease.set(event.aggregateId, event.occurredAt);
    }
    const runMetaById = new Map<string, { workItemIds?: string[] }>();
    for (const event of started) {
      const meta = event.payload.meta as { workItemIds?: string[] } | null;
      runMetaById.set(event.aggregateId, { workItemIds: (meta?.workItemIds as string[]) ?? undefined });
    }

    const items: LeadTimeItem[] = [];
    for (const item of created) {
      if (Date.parse(item.occurredAt) < windowStart) {
        continue;
      }
      let latestPromotedAt: string | null = null;
      for (const releaseEvent of registered) {
        if (registeredByAggregate.get(releaseEvent.aggregateId) === undefined) {
          continue;
        }
        const runId = registeredByAggregate.get(releaseEvent.aggregateId) as string;
        const meta = runMetaById.get(runId);
        if (meta?.workItemIds?.includes(item.aggregateId) !== true) {
          continue;
        }
        const promotedAt = promotedByRelease.get(releaseEvent.aggregateId);
        if (promotedAt && (!latestPromotedAt || promotedAt > latestPromotedAt)) {
          latestPromotedAt = promotedAt;
        }
      }
      if (latestPromotedAt) {
        items.push({
          workItemId: item.aggregateId,
          title: item.payload.title as string,
          serviceId: (item.payload.serviceId as string | null) ?? undefined,
          createdAt: item.occurredAt,
          promotedAt: latestPromotedAt,
          leadTimeMinutes:
            Math.round(((Date.parse(latestPromotedAt) - Date.parse(item.occurredAt)) / 60000) * 10) / 10,
        });
      }
    }
    const values = items.map((i) => i.leadTimeMinutes).sort((a, b) => a - b);
    const median = values.length === 0 ? null : values[Math.floor(values.length / 2)];
    return { windowDays: days, items, medianLeadTimeMinutes: median };
  }

  async costs(days: number): Promise<{
    windowDays: number;
    rate: { perRunMinute: number; perPreviewHour: number };
    services: {
      serviceId: string;
      runCount: number;
      runMinutes: number;
      previewCount: number;
      previewHours: number;
      costUsd: number;
    }[];
    totalCostUsd: number;
  }> {
    const windowStart = Date.now() - days * 24 * 3600 * 1000;
    const perRunMinute = Number(process.env.JACK_COST_PER_RUN_MINUTE ?? '0.05');
    const perPreviewHour = Number(process.env.JACK_COST_PER_PREVIEW_HOUR ?? '0.5');

    const completedByRun = new Map<string, DomainEvent>();
    for (const event of await this.eventStore.listByType(EVENT.runCompleted)) {
      completedByRun.set(event.aggregateId, event);
    }
    const serviceByWorkflow = new Map<string, string>();
    for (const event of await this.eventStore.listByType(EVENT.workflowCreated)) {
      const serviceId = event.payload.serviceId as string | null;
      if (serviceId) {
        serviceByWorkflow.set(event.aggregateId, serviceId);
      }
    }
    const slugById = new Map<string, string>();
    for (const event of await this.eventStore.listByType(EVENT.serviceRegistered)) {
      slugById.set(event.aggregateId, event.payload.slug as string);
    }

    const runMinutesByService = new Map<string, number>();
    const runCountByService = new Map<string, number>();
    for (const started of await this.eventStore.listByType(EVENT.runStarted)) {
      const completed = completedByRun.get(started.aggregateId);
      if (!completed || Date.parse(completed.occurredAt) < windowStart) {
        continue;
      }
      const serviceId = serviceByWorkflow.get(started.payload.workflowId as string);
      if (!serviceId) {
        continue;
      }
      const minutes = (Date.parse(completed.occurredAt) - Date.parse(started.occurredAt)) / 60000;
      runMinutesByService.set(serviceId, (runMinutesByService.get(serviceId) ?? 0) + minutes);
      runCountByService.set(serviceId, (runCountByService.get(serviceId) ?? 0) + 1);
    }

    const previewHoursByService = new Map<string, number>();
    const previewCountByService = new Map<string, number>();
    const destroyedByEnv = new Map<string, string>();
    for (const event of await this.eventStore.listByType(EVENT.previewEnvDestroyed)) {
      destroyedByEnv.set(event.aggregateId, event.occurredAt);
    }
    for (const requested of await this.eventStore.listByType(EVENT.previewEnvRequested)) {
      const serviceId = (requested.payload.serviceId as string) ?? '';
      if (!serviceId) {
        continue;
      }
      const endedAt = destroyedByEnv.get(requested.aggregateId);
      const hours = Math.max(0, ((endedAt ? Date.parse(endedAt) : Date.now()) - Date.parse(requested.occurredAt)) / 3600000);
      if (hours <= 0) {
        continue;
      }
      previewHoursByService.set(serviceId, (previewHoursByService.get(serviceId) ?? 0) + hours);
      previewCountByService.set(serviceId, (previewCountByService.get(serviceId) ?? 0) + 1);
    }

    const allServiceIds = new Set<string>([
      ...slugById.keys(),
      ...runMinutesByService.keys(),
      ...previewHoursByService.keys(),
    ]);
    const services = [...allServiceIds]
      .map((id) => {
        const slug = slugById.get(id) ?? id;
        const runMinutes = runMinutesByService.get(id) ?? 0;
        const previewHours = previewHoursByService.get(id) ?? 0;
        return {
          serviceId: slug,
          runCount: runCountByService.get(id) ?? 0,
          runMinutes: Math.round(runMinutes * 10) / 10,
          previewCount: previewCountByService.get(id) ?? 0,
          previewHours: Math.round(previewHours * 10) / 10,
          costUsd: Math.round((runMinutes * perRunMinute + previewHours * perPreviewHour) * 100) / 100,
        };
      })
      .sort((a, b) => b.costUsd - a.costUsd);
    const totalCostUsd = Math.round(services.reduce((sum, s) => sum + s.costUsd, 0) * 100) / 100;
    return {
      windowDays: days,
      rate: { perRunMinute, perPreviewHour },
      services,
      totalCostUsd,
    };
  }

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

    const registered = await this.eventStore.listByType(EVENT.releaseRegistered);
    const promoted = (await this.eventStore.listByType(EVENT.releasePromoted)).filter(
      (e) => Date.parse(e.occurredAt) >= windowStart,
    );
    const runStartedByRun = new Map<string, string>();
    for (const event of started) {
      runStartedByRun.set(event.aggregateId, event.occurredAt);
    }
    const registeredByAggregate = new Map<string, string>();
    for (const event of registered) {
      registeredByAggregate.set(event.aggregateId, event.payload.runId as string);
    }
    const leadTimes: number[] = [];
    for (const promoteEvent of promoted) {
      const runId = registeredByAggregate.get(promoteEvent.aggregateId);
      const runStartedAt = runId ? runStartedByRun.get(runId) : undefined;
      if (runStartedAt) {
        leadTimes.push((Date.parse(promoteEvent.occurredAt) - Date.parse(runStartedAt)) / 60000);
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
          : Math.round((mttrValues.reduce((a, b) => a + b, 0) / mttrValues.length) * 10) / 10,
      leadTimeMinutes:
        leadTimes.length === 0
          ? null
          : Math.round((leadTimes.reduce((a, b) => a + b, 0) / leadTimes.length) * 10) / 10,
    };
  }
}
