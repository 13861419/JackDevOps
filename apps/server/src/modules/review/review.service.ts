import { Inject, Injectable, Optional } from '@nestjs/common';
import { AGGREGATE, EVENT, makeEvent, newChangeTraceId, newId } from '../../events';
import { EVENT_STORE, type EventStore, type DomainEvent } from '../../events';
import { runRules, type ReviewFinding, type ReviewPRInput } from './review.rules';
import { runDshAgent } from '../workflows/job-registry';
import { NotifyService } from '../notify/notify.service';

export interface ReviewResult {
  traceId: string;
  verdict: 'pass' | 'warn' | 'fail';
  findings: ReviewFinding[];
  aiSummary?: string;
  aiNote?: string;
}

type DshRunner = (
  task: string,
  cwd: string | undefined,
  timeoutMs: number,
) => Promise<{ stdout: string; stderr: string }>;

const AI_DIFF_LIMIT = 8000;

@Injectable()
export class ReviewService {
  private readonly dshRunner: DshRunner;

  constructor(
    @Inject(EVENT_STORE) private readonly eventStore: EventStore,
    @Optional() private readonly notify?: NotifyService,
    @Optional() dsh?: DshRunner,
  ) {
    this.dshRunner = dsh ?? runDshAgent;
  }

  async reviewPullRequest(input: ReviewPRInput, actorId: string): Promise<ReviewResult> {
    const { verdict, findings } = runRules(input);
    let aiSummary: string | undefined;
    let aiNote: string | undefined;
    if (input.diff && input.diff.length > 0) {
      if (!process.env.DEEPSEEK_API_KEY) {
        aiNote = 'DEEPSEEK_API_KEY not set; AI review skipped (rules only)';
      } else {
        const clipped = input.diff.length > AI_DIFF_LIMIT ? input.diff.slice(0, AI_DIFF_LIMIT) + '\n... (truncated)' : input.diff;
        try {
          const result = await this.dshRunner(
            `You are a strict code reviewer. Review this pull request diff for defects, security vulnerabilities and risks. ` +
              `Reply with a concise bullet list of findings; reply exactly "No significant issues found" when clean.\n\n${clipped}`,
            undefined,
            Number(process.env.JACK_AI_REVIEW_TIMEOUT_MS) || 300_000,
          );
          aiSummary = result.stdout.trim() || '(empty response)';
        } catch (err) {
          aiNote = `AI review failed: ${String(err instanceof Error ? err.message : err).slice(0, 150)}`;
        }
      }
    }

    const traceId = newChangeTraceId();
    await this.eventStore.append(
      makeEvent({
        traceId,
        type: EVENT.reviewCompleted,
        aggregateType: AGGREGATE.review,
        aggregateId: newId('rev'),
        actor: { type: 'system', id: actorId },
        payload: {
          title: input.title,
          serviceId: input.serviceId ?? null,
          verdict,
          findings: findings.map((f) => `${f.severity}:${f.rule}`),
          aiSummary: aiSummary ?? null,
          aiNote: aiNote ?? null,
        },
      }),
    );
    return { traceId, verdict, findings, ...(aiSummary ? { aiSummary } : {}), ...(aiNote ? { aiNote } : {}) };
  }

  async writebackReviewStatus(input: {
    repo?: string;
    sha?: string;
    verdict: 'pass' | 'warn' | 'fail';
  }): Promise<void> {
    if (!this.notify || !input.repo || !input.sha) {
      return;
    }
    const state = input.verdict === 'fail' ? 'failure' : 'success';
    await this.notify.postStatus(
      input.repo,
      input.sha,
      state,
      'jackdevops/ai-review',
      `AI review verdict: ${input.verdict}`,
    );
  }
}

export type { DomainEvent };
