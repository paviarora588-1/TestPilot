import { Module } from '@nestjs/common';
import { GoldenRulePolicyService } from '../../common/golden-rule-policy.service';
import { AutomationPolicyController } from './automation-policy.controller';

@Module({
  controllers: [AutomationPolicyController],
  providers: [GoldenRulePolicyService],
  exports: [GoldenRulePolicyService],
})
export class AutomationPolicyModule {}
