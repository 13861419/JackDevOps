import { ConflictException, Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { AGGREGATE, EVENT, makeEvent, newChangeTraceId, newId } from '../../events';
import { EVENT_STORE, type EventStore, type DomainEvent } from '../../events';
import type { WorkflowSpec, WorkflowView } from '../workflows/workflow.types';
import { WorkflowsService } from '../workflows/workflows.service';

export interface WorkflowTemplateView {
  id: string;
  traceId: string;
  slug: string;
  name: string;
  language: string;
  spec: WorkflowSpec;
  builtin: boolean;
}

const BUILTIN_TEMPLATES = [
  {
    slug: 'builtin-node-service',
    name: 'Node.js 服务流水线',
    language: 'node',
    spec: {
      jobs: [
        { id: 'scan', type: 'scan' as const },
        { id: 'build', type: 'build' as const, dependsOn: ['scan'], config: { tool: 'npm' } },
        { id: 'test', type: 'test' as const, dependsOn: ['build'], config: { runner: 'vitest' } },
        { id: 'deploy', type: 'deploy' as const, dependsOn: ['test'] },
      ],
    },
  },
  {
    slug: 'builtin-go-service',
    name: 'Go 服务流水线',
    language: 'go',
    spec: {
      jobs: [
        { id: 'scan', type: 'scan' as const },
        { id: 'build', type: 'build' as const, dependsOn: ['scan'], config: { tool: 'go' } },
        { id: 'test', type: 'test' as const, dependsOn: ['build'], config: { runner: 'go-test' } },
        { id: 'deploy', type: 'deploy' as const, dependsOn: ['test'] },
      ],
    },
  },
  {
    slug: 'builtin-python-service',
    name: 'Python 服务流水线',
    language: 'python',
    spec: {
      jobs: [
        { id: 'scan', type: 'scan' as const },
        { id: 'build', type: 'build' as const, dependsOn: ['scan'], config: { tool: 'uv' } },
        { id: 'test', type: 'test' as const, dependsOn: ['build'], config: { runner: 'pytest' } },
        { id: 'deploy', type: 'deploy' as const, dependsOn: ['test'] },
      ],
    },
  },
];

@Injectable()
export class TemplatesService implements OnModuleInit {
  constructor(
    @Inject(EVENT_STORE) private readonly eventStore: EventStore,
    private readonly workflows: WorkflowsService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensureBuiltins();
  }

  async ensureBuiltins(): Promise<void> {
    const existing = await this.list();
    const slugs = new Set(existing.map((t) => t.slug));
    for (const tpl of BUILTIN_TEMPLATES) {
      if (!slugs.has(tpl.slug)) {
        await this.register({ ...tpl, builtin: true, actorId: 'system' });
      }
    }
  }

  async register(input: {
    slug: string;
    name: string;
    language: string;
    spec: WorkflowSpec;
    builtin: boolean;
    actorId: string;
  }): Promise<WorkflowTemplateView> {
    if (await this.get(input.slug)) {
      throw new ConflictException(`template slug '${input.slug}' already exists`);
    }
    const id = newId('tpl');
    const event = makeEvent({
      traceId: newChangeTraceId(),
      type: EVENT.templateRegistered,
      aggregateType: AGGREGATE.template,
      aggregateId: id,
      actor: { type: 'system', id: input.actorId },
      payload: {
        slug: input.slug,
        name: input.name,
        language: input.language,
        spec: input.spec,
        builtin: input.builtin,
      },
    });
    await this.eventStore.append(event);
    return this.project(id, event) as WorkflowTemplateView;
  }

  async list(): Promise<WorkflowTemplateView[]> {
    const registered = await this.eventStore.listByType(EVENT.templateRegistered);
    return registered.map((e) => this.project(e.aggregateId, e));
  }

  async get(slug: string): Promise<WorkflowTemplateView | null> {
    const registered = await this.eventStore.listByType(EVENT.templateRegistered);
    const found = registered.find((e) => e.payload.slug === slug);
    return found ? this.project(found.aggregateId, found) : null;
  }

  async instantiate(
    slug: string,
    input: { name?: string; serviceId?: string; actorId: string },
  ): Promise<WorkflowView> {
    const template = await this.get(slug);
    if (!template) {
      throw new ConflictException(`template ${slug} not found`);
    }
    return this.workflows.create({
      name: input.name ?? template.name,
      spec: template.spec,
      serviceId: input.serviceId,
      actorId: input.actorId,
    });
  }

  private project(id: string, created: DomainEvent): WorkflowTemplateView {
    return {
      id,
      traceId: created.traceId,
      slug: created.payload.slug as string,
      name: created.payload.name as string,
      language: created.payload.language as string,
      spec: created.payload.spec as WorkflowSpec,
      builtin: (created.payload.builtin as boolean) ?? false,
    };
  }
}
