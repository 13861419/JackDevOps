import { currentTenantId } from './tenant-context';

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
  /** Optional tenant scope (F2 multi-tenancy Phase 1); absent = global/legacy event */
  tenantId?: string;
  /** Monotonic per-aggregate version, assigned by the store on append */
  aggregateVersion?: number;
}

export const AGGREGATE = {
  workItem: 'workitem',
  service: 'service',
  workflow: 'workflow',
  workflowRun: 'workflowrun',
  template: 'template',
  review: 'review',
  ai: 'ai',
  release: 'release',
  flag: 'flag',
  testSuite: 'testsuite',
  testRun: 'testrun',
    previewEnv: 'previewenv',
    doc: 'doc',
    plugin: 'plugin',
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
  releaseRegistered: 'release.registered',
  releaseStrategyStep: 'release.strategy_step',
  releasePromoted: 'release.promoted',
  releaseRolledBack: 'release.rolled_back',
  releaseApproved: 'release.approved',
  flagCreated: 'flag.created',
  flagRolloutChanged: 'flag.rollout_changed',
  flagEvaluated: 'flag.evaluated',
  testSuiteCreated: 'testsuite.created',
  testRunRecorded: 'testrun.recorded',
  previewEnvRequested: 'previewenv.requested',
  previewEnvReady: 'previewenv.ready',
  previewEnvDestroyed: 'previewenv.destroyed',
  marketPluginInstalled: 'market.plugin_installed',
  marketPluginUninstalled: 'market.plugin_uninstalled',
  docUpdated: 'doc.updated',
  driftDetected: 'drift.detected',
  driftReconciled: 'drift.reconciled',
  releaseRedeployed: 'release.redeployed',
  scaffoldApplied: 'scaffold.applied',
  secretRefRegistered: 'secret.ref_registered',
  secretRefDeleted: 'secret.ref_deleted',
  releaseProvenanceRecorded: 'release.provenance_recorded',
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
    tenantId: input.tenantId ?? currentTenantId(),
    eventId: newId('evt'),
    occurredAt: new Date().toISOString(),
  } as DomainEvent<T>;
}
