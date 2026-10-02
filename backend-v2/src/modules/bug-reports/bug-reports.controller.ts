import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { APPROVAL_ROLES, OPERATIONAL_ROLES } from '../../common/role-groups';
import { BugReportsService } from './bug-reports.service';
import { UpdateBugReportDto } from './dto/update-bug-report.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class BugReportsController {
  constructor(private readonly bugReportsService: BugReportsService) {}

  @Get('applications/:applicationId/bug-reports')
  list(@Param('applicationId') applicationId: string) {
    return this.bugReportsService.list(applicationId);
  }

  @Get('bug-reports/:id')
  get(@Param('id') id: string) {
    return this.bugReportsService.get(id);
  }

  @Roles(...OPERATIONAL_ROLES)
  @Post('executions/:executionId/generate-bug-report')
  generateFromExecution(@Param('executionId') executionId: string) {
    return this.bugReportsService.generateFromExecution(executionId);
  }

  @Roles(...OPERATIONAL_ROLES)
  @Put('bug-reports/:id')
  update(@Param('id') id: string, @Body() dto: UpdateBugReportDto) {
    return this.bugReportsService.update(id, dto);
  }

  @Roles(...OPERATIONAL_ROLES)
  @Delete('bug-reports/:id')
  remove(@Param('id') id: string) {
    return this.bugReportsService.remove(id);
  }

  // Pushing to Jira is an external, approval-worthy action — same role gate as
  // IntegrationsController's sync().
  @Roles(...APPROVAL_ROLES)
  @Post('bug-reports/:id/submit')
  submit(@Param('id') id: string) {
    return this.bugReportsService.submit(id);
  }
}
