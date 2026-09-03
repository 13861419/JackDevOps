import { ConflictException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { exec, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { AGGREGATE, EVENT, makeEvent, newId, newChangeTraceId } from '../../events';
import { EVENT_STORE, type EventStore } from '../../events';
import { CatalogService } from '../catalog/catalog.service';
import { hasBinary } from '../workflows/job-registry';
import {
  previewEnvName,
  previewUrl,
  type PreviewBackend,
  type PreviewEnvStatus,
  type PreviewEnvView,
} from './preview.types';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
const DEFAULT_PREVIEW_IMAGE = 'busybox:latest';

export interface DeployResult {
  deployed: boolean;
  id: string;
  url?: string;
  container?: string;
  port?: number;
  image?: string;
  backend?: PreviewBackend;
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
  backend?: PreviewBackend;
  pod?: string;
  service?: string;
}

@Injectable()
export class PreviewsService {
  private readonly dockerProbe: () => Promise<boolean>;
  private readonly k8sProbe: () => Promise<boolean>;

  constructor(
    @Inject(EVENT_STORE) private readonly eventStore: EventStore,
    private readonly catalog: CatalogService,
    @Optional() dockerProbe?: () => Promise<boolean>,
    @Optional() k8sProbe?: () => Promise<boolean>,
  ) {
    this.dockerProbe = dockerProbe ?? (() => hasBinary('docker'));
    this.k8sProbe = k8sProbe ?? (() => hasBinary('kubectl'));
  }

  resolveBackend(explicit?: string): PreviewBackend | 'auto' {
    const wanted = (explicit ?? process.env.JACK_PREVIEW_BACKEND ?? 'auto').toLowerCase();
    if (wanted === 'docker' || wanted === 'k8s' || wanted === 'stub') {
      return wanted;
    }
    return 'auto';
  }

  async pickBackend(): Promise<PreviewBackend> {
    const wanted = this.resolveBackend();
    if (wanted !== 'auto') {
      return wanted;
    }
    if (await this.dockerProbe()) {
      return 'docker';
    }
    if (await this.k8sProbe()) {
      return 'k8s';
    }
    return 'stub';
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
    const backend = await this.pickBackend();
    if (backend === 'stub') {
      return { deployed: false, id, backend, note: 'no docker/k8s runtime available; stub preview URL kept', url: aggregate.url };
    }
    if (backend === 'k8s') {
      return this.deployK8s(id, aggregate, opts?.image);
    }
    return this.deployDocker(id, aggregate, opts?.image);
  }

  private async deployDocker(
    id: string,
    aggregate: PreviewEnvAggregate,
    imageOpt?: string,
  ): Promise<DeployResult> {
    const image = imageOpt || process.env.JACK_PREVIEW_IMAGE || DEFAULT_PREVIEW_IMAGE;
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
      return { deployed: false, id, backend: 'docker', note: `docker run failed: ${(e.stderr || e.message || '').slice(0, 200)}` };
    }

    const url = `http://localhost:${port}`;
    await this.eventStore.append(
      makeEvent({
        traceId: aggregate.traceId,
        type: EVENT.previewEnvReady,
        aggregateType: AGGREGATE.previewEnv,
        aggregateId: id,
        actor: { type: 'system', id: 'preview-runner' },
        payload: { url, container, port, image, backend: 'docker' },
      }),
    );
    return { deployed: true, id, url, container, port, image, backend: 'docker' };
  }

  private async deployK8s(
    id: string,
    aggregate: PreviewEnvAggregate,
    imageOpt?: string,
  ): Promise<DeployResult> {
    const image = imageOpt || process.env.JACK_PREVIEW_IMAGE || DEFAULT_PREVIEW_IMAGE;
    const ns = process.env.JACK_K8S_NAMESPACE || 'default';
    const name = `jack-preview-pr${aggregate.prNumber}-${id.slice(-8)}`.toLowerCase();
    const svc = `${name}-svc`;
    const isBusybox = image === DEFAULT_PREVIEW_IMAGE;
    try {
      await this.kubectl(['delete', 'pod', name, '-n', ns, '--ignore-not-found', '--wait=false']);
      const runArgs = ['run', name, '-n', ns, '--image=' + image, '--restart=Never', '--port=80'];
      if (isBusybox) {
        runArgs.push('--', 'sh', '-c', `echo '<h1>preview ${name}</h1>' > index.html && httpd -f -p 80`);
      }
      await this.kubectl(runArgs);
      await this.kubectl([
        'expose', 'pod', name, '-n', ns, '--name=' + svc, '--port=80', '--type=NodePort',
      ]);
      const nodePortRaw = await this.kubectl([
        'get', 'svc', svc, '-n', ns,
        '-o', 'jsonpath={.spec.ports[0].nodePort}',
      ]);
      const port = Number.parseInt(nodePortRaw, 10);
      let url = port ? `http://${svc}:${port}` : `http://${svc}`;
      try {
        const nodeIp = await this.kubectl([
          'get', 'nodes', '-o',
          'jsonpath={.items[0].status.addresses[?(@.type=="InternalIP")].address}',
        ]);
        if (nodeIp && port) {
          url = `http://${nodeIp}:${port}`;
        }
      } catch {
        // ClusterRole to read nodes not granted; fall back to cluster-internal service URL
      }
      await this.eventStore.append(
        makeEvent({
          traceId: aggregate.traceId,
          type: EVENT.previewEnvReady,
          aggregateType: AGGREGATE.previewEnv,
          aggregateId: id,
          actor: { type: 'system', id: 'preview-runner' },
          payload: { url, pod: name, service: svc, port, image, backend: 'k8s' },
        }),
      );
      return { deployed: true, id, url, port, image, backend: 'k8s' };
    } catch (err) {
      const e = err as { stderr?: string; message?: string };
      return { deployed: false, id, backend: 'k8s', note: `kubectl failed: ${(e.stderr || e.message || '').slice(0, 200)}` };
    }
  }

  private kubectl(args: string[]): Promise<string> {
    return execFileAsync('kubectl', args, { timeout: 60_000, windowsHide: true }).then(
      (r) => r.stdout.trim(),
    );
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
    const derivedPod = `jack-preview-pr${aggregate.prNumber}-${id.slice(-8)}`.toLowerCase();
    const ns = process.env.JACK_K8S_NAMESPACE || 'default';
    await this.kubectl(['delete', 'pod', derivedPod, '-n', ns, '--ignore-not-found', '--wait=false']).catch(
      () => undefined,
    );
    await this.kubectl([
      'delete', 'svc', aggregate.service ?? `${derivedPod}-svc`, '-n', ns, '--ignore-not-found',
    ]).catch(() => undefined);
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
    const snapshot = await this.eventStore.loadSnapshot(AGGREGATE.previewEnv, id);
    const events = await this.eventStore.listByAggregate(AGGREGATE.previewEnv, id);
    if (events.length === 0) {
      return null;
    }
    const fromVersion = snapshot?.version ?? 0;
    const pending = events.filter((e) => (e.aggregateVersion ?? 0) > fromVersion);
    let aggregate: PreviewEnvAggregate | null =
      (snapshot?.state as PreviewEnvAggregate | null) ?? null;
    for (const event of pending) {
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
        aggregate.backend = ((event.payload.backend as PreviewBackend | null) ?? aggregate.backend) || undefined;
        aggregate.pod = ((event.payload.pod as string | null) ?? aggregate.pod) || undefined;
        aggregate.service = ((event.payload.service as string | null) ?? aggregate.service) || undefined;
      } else if (event.type === EVENT.previewEnvDestroyed && aggregate) {
        aggregate.status = 'destroyed';
        aggregate.destroyedAt = event.occurredAt;
      }
    }
    if (!aggregate) {
      return null;
    }
    const lastVersion = events[events.length - 1]?.aggregateVersion ?? 0;
    if (lastVersion - fromVersion >= 20) {
      await this.eventStore.saveSnapshot(AGGREGATE.previewEnv, id, lastVersion, aggregate);
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
      backend: aggregate.backend,
      pod: aggregate.pod,
      service: aggregate.service,
    };
  }
}
