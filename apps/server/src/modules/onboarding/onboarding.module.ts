import { Module } from '@nestjs/common';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';
import { CatalogModule } from '../catalog/catalog.module';
import { TemplatesModule } from '../templates/templates.module';

@Module({
  imports: [CatalogModule, TemplatesModule],
  controllers: [OnboardingController],
  providers: [OnboardingService],
})
export class OnboardingModule {}
