import { Inject, Injectable } from '@nestjs/common';
import { AGGREGATE, EVENT, makeEvent, newId } from '../../events';
import { EVENT_STORE, type EventStore } from '../../events';
import { CatalogService, type ServiceView } from '../catalog/catalog.service';
import { WorkflowsService } from '../workflows/workflows.service';
import type { WorkflowSpec, WorkflowView } from '../workflows/workflow.types';

export interface ScaffoldResult {
  service: ServiceView;
  workflow: WorkflowView;
  traceId: string;
}

function standardJobs(language: string, slug: string): WorkflowSpec['jobs'] {
  if (language === 'node' || language === 'typescript') {
    return [
      { id: 'build', type: 'build', config: { command: 'npm ci && npm run build' } },
      { id: 'test', type: 'test', dependsOn: ['build'], config: { command: 'npm test -- --passWithNoTests' } },
    ];
  }
  if (language === 'python') {
    return [
      { id: 'test', type: 'test', config: { command: 'pytest -q' } },
    ];
  }
  return [{ id: 'build', type: 'build', config: { command: `echo build ${slug}` } }];
}

@Injectable()
export class ScaffoldService {
  constructor(
    @Inject(EVENT_STORE) private readonly eventStore: EventStore,
    private readonly catalog: CatalogService,
    private readonly workflows: WorkflowsService,
  ) {}

  async apply(input: {
    name: string;
    slug: string;
    language: string;
    description?: string;
    repoUrl?: string;
    actorId?: string;
  }): Promise<ScaffoldResult> {
    const service = await this.catalog.register({
      name: input.name,
      slug: input.slug,
      ownerId: input.actorId ?? 'scaffold',
      repoUrl: input.repoUrl,
      language: input.language,
      description: input.description,
    });

    const jobs = standardJobs(input.language, input.slug);
    const workflow = await this.workflows.create({
      name: `${input.slug}-pipeline`,
      spec: { jobs },
      serviceId: service.id,
      actorId: input.actorId ?? 'scaffold',
    });

    await this.eventStore.append(
      makeEvent({
        traceId: service.traceId,
        type: EVENT.scaffoldApplied,
        aggregateType: AGGREGATE.service,
        aggregateId: service.slug,
        actor: { type: 'user', id: input.actorId ?? 'scaffold' },
        payload: {
          language: input.language,
          workflowId: workflow.id,
          jobTypes: jobs.map((j) => j.type),
        },
      }),
    );

    return { service, workflow, traceId: service.traceId };
  }

  async goldenPath(): Promise<{ templates: { slug: string; language: string }[]; note: string }> {
    const registered = await this.eventStore.listByType(EVENT.templateRegistered);
    return {
      templates: registered.map((e) => ({
        slug: e.payload.slug as string,
        language: (e.payload.language as string) ?? 'unknown',
      })),
      note: 'golden path: scaffold -> push -> pipeline runs -> release',
    };
  }

  id(): string {
    return newId('scf');
  }
}
