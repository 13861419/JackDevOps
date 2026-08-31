import { Injectable, Logger } from '@nestjs/common';
import {
  buildPayload,
  formatRunCompleted,
  type NotifyProvider,
} from './notify.payloads';
import type { RunView } from '../workflows/workflow-runs.service';

@Injectable()
export class NotifyService {
  private readonly configured =
    Boolean(process.env.NOTIFY_WEBHOOK_URL) && Boolean(process.env.NOTIFY_PROVIDER);

  async runCompleted(run: RunView, workflowName: string): Promise<void> {
    if (!this.configured) {
      return;
    }
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
}
