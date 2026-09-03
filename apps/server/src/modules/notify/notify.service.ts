import { Injectable, Logger } from '@nestjs/common';
import {
  buildPayload,
  formatRunCompleted,
  type NotifyProvider,
} from './notify.payloads';
import type { RunView } from '../workflows/workflow-runs.service';

export interface GitStatusResult {
  sent: boolean;
  state?: string;
  note?: string;
}

@Injectable()
export class NotifyService {
  private readonly configured =
    Boolean(process.env.NOTIFY_WEBHOOK_URL) && Boolean(process.env.NOTIFY_PROVIDER);

  async runCompleted(run: RunView, workflowName: string): Promise<void> {
    if (this.configured) {
      const provider = (process.env.NOTIFY_PROVIDER ?? 'slack') as NotifyProvider;
      const url = process.env.NOTIFY_WEBHOOK_URL as string;
      const text = formatRunCompleted({
        workflowName,
        status: run.status,
        commit: run.meta?.commit,
        branch: run.meta?.branch,
      });
      const payload = buildPayload(provider, text);
      try {
        await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } catch (err) {
        console.warn(`[notify] failed to deliver ${provider} notification: ${String(err)}`);
      }
    }
    await this.postCommitStatus(run, workflowName);
  }

  async postCommitStatus(run: RunView, workflowName: string): Promise<GitStatusResult> {
    const token = process.env.JACK_GITHUB_TOKEN;
    if (!token) {
      return { sent: false, note: 'JACK_GITHUB_TOKEN not set; commit status skipped' };
    }
    const sha = run.meta?.commit;
    const repo = run.meta?.repoUrl;
    if (!sha || !repo) {
      return { sent: false, note: 'run meta missing commit or repository; commit status skipped' };
    }
    const api = process.env.JACK_GITHUB_API ?? 'https://api.github.com';
    const state =
      run.status === 'succeeded' ? 'success' : run.status === 'failed' ? 'failure' : 'pending';
    try {
      const res = await fetch(`${api}/repos/${repo}/statuses/${sha}`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          accept: 'application/vnd.github+json',
        },
        body: JSON.stringify({
          state,
          context: 'jackdevops/pipeline',
          description: `${workflowName} ${run.status}`.slice(0, 100),
        }),
      });
      if (!res.ok) {
        return { sent: false, note: `github api responded ${res.status}` };
      }
      return { sent: true, state };
    } catch (err) {
      return { sent: false, note: `github status failed: ${String(err).slice(0, 120)}` };
    }
  }
}
