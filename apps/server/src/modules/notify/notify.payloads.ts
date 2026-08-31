export type NotifyProvider = 'slack' | 'dingtalk' | 'feishu' | 'wecom';

export function buildPayload(provider: NotifyProvider, text: string): Record<string, unknown> {
  switch (provider) {
    case 'dingtalk':
      return { msgtype: 'text', text: { content: text } };
    case 'feishu':
      return { msg_type: 'text', content: { text } };
    case 'wecom':
      return { msgtype: 'text', text: { content: text } };
    case 'slack':
    default:
      return { text };
  }
}

export function formatRunCompleted(input: {
  workflowName: string;
  status: string;
  commit?: string;
  branch?: string;
  durationMs?: number;
}): string {
  const parts = [
    `JackDevOps 流水线通知`,
    `工作流: ${input.workflowName}`,
    `状态: ${input.status}`,
  ];
  if (input.commit) parts.push(`提交: ${input.commit}`);
  if (input.branch) parts.push(`分支: ${input.branch}`);
  if (input.durationMs !== undefined) parts.push(`耗时: ${Math.round(input.durationMs / 1000)}s`);
  return parts.join('\n');
}
