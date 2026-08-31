import { Inject, Injectable } from '@nestjs/common';
import { AGGREGATE, EVENT, makeEvent, newChangeTraceId, newId } from '../../events';
import { EVENT_STORE, type EventStore, type DomainEvent } from '../../events';
import { runRules, type ReviewFinding, type ReviewPRInput } from './review.rules';

export interface ReviewResult {
  traceId: string;
  verdict: 'pass' | 'warn' | 'fail';
  findings: ReviewFinding[];
}

@Injectable()
export class ReviewService {
  constructor(@Inject(EVENT_STORE) private readonly eventStore: EventStore) {}

  async reviewPullRequest(input: ReviewPRInput, actorId: string): Promise<ReviewResult> {
    const { verdict, findings } = runRules(input);
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
        },
      }),
    );
    return { traceId, verdict, findings };
  }
}

export type { DomainEvent };
