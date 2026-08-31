import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AGGREGATE, EVENT, makeEvent, newId } from '../../events';
import { EVENT_STORE, type EventStore, type DomainEvent } from '../../events';
import { WorkflowRunsService, type RunView } from '../workflows/workflow-runs.service';
import type { ChatMessage } from '@jackdevops/agent-gateway';
import { LlmService } from './llm.service';

export const SYSTEM_PROMPT =
  '你是 JackDevOps 的 DevOps Copilot。基于提供的全链路事件上下文，用简洁中文回答。' +
  '诊断类问题必须区分：真实缺陷 / 环境问题 / Flaky 测试，并给出下一步行动建议。';

@Injectable()
export class AiService {
  constructor(
    @Inject(EVENT_STORE) private readonly eventStore: EventStore,
    private readonly llm: LlmService,
    private readonly runs: WorkflowRunsService,
  ) {}

  async chat(question: string, actorId: string): Promise<{ answer: string }> {
    const context = await this.platformContext();
    const res = await this.llm.chat([
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `平台上下文:\n${context}\n\n问题: ${question}` },
    ]);
    return { answer: res.answer };
  }

  async riskSummary(runId: string, actorId: string): Promise<{ traceId: string; summary: string }> {
    const { run, context } = await this.runContext(runId);
    const res = await this.llm.chat([
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content:
          '以下是一次流水线运行的完整事件链，请生成给发布审批人看的风险摘要：' +
          '变更范围、测试/扫描通过情况、风险信号、建议（放行/驳回）。\n\n' + context,
      },
    ]);
    await this.emitAi(run.traceId, 'risk-summary', run.id, res.answer, actorId);
    return { traceId: run.traceId, summary: res.answer };
  }

  async diagnose(runId: string, actorId: string): Promise<{ traceId: string; diagnosis: string }> {
    const { run, context } = await this.runContext(runId);
    const res = await this.llm.chat([
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content:
          '这次运行失败了。请根据事件上下文做失败归因（真实缺陷/环境问题/Flaky 测试），并给出下一步行动。\n\n' +
          context,
      },
    ]);
    await this.emitAi(run.traceId, 'diagnosis', run.id, res.answer, actorId);
    return { traceId: run.traceId, diagnosis: res.answer };
  }

  private async emitAi(traceId: string, kind: string, runId: string, summary: string, actorId: string): Promise<void> {
    await this.eventStore.append(
      makeEvent({
        traceId,
        type: EVENT.aiCompleted,
        aggregateType: AGGREGATE.ai,
        aggregateId: newId('ai'),
        actor: { type: 'agent', id: 'ai-copilot' },
        payload: { kind, runId, summary: summary.slice(0, 2000), triggeredBy: actorId },
      }),
    );
  }

  private async platformContext(): Promise<string> {
    const events = await this.eventStore.listByType(EVENT.runCompleted);
    const recent = events
      .slice(-20)
      .map((e) => `${e.occurredAt} ${e.type} ${JSON.stringify(e.payload).slice(0, 200)}`);
    return `平台近期 run.completed 事件（最近 ${recent.length} 条）:\n${recent.join('\n')}`;
  }

  private async runContext(runId: string): Promise<{ run: RunView; context: string }> {
    const run = this.runs.get(runId);
    if (!run) {
      throw new NotFoundException(`run ${runId} not found`);
    }
    const trace = await this.eventStore.listByTrace(run.traceId);
    const lines = trace.map((e) => {
      const extra =
        e.type === EVENT.jobFailed || e.type === EVENT.jobSucceeded
          ? ` detail=${JSON.stringify(e.payload).slice(0, 800)}`
          : '';
      return `${e.occurredAt} ${e.type} ${e.aggregateType}/${e.aggregateId}${extra}`;
    });
    const context = [
      `workflow: ${run.workflowName}`,
      `commit: ${run.meta?.commit ?? '-'} branch: ${run.meta?.branch ?? '-'}`,
      `status: ${run.status}`,
      ...lines,
    ].join('\n');
    return { run, context };
  }
}

export type { DomainEvent };
