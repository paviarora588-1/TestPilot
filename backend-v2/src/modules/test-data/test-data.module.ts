import { Module } from '@nestjs/common';
import { AiProviderModule } from '../ai-provider/ai-provider.module';
import { RagModule } from '../rag/rag.module';
import { PlaceholderResolverService } from './placeholder-resolver.service';
import { TestDataController } from './test-data.controller';
import { TestDataService } from './test-data.service';

@Module({
  imports: [AiProviderModule, RagModule],
  controllers: [TestDataController],
  providers: [TestDataService, PlaceholderResolverService],
  exports: [TestDataService, PlaceholderResolverService],
})
export class TestDataModule {}
