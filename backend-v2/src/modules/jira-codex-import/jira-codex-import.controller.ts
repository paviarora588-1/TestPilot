import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { ADMIN_ONLY } from '../../common/role-groups';
import { CreateJiraStoryImportDto } from './dto/create-jira-story-import.dto';
import { JiraCodexImportService } from './jira-codex-import.service';

// Admin-only, on purpose: this is the internal Codex-CLI-powered path
// (see JiraStoryImport's schema comment) — never meant to be something a
// regular TestPilot user/customer can trigger themselves.
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...ADMIN_ONLY)
@Controller()
export class JiraCodexImportController {
  constructor(private readonly service: JiraCodexImportService) {}

  @Get('applications/:applicationId/jira-story-imports')
  list(@Param('applicationId') applicationId: string) {
    return this.service.list(applicationId);
  }

  @Get('jira-story-imports/:id')
  get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Post('applications/:applicationId/jira-story-imports')
  create(
    @Param('applicationId') applicationId: string,
    @Body() dto: CreateJiraStoryImportDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.createImport(applicationId, dto.integrationConfigId, dto.storyUrlOrKey, user.id);
  }

  @Post('jira-story-imports/:id/generate-test-cases')
  generateTestCases(@Param('id') id: string) {
    return this.service.generateTestCases(id);
  }
}
