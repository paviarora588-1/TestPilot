import { Module } from '@nestjs/common';
import { AiProviderModule } from '../ai-provider/ai-provider.module';
import { RagModule } from '../rag/rag.module';
import { GoldenRulePolicyService } from '../../common/golden-rule-policy.service';
import { AutomationBuilderController } from './automation-builder.controller';
import { AutomationBuilderService } from './automation-builder.service';

@Module({
  imports: [AiProviderModule, RagModule],
  controllers: [AutomationBuilderController],
  providers: [AutomationBuilderService, GoldenRulePolicyService],
  exports: [AutomationBuilderService, GoldenRulePolicyService],
})
export class AutomationBuilderModule {}
