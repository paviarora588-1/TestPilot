import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ADMIN_ONLY, APPROVAL_ROLES, OPERATIONAL_ROLES } from '../../common/role-groups';
import { AutomationBuilderService } from './automation-builder.service';
import { CreateFlowDto } from './dto/create-flow.dto';
import { GenerateFromTestCaseDto } from './dto/generate-from-test-case.dto';
import { UpdateFlowGraphDto } from './dto/update-flow-graph.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class AutomationBuilderController {
  constructor(private readonly automationBuilderService: AutomationBuilderService) {}

  @Get('automation-builder/palette')
  getPalette() {
    return this.automationBuilderService.getPalette();
  }

  @Get('applications/:applicationId/automation-flows')
  list(@Param('applicationId') applicationId: string) {
    return this.automationBuilderService.list(applicationId);
  }

  @Roles(...OPERATIONAL_ROLES)
  @Post('applications/:applicationId/automation-flows')
  create(@Param('applicationId') applicationId: string, @Body() dto: CreateFlowDto) {
    return this.automationBuilderService.create(applicationId, dto);
  }

  @Roles(...OPERATIONAL_ROLES)
  @Post('applications/:applicationId/automation-flows/generate-from-test-case')
  generateFromTestCase(@Param('applicationId') applicationId: string, @Body() dto: GenerateFromTestCaseDto) {
    return this.automationBuilderService.generateFromTestCase(applicationId, dto.testCaseId);
  }

  @Roles(...ADMIN_ONLY)
  @Post('applications/:applicationId/automation-flows/generate-from-test-case-with-codex')
  generateFromTestCaseWithCodex(@Param('applicationId') applicationId: string, @Body() dto: GenerateFromTestCaseDto) {
    return this.automationBuilderService.generateFromTestCaseWithCodex(applicationId, dto.testCaseId);
  }

  @Get('automation-flows/:id')
  get(@Param('id') id: string) {
    return this.automationBuilderService.get(id);
  }

  @Roles(...OPERATIONAL_ROLES)
  @Put('automation-flows/:id/graph')
  updateGraph(@Param('id') id: string, @Body() dto: UpdateFlowGraphDto) {
    return this.automationBuilderService.updateGraph(id, dto.graphJson);
  }

  @Get('automation-flows/:id/validate')
  validate(@Param('id') id: string) {
    return this.automationBuilderService.validate(id);
  }

  @Roles(...APPROVAL_ROLES)
  @Delete('automation-flows/:id')
  remove(@Param('id') id: string) {
    return this.automationBuilderService.remove(id);
  }
}
