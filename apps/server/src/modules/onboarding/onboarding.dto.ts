import { z } from 'zod';

export const quickstartDto = z.object({
  name: z.string().min(1).max(200),
  language: z.enum(['node', 'go', 'python']).default('node'),
  ownerId: z.string().min(1).default('anonymous'),
  slug: z
    .string()
    .max(64)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'slug must be kebab-case')
    .optional(),
});

export type QuickstartDto = z.infer<typeof quickstartDto>;
