import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { DocsController } from './docs.controller';
import { DocsService } from './docs.service';

@Module({
  imports: [CatalogModule],
  controllers: [DocsController],
  providers: [DocsService],
})
export class DocsModule {}
