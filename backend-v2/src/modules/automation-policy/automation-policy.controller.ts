import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ADMIN_ONLY } from '../../common/role-groups';
import { GoldenRulePolicyService } from '../../common/golden-rule-policy.service';
import { UpdateAutomationPolicyDto } from './dto/update-automation-policy.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('applications/:applicationId/automation-policy')
export class AutomationPolicyController {
  constructor(private readonly policyService: GoldenRulePolicyService) {}

  @Get()
  get(@Param('applicationId') applicationId: string) {
    return this.policyService.getPolicyForApplication(applicationId);
  }

  // Thresholds gate real execution/generation behavior — Admin-only, same as
  // other governance-affecting settings (integration credentials, etc.).
  @Roles(...ADMIN_ONLY)
  @Put()
  update(@Param('applicationId') applicationId: string, @Body() dto: UpdateAutomationPolicyDto) {
    return this.policyService.upsertPolicyForApplication(applicationId, dto);
  }
}
