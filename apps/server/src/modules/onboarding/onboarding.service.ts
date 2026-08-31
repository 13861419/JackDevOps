import { Injectable } from '@nestjs/common';
import { CatalogService } from '../catalog/catalog.service';
import { TemplatesService } from '../templates/templates.service';
import type { ServiceView } from '../catalog/catalog.service';
import type { WorkflowView } from '../workflows/workflow.types';
import { newId } from '../../events';

export interface QuickstartResult {
  service: ServiceView;
  workflow: WorkflowView | null;
  guide: {
    webhookUrl: string;
    runNow: string;
    nextSteps: string[];
  };
}

@Injectable()
export class OnboardingService {
  constructor(
    private readonly catalog: CatalogService,
    private readonly templates: TemplatesService,
  ) {}

  async quickstart(input: {
    name: string;
    language: string;
    ownerId: string;
    slug?: string;
  }): Promise<QuickstartResult> {
    const slug = await this.uniqueSlug(input.slug ?? kebab(input.name));
    const service = await this.catalog.register({
      name: input.name,
      slug,
      ownerId: input.ownerId,
      language: input.language,
    });

    let workflow: WorkflowView | null = null;
    const templateSlug = `builtin-${input.language}-service`;
    try {
      workflow = await this.templates.instantiate(templateSlug, {
        name: `${input.name} 流水线`,
        serviceId: service.id,
        actorId: input.ownerId,
      });
    } catch {
      workflow = null;
    }

    return {
      service,
      workflow,
      guide: {
        webhookUrl: `/webhooks/git/${slug}`,
        runNow: workflow ? `POST /workflows/${workflow.id}/runs` : '',
        nextSteps: [
          '1. 把仓库地址补充到服务目录',
          '2. 在 Git 平台配置 Push Webhook 指向上面的 webhookUrl',
          '3. push 代码即自动触发流水线；也可在流水线页手动运行',
        ],
      },
    };
  }

  private async uniqueSlug(candidate: string): Promise<string> {
    let slug = candidate;
    for (let i = 0; i < 5 && (await this.catalog.get(slug)); i++) {
      slug = `${candidate}-${newId('x').slice(3, 7)}`;
    }
    return slug;
  }
}

function kebab(name: string): string {
  const ascii = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  return ascii.length >= 2 ? ascii : `svc-${newId('x').slice(3, 9)}`;
}
