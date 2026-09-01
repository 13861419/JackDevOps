import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { PreviewsController } from './previews.controller';
import { PreviewsService } from './previews.service';

@Module({
  imports: [CatalogModule],
  controllers: [PreviewsController],
  providers: [PreviewsService],
  exports: [PreviewsService],
})
export class PreviewsModule {}
