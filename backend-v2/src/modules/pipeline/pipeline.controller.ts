import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { OPERATIONAL_ROLES } from '../../common/role-groups';
import { AutoAutomateDto } from './dto/auto-automate.dto';
import { PipelineService } from './pipeline.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class PipelineController {
  constructor(private readonly pipelineService: PipelineService) {}

  @Roles(...OPERATIONAL_ROLES)
  @Post('applications/:applicationId/auto-automate')
  autoAutomate(
    @Param('applicationId') applicationId: string,
    @Body() dto: AutoAutomateDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.pipelineService.autoAutomate(applicationId, dto.testCaseIds, user.id, { engine: dto.engine });
  }

  // Job-based version — returns immediately, poll auto-automate-jobs/:id.
  // The backend keeps running the batch regardless of the browser tab/route
  // that started it, unlike the synchronous endpoint above.
  @Roles(...OPERATIONAL_ROLES)
  @Post('applications/:applicationId/auto-automate-job')
  startAutoAutomateJob(
    @Param('applicationId') applicationId: string,
    @Body() dto: AutoAutomateDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.pipelineService.startAutoAutomateJob(applicationId, dto.testCaseIds, user.id, { engine: dto.engine });
  }

  @Get('auto-automate-jobs/:jobId')
  getAutoAutomateJob(@Param('jobId') jobId: string) {
    return this.pipelineService.getAutoAutomateJob(jobId);
  }
}
