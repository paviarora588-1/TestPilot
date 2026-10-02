import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { APPROVAL_ROLES, OPERATIONAL_ROLES } from '../../common/role-groups';
import { RunSuiteDto } from './dto/run-suite.dto';
import { ExecutionService } from './execution.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class ExecutionController {
  constructor(private readonly executionService: ExecutionService) {}

  @Roles(...OPERATIONAL_ROLES)
  @Post('scripts/:scriptId/execute')
  execute(@Param('scriptId') scriptId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.executionService.executeScript(scriptId, user.id);
  }

  // Pre-flight dry run — locates every bound object, never clicks/types/
  // submits. Same role gate as Execute since it still launches a real
  // browser/SAP session, just makes no mutating calls once there.
  @Roles(...OPERATIONAL_ROLES)
  @Post('scripts/:scriptId/validate')
  validate(@Param('scriptId') scriptId: string) {
    return this.executionService.validateScript(scriptId);
  }

  @Roles(...OPERATIONAL_ROLES)
  @Post('executions/:id/run')
  retry(@Param('id') id: string) {
    return this.executionService.retryRun(id);
  }

  @Get('executions/:id')
  get(@Param('id') id: string) {
    return this.executionService.getRun(id);
  }

  @Roles(...APPROVAL_ROLES)
  @Delete('executions/:id')
  remove(@Param('id') id: string) {
    return this.executionService.removeRun(id);
  }

  @Get('applications/:applicationId/executions')
  list(@Param('applicationId') applicationId: string) {
    return this.executionService.listForApplication(applicationId);
  }

  @Roles(...OPERATIONAL_ROLES)
  @Post('applications/:applicationId/execution-suites')
  runSuite(
    @Param('applicationId') applicationId: string,
    @Body() dto: RunSuiteDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.executionService.runSuite(applicationId, dto.scope, dto.scriptIds, user.id);
  }

  @Get('applications/:applicationId/execution-suites')
  listSuites(@Param('applicationId') applicationId: string) {
    return this.executionService.listSuites(applicationId);
  }

  @Get('execution-suites/:id')
  getSuite(@Param('id') id: string) {
    return this.executionService.getSuite(id);
  }

  @Get('applications/:applicationId/auto-heal')
  listAutoHeal(@Param('applicationId') applicationId: string) {
    return this.executionService.listAutoHealSuggestions(applicationId);
  }

  // On-demand quality watch — same live re-verification as the nightly
  // schedule, run right now for one application. Same trust level as
  // Validate: launches a real browser to check locators, never mutates
  // ObjectRepository beyond WORKING/BROKEN status and PENDING suggestions.
  @Roles(...OPERATIONAL_ROLES)
  @Post('applications/:applicationId/quality-watch/run-now')
  runQualityWatchNow(@Param('applicationId') applicationId: string) {
    return this.executionService.runQualityWatchNow(applicationId);
  }

  // Auto-heal approve/reject is the canonical "QA Lead approval" action —
  // it's what actually changes a live ObjectRepository locator.
  @Roles(...APPROVAL_ROLES)
  @Post('auto-heal/:id/approve')
  approveAutoHeal(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.executionService.decideAutoHeal(id, true, user.id);
  }

  @Roles(...APPROVAL_ROLES)
  @Post('auto-heal/:id/reject')
  rejectAutoHeal(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.executionService.decideAutoHeal(id, false, user.id);
  }
}
