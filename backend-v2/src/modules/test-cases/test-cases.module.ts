import { Module } from '@nestjs/common';
import { AiProviderModule } from '../ai-provider/ai-provider.module';
import { RagModule } from '../rag/rag.module';
import { AutomationBuilderModule } from '../automation-builder/automation-builder.module';
import { KnowledgeBaseModule } from '../knowledge-base/knowledge-base.module';
import { PipelineModule } from '../pipeline/pipeline.module';
import { TestCasesController } from './test-cases.controller';
import { TestCasesService } from './test-cases.service';

@Module({
  imports: [AiProviderModule, RagModule, AutomationBuilderModule, KnowledgeBaseModule, PipelineModule],
  controllers: [TestCasesController],
  providers: [TestCasesService],
  exports: [TestCasesService],
})
export class TestCasesModule {}
