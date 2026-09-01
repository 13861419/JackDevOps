import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AGGREGATE, EVENT, makeEvent, newId, newChangeTraceId } from '../../events';
import { EVENT_STORE, type EventStore, type DomainEvent } from '../../events';
import { WorkflowRunsService, type RunView } from '../workflows/workflow-runs.service';
import { WorkflowsService } from '../workflows/workflows.service';
import { CatalogService } from '../catalog/catalog.service';
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
    private readonly workflows: WorkflowsService,
    private readonly catalog: CatalogService,
  ) {}

  async chat(question: string, actorId: string): Promise<{ answer: string }> {
    const context = await this.platformContext();
    const res = await this.llm.chat([
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `平台上下文\n${context}\n\n问题: ${question}` },
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
          '以下是一次流水线运行的完整事件链，请生成给发布审批人看的风险摘要。' +
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

  async catalogQa(
    question: string,
    actorId: string,
  ): Promise<{ answer: string; mode: 'ai' | 'rules'; traceId: string }> {
    const traceId = newChangeTraceId();
    const services = await this.catalog.list();
    const context = await this.catalogContext(services);
    if (this.llm.available) {
      try {
        const res = await this.llm.chat([
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: `以下是平台服务目录快照，请据此回答问题；目录里没有的信息要明确说不知道。\n\n${context}\n\n问题: ${question}`,
          },
        ]);
        await this.emitAi(traceId, 'catalog-qa', '-', res.answer, actorId);
        return { answer: res.answer, mode: 'ai', traceId };
      } catch {
        // fall through to rules answer
      }
    }
    const lower = question.toLowerCase();
    const matched = services.filter(
      (s) => lower.includes(s.slug.toLowerCase()) || lower.includes(s.name.toLowerCase()),
    );
    const answer =
      matched.length === 0
        ? `未在目录中识别到相关服务。平台共有 ${services.length} 个服务: ${
            services.map((s) => `${s.name}(${s.slug})`).join(', ') || '（空）'
          }。可尝试问某个服务的部署/发布状态。`
        : matched.map((s) => `- ${s.name} (${s.slug}): 语言=${s.language ?? '-'} 注册于 ${s.registeredAt}`).join('\n');
    await this.emitAi(traceId, 'catalog-qa', '-', answer, actorId);
    return { answer, mode: 'rules', traceId };
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

  private async catalogContext(services: Awaited<ReturnType<CatalogService['list']>>): Promise<string> {
    const registered = await this.eventStore.listByType(EVENT.releaseRegistered);
    const promoted = await this.eventStore.listByType(EVENT.releasePromoted);
    const completed = await this.eventStore.listByType(EVENT.runCompleted);
    const promotedIds = new Set(promoted.map((e) => e.aggregateId));
    const serviceByWorkflow = new Map<string, string>();
    for (const wf of await this.workflows.list()) {
      if (wf.serviceId) {
        serviceByWorkflow.set(wf.id, wf.serviceId);
      }
    }
    const lines = services.map((service) => {
      const serviceReleases = registered.filter((e) => {
        const run = this.runs.get(e.payload.runId as string);
        return run !== null && serviceByWorkflow.get(run.workflowId) === service.id;
      });
      const lastRun = [...completed]
        .reverse()
        .find((e) => {
          const run = this.runs.get(e.aggregateId);
          return run !== null && serviceByWorkflow.get(run.workflowId) === service.id;
        });
      return (
        `- ${service.name} (${service.slug}) lang=${service.language ?? '-'} ` +
        `releases=${serviceReleases.length} ` +
        `promoted=${serviceReleases.filter((e) => promotedIds.has(e.aggregateId)).length} ` +
        `last_run_at=${lastRun?.occurredAt ?? '-'}`
      );
    });
    return `服务目录快照:\n${lines.join('\n') || '（无服务）'}\n平台累计: ${registered.length} 次发布注册, ${promoted.length} 次发布提升, ${completed.length} 次运行完成`;
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
