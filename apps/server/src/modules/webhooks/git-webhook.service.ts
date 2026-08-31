import { Injectable } from '@nestjs/common';
import { CatalogService } from '../catalog/catalog.service';
import { WorkflowsService } from '../workflows/workflows.service';
import { WorkflowRunsService } from '../workflows/workflow-runs.service';
import type { RunMeta } from '../workflows/workflow.types';

interface GitPushPayload {
  ref?: string;
  after?: string;
  commit?: string;
  branch?: string;
  repository?: { full_name?: string; html_url?: string };
  pusher?: { name?: string };
}

interface TriggeredRun {
  workflowId: string;
  workflowName: string;
  runId: string;
}

@Injectable()
export class GitWebhookService {
  constructor(
    private readonly catalog: CatalogService,
    private readonly workflows: WorkflowsService,
    private readonly runs: WorkflowRunsService,
  ) {}

  async handlePush(slug: string, body: GitPushPayload): Promise<{ triggered: TriggeredRun[] }> {
    const service = await this.catalog.get(slug);
    if (!service) {
      throw new Error(`service ${slug} not found`);
    }
    const meta = parseMeta(body);
    const all = await this.workflows.list();
    const bound = all.filter((wf) => wf.serviceId && wf.serviceId === service.id);
    const triggered: TriggeredRun[] = [];
    for (const wf of bound) {
      const run = await this.runs.startRun(wf.id, `webhook:${meta.triggeredBy ?? 'git'}`, meta);
      triggered.push({ workflowId: wf.id, workflowName: wf.name, runId: run.id });
    }
    return { triggered };
  }
}

function parseMeta(body: GitPushPayload): RunMeta {
  const branch =
    typeof body.branch === 'string'
      ? body.branch
      : typeof body.ref === 'string' && body.ref.startsWith('refs/heads/')
        ? body.ref.slice('refs/heads/'.length)
        : undefined;
  const commit = body.commit ?? body.after;
  return {
    commit: typeof commit === 'string' ? commit : undefined,
    branch,
    triggeredBy: body.pusher?.name ?? 'git',
  };
}
