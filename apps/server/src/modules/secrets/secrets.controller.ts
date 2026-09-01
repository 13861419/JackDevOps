import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { SecretsService } from './secrets.service';
import { ZodValidationPipe } from '../../shared/zod.pipe';

const registerDto = z.object({
  key: z.string().regex(/^[A-Z][A-Z0-9_]*$/, 'key must be UPPER_SNAKE env var name'),
  provider: z.string().min(1).max(60),
  ref: z.string().min(1).max(300),
  actorId: z.string().min(1).default('web'),
});

const resolveDto = z.object({
  keys: z.array(z.string()).max(100).optional(),
  actorId: z.string().min(1).default('web'),
});

type RegisterDto = z.infer<typeof registerDto>;
type ResolveDto = z.infer<typeof resolveDto>;

@Controller('secrets')
export class SecretsController {
  constructor(private readonly secrets: SecretsService) {}

  @Post(':slug')
  register(@Param('slug') slug: string, @Body(new ZodValidationPipe(registerDto)) dto: RegisterDto) {
    return this.secrets.register(slug, dto);
  }

  @Get(':slug')
  list(@Param('slug') slug: string) {
    return this.secrets.list(slug);
  }

  @Post(':slug/resolve')
  resolve(@Param('slug') slug: string, @Body(new ZodValidationPipe(resolveDto)) dto: ResolveDto) {
    return this.secrets.resolve(slug, dto);
  }

  @Delete(':slug/:key')
  remove(@Param('slug') slug: string, @Param('key') key: string) {
    return this.secrets.remove(slug, key, 'api');
  }
}
