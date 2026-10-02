import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { ADMIN_ONLY, OPERATIONAL_ROLES } from '../../common/role-groups';
import { AiEngineeringService } from './ai-engineering.service';
import { CreateAiTaskDto } from './dto/create-ai-task.dto';
import { SendChatMessageDto } from './dto/send-chat-message.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class AiEngineeringController {
  constructor(private readonly aiEngineering: AiEngineeringService) {}

  // Anyone who can use TestPilot day-to-day can report a bug in it — same
  // gate as scanning, building, executing.
  @Roles(...OPERATIONAL_ROLES)
  @Post('ai-engineering/tasks')
  create(@Body() dto: CreateAiTaskDto, @CurrentUser() user: AuthenticatedUser) {
    return this.aiEngineering.createTask(dto, user.id);
  }

  @Get('ai-engineering/tasks')
  list() {
    return this.aiEngineering.list();
  }

  // Read-only, no isolation needed — runs the real jest suite against the
  // live backend-v2 project, same trust level as list()/get() above.
  @Get('ai-engineering/test-suite')
  getTestSuite() {
    return this.aiEngineering.getTestSuite();
  }

  @Get('ai-engineering/test-suite/frontend')
  getFrontendTestSuite() {
    return this.aiEngineering.getFrontendTestSuite();
  }

  // Real browser E2E — minutes, not seconds. Same trust level as the other
  // test-suite routes (read-only from the caller's perspective), just slow.
  @Get('ai-engineering/test-suite/e2e')
  getE2ETestSuite() {
    return this.aiEngineering.getE2ETestSuite();
  }

  @Get('ai-engineering/tasks/:id')
  get(@Param('id') id: string) {
    return this.aiEngineering.get(id);
  }

  // Same gate as reporting a bug in the first place — this only re-attempts
  // the fix in a fresh isolated workspace, it never touches real source.
  @Roles(...OPERATIONAL_ROLES)
  @Post('ai-engineering/tasks/:id/retry')
  retry(@Param('id') id: string) {
    return this.aiEngineering.retry(id);
  }

  // Admin-only, not the usual APPROVAL_ROLES (QA Lead + Admin) — this
  // applies AI-written changes to TestPilot's own source, a materially
  // bigger blast radius than deleting a scan or approving a self-heal.
  @Roles(...ADMIN_ONLY)
  @Post('ai-engineering/tasks/:id/approve')
  approve(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.aiEngineering.approve(id, user.id);
  }

  @Roles(...ADMIN_ONLY)
  @Post('ai-engineering/tasks/:id/reject')
  reject(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.aiEngineering.reject(id, user.id);
  }

  // Chat with the team — same operational gate as reporting a bug, since
  // it's just asking a question, not applying any change.
  @Get('ai-engineering/chat/:personaId')
  listChatMessages(@Param('personaId') personaId: string) {
    return this.aiEngineering.listChatMessages(personaId);
  }

  @Roles(...OPERATIONAL_ROLES)
  @Post('ai-engineering/chat/:personaId')
  sendChatMessage(
    @Param('personaId') personaId: string,
    @Body() body: SendChatMessageDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.aiEngineering.sendChatMessage(personaId, body.content, user.id);
  }
}
