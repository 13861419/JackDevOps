import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AGGREGATE, EVENT, makeEvent, newId } from '../../events';
import { EVENT_STORE, type EventStore, type DomainEvent } from '../../events';
import { CatalogService } from '../catalog/catalog.service';
import { WorkflowsService } from '../workflows/workflows.service';
import { WorkflowRunsService } from '../workflows/workflow-runs.service';

export interface DriftReport {
  slug: string;
  desired: { version?: string; image?: string };
  actual: { image?: string };
  drifts: { field: string; desired: string; actual: string }[];
  hasDrift: boolean;
  checkedAt: string;
}

@Injectable()
export class DriftService {
  constructor(
    @Inject(EVENT_STORE) private readonly eventStore: EventStore,
    private readonly catalog: CatalogService,
    private readonly workflows: WorkflowsService,
    private readonly runs: WorkflowRunsService,
  ) {}

  async check(slug: string, actual: { image?: string }, actorId = 'api'): Promise<DriftReport> {
    const service = await this.resolveService(slug);
    if (!service) {
      throw new NotFoundException(`service ${slug} not found`);
    }
    const desired = await this.desiredFor(service.id);
    const drifts: DriftReport['drifts'] = [];
    if (desired.image && actual.image && desired.image !== actual.image) {
      drifts.push({ field: 'image', desired: desired.image, actual: actual.image });
    } else if (!actual.image) {
      drifts.push({ field: 'image', desired: desired.image ?? '(none)', actual: '(not reported)' });
    }

    const report: DriftReport = {
      slug: service.slug,
      desired,
      actual,
      drifts,
      hasDrift: drifts.length > 0,
      checkedAt: new Date().toISOString(),
    };
    await this.eventStore.append(
      makeEvent({
        traceId: service.traceId,
        type: EVENT.driftDetected,
        aggregateType: AGGREGATE.service,
        aggregateId: service.slug,
        actor: { type: 'system', id: actorId },
        payload: {
          hasDrift: report.hasDrift,
          drifts: report.drifts,
          desired,
          actual,
        },
      }),
    );
    return report;
  }

  async reconcile(slug: string, actorId = 'web'): Promise<{ slug: string; reconciled: boolean }> {
    const service = await this.resolveService(slug);
    if (!service) {
      throw new NotFoundException(`service ${slug} not found`);
    }
    await this.eventStore.append(
      makeEvent({
        traceId: service.traceId,
        type: EVENT.driftReconciled,
        aggregateType: AGGREGATE.service,
        aggregateId: service.slug,
        actor: { type: 'user', id: actorId },
        payload: { note: 'operator confirmed actual state matches desired' },
      }),
    );
    return { slug: service.slug, reconciled: true };
  }

  async latest(slug: string): Promise<DriftReport | null> {
    const service = await this.resolveService(slug);
    if (!service) {
      throw new NotFoundException(`service ${slug} not found`);
    }
    const events = await this.eventStore.listByAggregate(AGGREGATE.service, service.slug);
    const detected = [...events].reverse().find((e) => e.type === EVENT.driftDetected);
    if (!detected) {
      return null;
    }
    return {
      slug: service.slug,
      desired: (detected.payload.desired as { version?: string; image?: string }) ?? {},
      actual: (detected.payload.actual as { image?: string }) ?? {},
      drifts: (detected.payload.drifts as DriftReport['drifts']) ?? [],
      hasDrift: Boolean(detected.payload.hasDrift),
      checkedAt: detected.occurredAt,
    };
  }

  private async desiredFor(serviceId: string): Promise<{ version?: string; image?: string }> {
    const registered = await this.eventStore.listByType(EVENT.releaseRegistered);
    const allWfs = await this.workflows.list();
    const wfByService = new Set(allWfs.filter((w) => w.serviceId === serviceId).map((w) => w.id));
    let latestRelease: { version: string; artifacts: string[]; at: string } | null = null;
    for (const event of [...await this.eventStore.listByType(EVENT.releaseRegistered)].reverse()) {
      const runId = event.payload.runId as string;
      const run = this.runs.get(runId);
      if (!run || !wfByService.has(run.workflowId)) {
        continue;
      }
      latestRelease = {
        version: event.payload.version as string,
        artifacts: ((event.payload.artifacts as string[]) ?? []),
        at: event.occurredAt,
      };
      break;
    }
    if (!latestRelease) {
      return {};
    }
    return { version: latestRelease.version, image: latestRelease.artifacts[0] };
  }

  private async resolveService(idOrSlug: string) {
    const bySlug = await this.catalog.get(idOrSlug);
    if (bySlug) {
      return bySlug;
    }
    const all = await this.catalog.list();
    return all.find((s) => s.id === idOrSlug) ?? null;
  }
}

export type { DomainEvent };
