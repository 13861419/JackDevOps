import { Body, Controller, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { AiService } from './ai.service';
import { ZodValidationPipe } from '../../shared/zod.pipe';

const chatDto = z.object({
  question: z.string().min(1).max(2000),
  actorId: z.string().min(1).default('web'),
});

const actorDto = z.object({
  actorId: z.string().min(1).default('web'),
});

type ChatDto = z.infer<typeof chatDto>;
type ActorDto = z.infer<typeof actorDto>;

@Controller('ai')
export class AiController {
  constructor(private readonly ai: AiService) {}

  @Post('chat')
  chat(@Body(new ZodValidationPipe(chatDto)) dto: { question: string; actorId: string }) {
    return this.ai.chat(dto.question, dto.actorId);
  }

  @Post('risk-summary/:runId')
  riskSummary(
    @Param('runId') runId: string,
    @Body(new ZodValidationPipe(actorDto)) dto: { actorId: string },
  ) {
    return this.ai.riskSummary(runId, dto.actorId);
  }

  @Post('diagnose/:runId')
  diagnose(
    @Param('runId') runId: string,
    @Body(new ZodValidationPipe(actorDto)) dto: { actorId: string },
  ) {
    return this.ai.diagnose(runId, dto.actorId);
  }
}
