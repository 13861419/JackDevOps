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
    'JackDevOps 流水线通知',
    `工作流: ${input.workflowName}`,
    `状态: ${input.status}`,
  ];
  if (input.commit) parts.push(`提交: ${input.commit}`);
  if (input.branch) parts.push(`分支: ${input.branch}`);
  if (input.durationMs !== undefined) parts.push(`耗时: ${Math.round(input.durationMs / 1000)}s`);
  return parts.join('\n');
}

export interface ApprovalCardInput {
  releaseId: string;
  version: string;
  strategy: string;
  consoleUrl?: string;
  actorId: string;
}

export function formatApprovalRequested(input: ApprovalCardInput): string {
  const parts = [
    'JackDevOps 发布审批',
    `版本: ${input.version}`,
    `策略: ${input.strategy}`,
  ];
  if (input.consoleUrl) parts.push(`控制台: ${input.consoleUrl}`);
  return parts.join('\n');
}

export function buildApprovalCard(
  provider: NotifyProvider,
  input: ApprovalCardInput,
): Record<string, unknown> {
  const title = 'JackDevOps 发布审批';
  const lines = [
    '**发布审批**',
    `版本: ${input.version}`,
    `策略: ${input.strategy}`,
    `提交人: ${input.actorId}`,
  ];
  if (input.consoleUrl) lines.push(`控制台: ${input.consoleUrl}`);

  switch (provider) {
    case 'dingtalk':
      return {
        msgtype: 'actionCard',
        actionCard: {
          title,
          text: lines.join('\n\n'),
          btnOrientation: '0',
          ...(input.consoleUrl
            ? { btns: [{ title: '打开控制台审批', actionURL: input.consoleUrl }] }
            : {}),
        },
      };
    case 'feishu':
      return {
        msg_type: 'interactive',
        card: {
          config: { wide_screen_mode: true },
          header: { title: { tag: 'plain_text', content: title } },
          elements: [
            { tag: 'div', text: { tag: 'lark_md', content: lines.join('\n') } },
            ...(input.consoleUrl
              ? [
                  {
                    tag: 'action',
                    actions: [
                      {
                        tag: 'button',
                        text: { tag: 'plain_text', content: '去审批' },
                        url: input.consoleUrl,
                        type: 'primary',
                      },
                    ],
                  },
                ]
              : []),
          ],
        },
      };
    case 'wecom':
      return { msgtype: 'markdown', markdown: { content: lines.join('\n') } };
    case 'slack':
    default:
      return { text: formatApprovalRequested(input) };
  }
}
