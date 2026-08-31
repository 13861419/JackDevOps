import { z } from 'zod';

export const jobSpecDto = z.object({
  id: z.string().min(1).max(64),
  type: z.enum(['build', 'test', 'scan', 'deploy', 'agent']),
  dependsOn: z.array(z.string().max(64)).max(32).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

export const workflowSpecDto = z.object({
  jobs: z.array(jobSpecDto).min(1).max(64),
});

export const createWorkflowDto = z.object({
  name: z.string().min(1).max(200),
  spec: workflowSpecDto,
  serviceId: z.string().optional(),
  actorId: z.string().min(1).default('anonymous'),
});

export const instantiateDto = z.object({
  name: z.string().min(1).max(200).optional(),
  serviceId: z.string().optional(),
  actorId: z.string().min(1).default('anonymous'),
});

export type CreateWorkflowDto = z.infer<typeof createWorkflowDto>;
export type InstantiateDto = z.infer<typeof instantiateDto>;
