import { Module } from '@nestjs/common';
import { WorkflowsModule } from '../workflows/workflows.module';
import { MarketController } from './market.controller';
import { MarketService } from './market.service';

@Module({
  controllers: [MarketController],
  providers: [MarketService],
})
export class MarketModule {}
