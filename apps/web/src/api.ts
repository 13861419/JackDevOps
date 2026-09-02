const BASE = '/api';

export function getToken(): string {
  return localStorage.getItem('jack_token') ?? 'dev-admin-token';
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${getToken()}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${method} ${path} -> ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

export function subscribeLiveRefresh(cb: () => void): () => void {
  const es = new EventSource(`${BASE}/events/stream?token=${encodeURIComponent(getToken())}`);
  let timer: ReturnType<typeof setTimeout> | undefined;
  es.onmessage = () => {
    clearTimeout(timer);
    timer = setTimeout(cb, 300);
  };
  es.onerror = () => {
    clearTimeout(timer);
  };
  return () => es.close();
}

export const api = {
  get: <T = unknown>(path: string) => req<T>('GET', path),
  post: <T = unknown>(path: string, body?: unknown) => req<T>('POST', path, body),
  put: <T = unknown>(path: string, body?: unknown) => req<T>('PUT', path, body),
  del: <T = unknown>(path: string) => req<T>('DELETE', path),
};

export interface WorkItem {
  id: string;
  traceId: string;
  kind: string;
  title: string;
  status: string;
  serviceId?: string;
  createdAt: string;
}

export interface ServiceView {
  id: string;
  traceId: string;
  name: string;
  slug: string;
  repoUrl?: string;
  language?: string;
  ownerId: string;
  registeredAt: string;
}

export interface JobView {
  id: string;
  type: string;
  status: string;
}

export interface Run {
  id: string;
  workflowId: string;
  workflowName?: string;
  traceId: string;
  status: string;
  jobs?: JobView[];
  meta?: { commit?: string; branch?: string };
  startedAt: string;
  finishedAt?: string;
}

export interface Workflow {
  id: string;
  traceId: string;
  name: string;
  serviceId?: string;
  spec: { jobs: { id: string; type: string; dependsOn?: string[] }[] };
  createdAt: string;
}

export interface Template {
  slug: string;
  name: string;
  language: string;
  builtin: boolean;
}

export interface DomainEventView {
  eventId: string;
  traceId: string;
  type: string;
  aggregateType: string;
  aggregateId: string;
  actor: { type: string; id: string };
  payload: Record<string, unknown>;
  occurredAt: string;
}

export const WORK_ITEM_TRANSITIONS: Record<string, string[]> = {
  backlog: ['todo'],
  todo: ['in_progress'],
  in_progress: ['done', 'blocked'],
  blocked: ['todo', 'in_progress'],
  done: [],
};

export const STATUS_LABELS: Record<string, string> = {
  backlog: '待办',
  todo: '就绪',
  in_progress: '进行中',
  done: '完成',
  blocked: '阻塞',
  pending: '等待',
  running: '运行中',
  succeeded: '成功',
  failed: '失败',
  skipped: '跳过',
};
