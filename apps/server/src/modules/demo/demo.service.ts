import { Inject, Injectable } from '@nestjs/common';
import { AGGREGATE, EVENT, makeEvent, newChangeTraceId } from '../../events';
import { EVENT_STORE, type EventStore } from '../../events';
import { CatalogService, type ServiceView } from '../catalog/catalog.service';
import { WorkflowsService } from '../workflows/workflows.service';
import type { WorkflowView } from '../workflows/workflow.types';
import { WorkflowRunsService } from '../workflows/workflow-runs.service';
import { WorkItemsService } from '../workitems/workitems.service';
import { ReleasesService, type ReleaseView } from '../releases/releases.service';
import { FlagsService } from '../flags/flags.service';
import { TestsService } from '../tests/tests.service';

export interface DemoSeedResult {
  seeded: boolean;
  services: string[];
  workItems: number;
  runs: number;
  releases: number;
  flags: number;
  testSuites: number;
  note: string;
}

const DEMO_SERVICES = [
  { name: '订单中心', slug: 'demo-order', language: 'node' },
  { name: '支付网关', slug: 'demo-payment', language: 'node' },
  { name: '推荐引擎', slug: 'demo-recommend', language: 'python' },
];

const DEMO_WORK_ITEMS = [
  { title: '支持优惠券叠加使用', kind: 'requirement' as const, service: 'demo-order' },
  { title: '支付回调幂等性修复', kind: 'bug' as const, service: 'demo-payment' },
  { title: '推荐结果接入特性开关', kind: 'task' as const, service: 'demo-recommend' },
  { title: '订单服务 Lead Time 看板', kind: 'task' as const, service: 'demo-order' },
];

@Injectable()
export class DemoService {
  constructor(
    @Inject(EVENT_STORE) private readonly eventStore: EventStore,
    private readonly catalog: CatalogService,
    private readonly workflows: WorkflowsService,
    private readonly runs: WorkflowRunsService,
    private readonly workItems: WorkItemsService,
    private readonly releases: ReleasesService,
    private readonly flags: FlagsService,
    private readonly tests: TestsService,
  ) {}

  async seed(actorId = 'demo-seed', force = false): Promise<DemoSeedResult> {
    if (!force && (await this.alreadySeeded())) {
      return {
        seeded: false,
        services: [],
        workItems: 0,
        runs: 0,
        releases: 0,
        flags: 0,
        testSuites: 0,
        note: 'demo data already seeded; pass force=true to re-seed',
      };
    }

    const serviceViews: ServiceView[] = [];
    const workflowViews: { slug: string; workflow: WorkflowView }[] = [];
    for (const spec of DEMO_SERVICES) {
      const existing = await this.catalog.get(spec.slug);
      const service = existing ?? (await this.catalog.register({ ...spec, ownerId: actorId }));
      serviceViews.push(service);
      const allWorkflows = await this.workflows.list();
      let workflow = allWorkflows.find((w) => w.serviceId === service.id);
      if (!workflow) {
        workflow = await this.workflows.create({
          name: `${spec.slug}-pipeline`,
          spec: { jobs: [{ id: 'build', type: 'build', config: { command: `echo build ${spec.slug}` } }] },
          serviceId: service.id,
          actorId,
        });
      }
      workflowViews.push({ slug: spec.slug, workflow });
    }

    let workItemCount = 0;
    const itemIdsByService = new Map<string, string[]>();
    for (const item of DEMO_WORK_ITEMS) {
      const service = serviceViews.find((s) => s.slug === item.service);
      const created = await this.workItems.create({
        title: item.title,
        kind: item.kind,
        serviceId: service?.id,
        actorId,
      });
      const ids = itemIdsByService.get(item.service) ?? [];
      ids.push(created.id);
      itemIdsByService.set(item.service, ids);
      workItemCount += 1;
    }

    let runCount = 0;
    let releaseCount = 0;
    const seedTag = Date.now().toString(36);
    const versions = ['v1.0.0', 'v1.1.0', 'v1.2.0'];
    for (const { slug, workflow } of workflowViews) {
      for (let i = 0; i < versions.length; i++) {
        const started = await this.runs.startRun(workflow.id, actorId, {
          commit: `demo${i}`,
          branch: 'main',
          workItemIds: itemIdsByService.get(slug),
        });
        await this.waitForRun(started.id);
        runCount += 1;
        const release = await this.releases.register({
          runId: started.id,
          version: `${slug}-${versions[i]}-${seedTag}`,
          artifacts: [`registry/${slug}:${versions[i]}`],
          strategy: 'rolling',
          actorId,
        });
        await this.releases.promote(release.id, actorId);
        releaseCount += 1;
      }
    }

    if (!(await this.flags.get('demo-new-checkout'))) {
      await this.flags.create({
        key: 'demo-new-checkout',
        description: '新版结算页灰度',
        rolloutPercent: 30,
        actorId,
      });
    }
    if (!(await this.flags.get('demo-ai-summary'))) {
      await this.flags.create({
        key: 'demo-ai-summary',
        description: 'AI 发布摘要',
        rolloutPercent: 100,
        actorId,
      });
    }

    let testSuites = 0;
    const existingSuites = await this.tests.list();
    for (const service of serviceViews) {
      const existingSuite = existingSuites.find((s) => s.serviceId === service.id);
      const suite =
        existingSuite ??
        (await this.tests.create({
          name: `${service.slug}-smoke`,
          serviceId: service.id,
          tags: ['smoke'],
          actorId,
        }));
      await this.tests.record({ suiteId: suite.id, passed: 12, failed: 0, durationMs: 8500, actorId });
      testSuites += 1;
    }

    await this.eventStore.append(
      makeEvent({
        traceId: newChangeTraceId(),
        type: EVENT.scaffoldApplied,
        aggregateType: AGGREGATE.service,
        aggregateId: 'demo-seed',
        actor: { type: 'system', id: actorId },
        payload: { note: `demo seed: ${serviceViews.length} services, ${releaseCount} releases` },
      }),
    );

    return {
      seeded: true,
      services: serviceViews.map((s) => s.slug),
      workItems: workItemCount,
      runs: runCount,
      releases: releaseCount,
      flags: 2,
      testSuites,
      note: 'demo data seeded',
    };
  }

  private async waitForRun(runId: string): Promise<void> {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const run = this.runs.get(runId);
      if (run && run.status !== 'running') {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`timeout waiting for run ${runId}`);
  }

  private async alreadySeeded(): Promise<boolean> {
    const seeded = await this.eventStore.listByType(EVENT.scaffoldApplied);
    return seeded.some((e) => e.aggregateId === 'demo-seed');
  }
}

export type { ReleaseView };
