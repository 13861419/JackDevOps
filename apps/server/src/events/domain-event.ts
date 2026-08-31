export type ActorType = 'user' | 'agent' | 'system';

export interface Actor {
  type: ActorType;
  id: string;
}

export interface DomainEvent<T = Record<string, unknown>> {
  eventId: string;
  traceId: string;
  type: string;
  schemaVersion: number;
  aggregateType: string;
  aggregateId: string;
  actor: Actor;
  payload: T;
  occurredAt: string;
}

export const AGGREGATE = {
  workItem: 'workitem',
  service: 'service',
  workflow: 'workflow',
  workflowRun: 'workflowrun',
  template: 'template',
  review: 'review',
  ai: 'ai',
} as const;

export const EVENT = {
  workItemCreated: 'workitem.created',
  workItemStatusChanged: 'workitem.status_changed',
  serviceRegistered: 'service.registered',
  workflowCreated: 'workflow.created',
  templateRegistered: 'template.registered',
  runStarted: 'run.started',
  runCompleted: 'run.completed',
  jobStarted: 'job.started',
  jobSucceeded: 'job.succeeded',
  jobFailed: 'job.failed',
  jobSkipped: 'job.skipped',
  reviewCompleted: 'review.completed',
  aiCompleted: 'ai.completed',
} as const;

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

export function newChangeTraceId(): string {
  return newId('chg');
}

export function makeEvent<T extends Record<string, unknown>>(
  input: Omit<DomainEvent<T>, 'eventId' | 'occurredAt' | 'schemaVersion'> & { schemaVersion?: number },
): DomainEvent<T> {
  return {
    schemaVersion: 1,
    ...input,
    eventId: newId('evt'),
    occurredAt: new Date().toISOString(),
  } as DomainEvent<T>;
}
