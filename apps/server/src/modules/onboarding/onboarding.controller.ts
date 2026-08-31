import { Body, Controller, Post } from '@nestjs/common';
import { OnboardingService } from './onboarding.service';
import { quickstartDto, type QuickstartDto } from './onboarding.dto';
import { ZodValidationPipe } from '../../shared/zod.pipe';

@Controller('onboarding')
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Post('quickstart')
  quickstart(@Body(new ZodValidationPipe(quickstartDto)) dto: QuickstartDto) {
    return this.onboarding.quickstart(dto);
  }
}
