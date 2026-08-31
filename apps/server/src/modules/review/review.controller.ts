import { Body, Controller, Post } from '@nestjs/common';
import { z } from 'zod';
import { ReviewService } from './review.service';
import { ZodValidationPipe } from '../../shared/zod.pipe';

const reviewDto = z.object({
  title: z.string().min(1).max(300),
  description: z.string().max(5000).optional(),
  serviceId: z.string().optional(),
  actorId: z.string().min(1).default('web'),
  files: z
    .array(
      z.object({
        path: z.string().min(1),
        additions: z.number().int().min(0),
        deletions: z.number().int().min(0),
      }),
    )
    .default([]),
});

type ReviewDto = z.infer<typeof reviewDto>;

@Controller('reviews')
export class ReviewController {
  constructor(private readonly review: ReviewService) {}

  @Post('pr')
  reviewPr(@Body(new ZodValidationPipe(reviewDto)) dto: ReviewDto) {
    return this.review.reviewPullRequest(dto, dto.actorId);
  }
}
