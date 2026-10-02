import { Module } from '@nestjs/common';
import { AiProviderModule } from '../ai-provider/ai-provider.module';
import { RagModule } from '../rag/rag.module';
import { GoldenRulePolicyService } from '../../common/golden-rule-policy.service';
import { ScriptGeneratorController } from './script-generator.controller';
import { ScriptGeneratorService } from './script-generator.service';

@Module({
  imports: [AiProviderModule, RagModule],
  controllers: [ScriptGeneratorController],
  providers: [ScriptGeneratorService, GoldenRulePolicyService],
  exports: [ScriptGeneratorService],
})
export class ScriptGeneratorModule {}
