import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { OPERATIONAL_ROLES } from '../../common/role-groups';
import { ScriptGeneratorService } from './script-generator.service';
import { GenerateScriptDto } from './dto/generate-script.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class ScriptGeneratorController {
  constructor(private readonly scriptGeneratorService: ScriptGeneratorService) {}

  @Roles(...OPERATIONAL_ROLES)
  @Post('automation-flows/:flowId/generate-script')
  generate(@Param('flowId') flowId: string, @Body() dto?: GenerateScriptDto) {
    return this.scriptGeneratorService.generateForFlow(flowId, dto?.sapScriptLanguage);
  }

  @Roles(...OPERATIONAL_ROLES)
  @Post('automation-flows/:flowId/generate-script-with-codex')
  generateWithCodex(@Param('flowId') flowId: string) {
    return this.scriptGeneratorService.generateForFlowWithCodex(flowId);
  }

  @Get('automation-flows/:flowId/scripts')
  listForFlow(@Param('flowId') flowId: string) {
    return this.scriptGeneratorService.listForFlow(flowId);
  }

  @Get('scripts/:id')
  get(@Param('id') id: string) {
    return this.scriptGeneratorService.getScript(id);
  }

  @Roles(...OPERATIONAL_ROLES)
  @Post('scripts/:id/review')
  review(@Param('id') id: string) {
    return this.scriptGeneratorService.reviewScript(id);
  }
}
