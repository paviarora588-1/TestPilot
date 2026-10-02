import { Module } from '@nestjs/common';
import { AiProviderModule } from '../ai-provider/ai-provider.module';
import { RagModule } from '../rag/rag.module';
import { BugReportsModule } from '../bug-reports/bug-reports.module';
import { ScriptGeneratorModule } from '../script-generator/script-generator.module';
import { GoldenRulePolicyService } from '../../common/golden-rule-policy.service';
import { ExecutionController } from './execution.controller';
import { ExecutionService } from './execution.service';

@Module({
  imports: [AiProviderModule, RagModule, BugReportsModule, ScriptGeneratorModule],
  controllers: [ExecutionController],
  providers: [ExecutionService, GoldenRulePolicyService],
  exports: [ExecutionService],
})
export class ExecutionModule {}
