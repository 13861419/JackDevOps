import { z } from 'zod';

export const createWorkItemDto = z.object({
  title: z.string().min(1).max(200),
  kind: z.enum(['requirement', 'task', 'bug']).default('task'),
  serviceId: z.string().optional(),
  actorId: z.string().min(1).default('anonymous'),
});

export const changeStatusDto = z.object({
  to: z.enum(['backlog', 'todo', 'in_progress', 'done', 'blocked']),
  actorId: z.string().min(1).default('anonymous'),
});

export type CreateWorkItemDto = z.infer<typeof createWorkItemDto>;
export type ChangeStatusDto = z.infer<typeof changeStatusDto>;
