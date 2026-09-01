import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { SecretsController } from './secrets.controller';
import { SecretsService } from './secrets.service';

@Module({
  imports: [CatalogModule],
  controllers: [SecretsController],
  providers: [SecretsService],
})
export class SecretsModule {}
