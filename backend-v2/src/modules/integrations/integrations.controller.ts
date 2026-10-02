import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ADMIN_ONLY, APPROVAL_ROLES, OPERATIONAL_ROLES } from '../../common/role-groups';
import { AnalyzeStoryDto } from './dto/analyze-story.dto';
import { CreateIntegrationConfigDto } from './dto/create-integration-config.dto';
import { IntegrationsService } from './integrations.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class IntegrationsController {
  constructor(private readonly integrationsService: IntegrationsService) {}

  @Get('applications/:applicationId/integrations')
  list(@Param('applicationId') applicationId: string) {
    return this.integrationsService.list(applicationId);
  }

  // Credential management is Admin-only.
  @Roles(...ADMIN_ONLY)
  @Post('applications/:applicationId/integrations')
  create(@Param('applicationId') applicationId: string, @Body() dto: CreateIntegrationConfigDto) {
    return this.integrationsService.createConfig(applicationId, dto);
  }

  @Roles(...ADMIN_ONLY)
  @Delete('integrations/:id')
  remove(@Param('id') id: string) {
    return this.integrationsService.remove(id);
  }

  // Triggering an already-configured sync is a QA Lead approval action.
  @Roles(...APPROVAL_ROLES)
  @Post('integrations/:id/sync')
  sync(@Param('id') id: string) {
    return this.integrationsService.sync(id);
  }

  @Get('integrations/:id/sync-logs')
  listSyncLogs(@Param('id') id: string) {
    return this.integrationsService.listSyncLogs(id);
  }

  @Roles(...OPERATIONAL_ROLES)
  @Post('integrations/:id/analyze-story')
  analyzeStory(@Param('id') id: string, @Body() dto: AnalyzeStoryDto) {
    return this.integrationsService.analyzeStory(id, dto);
  }
}
