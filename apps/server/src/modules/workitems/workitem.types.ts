export type WorkItemKind = 'requirement' | 'task' | 'bug';

export type WorkItemStatus = 'backlog' | 'todo' | 'in_progress' | 'done' | 'blocked';

export const WORK_ITEM_TRANSITIONS: Record<WorkItemStatus, WorkItemStatus[]> = {
  backlog: ['todo'],
  todo: ['in_progress'],
  in_progress: ['done', 'blocked'],
  blocked: ['todo', 'in_progress'],
  done: [],
};

export function canTransition(from: WorkItemStatus, to: WorkItemStatus): boolean {
  return WORK_ITEM_TRANSITIONS[from].includes(to);
}

export interface WorkItemView {
  id: string;
  traceId: string;
  kind: WorkItemKind;
  title: string;
  status: WorkItemStatus;
  serviceId?: string;
  createdBy: string;
  createdAt: string;
}
