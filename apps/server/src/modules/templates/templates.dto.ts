import { z } from 'zod';

export const instantiateDto = z.object({
  name: z.string().min(1).max(200).optional(),
  serviceId: z.string().optional(),
  actorId: z.string().min(1).default('anonymous'),
});

export type InstantiateDto = z.infer<typeof instantiateDto>;
