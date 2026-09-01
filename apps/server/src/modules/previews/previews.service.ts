import { ConflictException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { AGGREGATE, EVENT, makeEvent, newId, newChangeTraceId } from '../../events';
import { EVENT_STORE, type EventStore } from '../../events';
import { CatalogService } from '../catalog/catalog.service';
import { hasBinary } from '../workflows/job-registry';
import { previewEnvName, previewUrl, type PreviewEnvStatus, type PreviewEnvView } from './preview.types';

const execAsync = promisify(exec);
const DEFAULT_PREVIEW_IMAGE = 'busybox:latest';

export interface DeployResult {
  deployed: boolean;
  id: string;
  url?: string;
  container?: string;
  port?: number;
  image?: string;
  note?: string;
}

interface PreviewEnvAggregate {
  traceId: string;
  serviceId: string;
  prNumber: number;
  prTitle?: string;
  branch?: string;
  commit?: string;
  url?: string;
  status: PreviewEnvStatus;
  createdAt: string;
  destroyedAt?: string;
  ttlHours: number;
  container?: string;
  port?: number;
  image?: string;
}

@Injectable()
export class PreviewsService {
  private readonly dockerProbe: () => Promise<boolean>;

  constructor(
    @Inject(EVENT_STORE) private readonly eventStore: EventStore,
    private readonly catalog: CatalogService,
    @Optional() dockerProbe?: () => Promise<boolean>,
  ) {
    this.dockerProbe = dockerProbe ?? (() => hasBinary('docker'));
  }

  async request(input: {
    serviceId: string;
    prNumber: number;
    prTitle?: string;
    branch?: string;
    commit?: string;
    ttlHours?: number;
    actorId?: string;
  }): Promise<PreviewEnvView> {
    const service = await this.resolveService(input.serviceId);
    if (!service) {
      throw new NotFoundException(`service ${input.serviceId} not found`);
    }
    const serviceSlug = service.slug;
    const existing = await this.findByPr(serviceSlug, input.prNumber);
    if (existing && existing.status !== 'destroyed') {
      throw new ConflictException(
        `preview env for ${input.serviceId}#${input.prNumber} already ${existing.status} (${existing.id})`,
      );
    }

    const id = newId('pve');
    const traceId = newChangeTraceId();
    const ttlHours = input.ttlHours ?? 72;
    await this.eventStore.append(
      makeEvent({
        traceId,
        type: EVENT.previewEnvRequested,
        aggregateType: AGGREGATE.previewEnv,
        aggregateId: id,
        actor: { type: 'system', id: input.actorId ?? 'webhook' },
        payload: {
          serviceId: serviceSlug,
          prNumber: input.prNumber,
          prTitle: input.prTitle ?? null,
          branch: input.branch ?? null,
          commit: input.commit ?? null,
          envName: previewEnvName(input.prNumber),
          url: previewUrl(serviceSlug, input.prNumber),
          ttlHours,
        },
      }),
    );
    await this.eventStore.append(
      makeEvent({
        traceId,
        type: EVENT.previewEnvReady,
        aggregateType: AGGREGATE.previewEnv,
        aggregateId: id,
        actor: { type: 'system', id: input.actorId ?? 'webhook' },
        payload: { url: previewUrl(serviceSlug, input.prNumber) },
      }),
    );
    const view = await this.project(id);
    if (!view) {
      throw new ConflictException(`preview env ${id} projection failed`);
    }
    return view;
  }

  async deploy(id: string, opts?: { image?: string }): Promise<DeployResult> {
    const aggregate = await this.load(id);
    if (!aggregate) {
      throw new NotFoundException(`preview env ${id} not found`);
    }
    if (aggregate.status === 'destroyed') {
      throw new ConflictException(`preview env ${id} already destroyed`);
    }
    if (!(await this.dockerProbe())) {
      return { deployed: false, id, note: 'docker not available; stub preview URL kept', url: aggregate.url };
    }

    const image = opts?.image || process.env.JACK_PREVIEW_IMAGE || DEFAULT_PREVIEW_IMAGE;
    const container = `jack-preview-pr${aggregate.prNumber}-${id.slice(-8)}`;
    const port = 30000 + Math.floor(Math.random() * 9000);
    const isBusybox = image === DEFAULT_PREVIEW_IMAGE;
    const command = isBusybox
      ? `docker run -d --name ${container} -p ${port}:80 ${image} sh -c "echo '<h1>preview ${container}</h1>' > index.html && httpd -f -p 80"`
      : `docker run -d --name ${container} -p ${port}:80 ${image}`;
    try {
      await execAsync(`docker rm -f ${container}`, { windowsHide: true }).catch(() => undefined);
      await execAsync(command, { timeout: 120_000, windowsHide: true });
    } catch (err) {
      const e = err as { stderr?: string; message?: string };
      return { deployed: false, id, note: `docker run failed: ${(e.stderr || e.message || '').slice(0, 200)}` };
    }

    const url = `http://localhost:${port}`;
    await this.eventStore.append(
      makeEvent({
        traceId: aggregate.traceId,
        type: EVENT.previewEnvReady,
        aggregateType: AGGREGATE.previewEnv,
        aggregateId: id,
        actor: { type: 'system', id: 'preview-runner' },
        payload: { url, container, port, image },
      }),
    );
    const view = await this.project(id);
    return { deployed: true, id, url, container, port, image };
  }

  async markReady(id: string, url?: string): Promise<PreviewEnvView> {
    const aggregate = await this.load(id);
    if (!aggregate) {
      throw new NotFoundException(`preview env ${id} not found`);
    }
    if (aggregate.status !== 'creating') {
      throw new ConflictException(`preview env ${id} is ${aggregate.status}, cannot mark ready`);
    }
    await this.eventStore.append(
      makeEvent({
        traceId: aggregate.traceId,
        type: EVENT.previewEnvReady,
        aggregateType: AGGREGATE.previewEnv,
        aggregateId: id,
        actor: { type: 'system', id: 'preview-runner' },
        payload: { url: url ?? aggregate.url ?? null },
      }),
    );
    return (await this.project(id)) as PreviewEnvView;
  }

  async destroy(id: string, actorId = 'webhook'): Promise<PreviewEnvView> {
    const aggregate = await this.load(id);
    if (!aggregate) {
      throw new NotFoundException(`preview env ${id} not found`);
    }
    if (aggregate.status === 'destroyed') {
      throw new ConflictException(`preview env ${id} already destroyed`);
    }
    if (aggregate.container) {
      await execAsync(`docker rm -f ${aggregate.container}`, { windowsHide: true }).catch(() => undefined);
    }
    await this.eventStore.append(
      makeEvent({
        traceId: aggregate.traceId,
        type: EVENT.previewEnvDestroyed,
        aggregateType: AGGREGATE.previewEnv,
        aggregateId: id,
        actor: { type: 'system', id: actorId },
        payload: { reason: 'pr_closed' },
      }),
    );
    return (await this.project(id)) as PreviewEnvView;
  }

  async destroyByPr(idOrSlug: string, prNumber: number, actorId = 'webhook'): Promise<PreviewEnvView | null> {
    const service = await this.resolveService(idOrSlug);
    const slug = service?.slug ?? idOrSlug;
    const existing = await this.findByPr(slug, prNumber);
    if (!existing || existing.status === 'destroyed') {
      return null;
    }
    return this.destroy(existing.id, actorId);
  }

  async list(serviceId?: string): Promise<PreviewEnvView[]> {
    const requested = await this.eventStore.listByType(EVENT.previewEnvRequested);
    const views = await Promise.all(requested.map((e) => this.project(e.aggregateId)));
    const all = views.filter((v): v is PreviewEnvView => v !== null);
    return serviceId ? all.filter((v) => v.serviceId === serviceId) : all;
  }

  async expired(now = new Date()): Promise<PreviewEnvView[]> {
    const all = await this.list();
    return all.filter((v) => {
      if (v.status !== 'ready') {
        return false;
      }
      return new Date(v.createdAt).getTime() + v.ttlHours * 3600_000 < now.getTime();
    });
  }

  async get(id: string): Promise<PreviewEnvView | null> {
    return this.project(id);
  }

  private async resolveService(idOrSlug: string) {
    const bySlug = await this.catalog.get(idOrSlug);
    if (bySlug) {
      return bySlug;
    }
    const all = await this.catalog.list();
    return all.find((s) => s.id === idOrSlug) ?? null;
  }

  private async findByPr(serviceId: string, prNumber: number): Promise<PreviewEnvView | null> {
    const all = await this.list(serviceId);
    return all.find((v) => v.prNumber === prNumber) ?? null;
  }

  private async load(id: string): Promise<PreviewEnvAggregate | null> {
    const events = await this.eventStore.listByAggregate(AGGREGATE.previewEnv, id);
    if (events.length === 0) {
      return null;
    }
    let aggregate: PreviewEnvAggregate | null = null;
    for (const event of events) {
      if (event.type === EVENT.previewEnvRequested) {
        aggregate = {
          traceId: event.traceId,
          serviceId: event.payload.serviceId as string,
          prNumber: event.payload.prNumber as number,
          prTitle: (event.payload.prTitle as string | null) ?? undefined,
          branch: (event.payload.branch as string | null) ?? undefined,
          commit: (event.payload.commit as string | null) ?? undefined,
          url: (event.payload.url as string | null) ?? undefined,
          status: 'creating',
          createdAt: event.occurredAt,
          ttlHours: (event.payload.ttlHours as number) ?? 72,
        };
      } else if (event.type === EVENT.previewEnvReady && aggregate) {
        aggregate.status = 'ready';
        aggregate.url = ((event.payload.url as string | null) ?? aggregate.url) || undefined;
        aggregate.container = ((event.payload.container as string | null) ?? aggregate.container) || undefined;
        aggregate.port = ((event.payload.port as number | null) ?? aggregate.port) || undefined;
        aggregate.image = ((event.payload.image as string | null) ?? aggregate.image) || undefined;
      } else if (event.type === EVENT.previewEnvDestroyed && aggregate) {
        aggregate.status = 'destroyed';
        aggregate.destroyedAt = event.occurredAt;
      }
    }
    return aggregate;
  }

  private async project(id: string): Promise<PreviewEnvView | null> {
    const aggregate = await this.load(id);
    if (!aggregate) {
      return null;
    }
    return {
      id,
      traceId: aggregate.traceId,
      serviceId: aggregate.serviceId,
      prNumber: aggregate.prNumber,
      prTitle: aggregate.prTitle,
      branch: aggregate.branch,
      commit: aggregate.commit,
      url: aggregate.url,
      status: aggregate.status,
      createdAt: aggregate.createdAt,
      destroyedAt: aggregate.destroyedAt,
      ttlHours: aggregate.ttlHours,
      container: aggregate.container,
      port: aggregate.port,
      image: aggregate.image,
    };
  }
}
