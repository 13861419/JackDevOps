import { z } from 'zod';

export const registerServiceDto = z.object({
  name: z.string().min(1).max(200),
  slug: z
    .string()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'slug must be kebab-case'),
  repoUrl: z.string().url().optional(),
  language: z.string().optional(),
  ownerId: z.string().min(1).default('anonymous'),
  description: z.string().max(2000).optional(),
});

export type RegisterServiceDto = z.infer<typeof registerServiceDto>;
