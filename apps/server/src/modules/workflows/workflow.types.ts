export type JobType = 'build' | 'test' | 'scan' | 'deploy' | 'agent' | 'container-build';

export interface JobSpec {
  id: string;
  type: JobType;
  dependsOn?: string[];
  config?: Record<string, unknown>;
}

export interface WorkflowSpec {
  jobs: JobSpec[];
}

export interface JobHandlerContext {
  runId: string;
  jobId: string;
  traceId: string;
  config: Record<string, unknown>;
}

export interface JobHandler {
  type: JobType;
  description: string;
  run(ctx: JobHandlerContext): Promise<Record<string, unknown>>;
}

export type JobStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped';

export type RunStatus = 'running' | 'succeeded' | 'failed';

export interface RunMeta {
    commit?: string;
    branch?: string;
    triggeredBy?: string;
    workItemIds?: string[];
    repoUrl?: string;
  }

export interface WorkflowView {
  id: string;
  traceId: string;
  name: string;
  serviceId?: string;
  spec: WorkflowSpec;
  createdAt: string;
}

export function validateSpecDag(spec: WorkflowSpec, knownTypes: JobType[]): void {
  if (!spec.jobs || spec.jobs.length === 0) {
    throw new Error('workflow must contain at least one job');
  }
  const ids = new Set<string>();
  for (const job of spec.jobs) {
    if (!/^[a-zA-Z0-9_-]+$/.test(job.id)) {
      throw new Error(`invalid job id '${job.id}'`);
    }
    if (ids.has(job.id)) {
      throw new Error(`duplicate job id '${job.id}'`);
    }
    ids.add(job.id);
  }
  for (const job of spec.jobs) {
    if (!knownTypes.includes(job.type)) {
      throw new Error(`unknown job type '${job.type}'`);
    }
    for (const dep of job.dependsOn ?? []) {
      if (!ids.has(dep)) {
        throw new Error(`job '${job.id}' depends on unknown job '${dep}'`);
      }
      if (dep === job.id) {
        throw new Error(`job '${job.id}' depends on itself`);
      }
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byId = new Map(spec.jobs.map((j) => [j.id, j]));
  const dfs = (id: string): void => {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      throw new Error(`cycle detected in workflow DAG at job '${id}'`);
    }
    visiting.add(id);
    for (const dep of byId.get(id)?.dependsOn ?? []) {
      dfs(dep);
    }
    visiting.delete(id);
    visited.add(id);
  };
  for (const job of spec.jobs) {
    dfs(job.id);
  }
}
