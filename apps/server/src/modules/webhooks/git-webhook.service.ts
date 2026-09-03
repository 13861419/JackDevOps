import { Injectable, Optional } from '@nestjs/common';
import { CatalogService } from '../catalog/catalog.service';
import { WorkflowsService } from '../workflows/workflows.service';
import { WorkflowRunsService } from '../workflows/workflow-runs.service';
import { PreviewsService } from '../previews/previews.service';
import { ReviewService } from '../review/review.service';
import { parseDiffToFiles } from '../review/review.rules';
import type { PreviewEnvView } from '../previews/preview.types';
import type { RunMeta } from '../workflows/workflow.types';

interface GitPushPayload {
  ref?: string;
  after?: string;
  commit?: string;
  branch?: string;
  repository?: { full_name?: string; html_url?: string };
  pusher?: { name?: string };
}

interface GitPrPayload {
  action?: string;
  number?: number;
  pull_request?: {
    number?: number;
    title?: string;
    body?: string;
    head?: { ref?: string; sha?: string };
    diff_url?: string;
  };
  repository?: { full_name?: string; html_url?: string };
}

interface TriggeredRun {
  workflowId: string;
  workflowName: string;
  runId: string;
}

const DIFF_LIMIT = 100_000;

@Injectable()
export class GitWebhookService {
  constructor(
    private readonly catalog: CatalogService,
    private readonly workflows: WorkflowsService,
    private readonly runs: WorkflowRunsService,
    private readonly previews: PreviewsService,
    @Optional() private readonly review?: ReviewService,
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

  async handlePullRequest(slug: string, body: GitPrPayload): Promise<{ preview?: PreviewEnvView; action: string }> {
    const action = body.action ?? 'opened';
    const prNumber = body.number ?? body.pull_request?.number;
    if (!prNumber || prNumber < 1) {
      throw new Error(`pull request payload missing number`);
    }
    const service = await this.catalog.get(slug);
    if (!service) {
      throw new Error(`service ${slug} not found`);
    }
    if (action === 'closed') {
      const preview = await this.previews.destroyByPr(service.slug, prNumber);
      return { action, preview: preview ?? undefined };
    }
    if (action !== 'opened' && action !== 'reopened') {
      return { action };
    }
    const preview = await this.previews.request({
      serviceId: service.slug,
      prNumber,
      prTitle: body.pull_request?.title,
      branch: body.pull_request?.head?.ref,
      commit: body.pull_request?.head?.sha,
      actorId: 'webhook',
    });
    const aiReview = await this.runAiReview(slug, body, prNumber);
    return { action, preview, ...(aiReview ? { review: aiReview } : {}) };
  }

  private async runAiReview(
    slug: string,
    body: GitPrPayload,
    prNumber: number,
  ): Promise<{ verdict: string; findings: unknown[]; aiSummary?: string; aiNote?: string } | null> {
    if (!this.review) {
      return null;
    }
    const diffUrl = body.pull_request?.diff_url;
    if (!diffUrl) {
      return null;
    }
    let diff = '';
    try {
      const headers: Record<string, string> = { accept: 'application/vnd.github.v3.diff' };
      if (process.env.JACK_GITHUB_TOKEN) {
        headers.authorization = `Bearer ${process.env.JACK_GITHUB_TOKEN}`;
      }
      const res = await fetch(diffUrl, { headers });
      if (!res.ok) {
        return { verdict: 'pass', findings: [], aiNote: `diff fetch failed with ${res.status}; AI review skipped` };
      }
      diff = (await res.text()).slice(0, DIFF_LIMIT);
    } catch (err) {
      return { verdict: 'pass', findings: [], aiNote: `diff fetch failed: ${String(err).slice(0, 120)}` };
    }
    const result = await this.review.reviewPullRequest(
      {
        title: body.pull_request?.title ?? `PR #${prNumber}`,
        description: body.pull_request?.body,
        serviceId: slug,
        files: parseDiffToFiles(diff),
        diff,
      },
      'webhook:pr',
    );
    await this.review.writebackReviewStatus({
      repo: body.repository?.full_name,
      sha: body.pull_request?.head?.sha,
      verdict: result.verdict,
    });
    return {
      verdict: result.verdict,
      findings: result.findings,
      ...(result.aiSummary ? { aiSummary: result.aiSummary } : {}),
      ...(result.aiNote ? { aiNote: result.aiNote } : {}),
    };
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
    repoUrl: body.repository?.full_name,
  };
}
