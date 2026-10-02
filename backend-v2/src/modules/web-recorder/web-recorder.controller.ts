import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { APPROVAL_ROLES, OPERATIONAL_ROLES } from '../../common/role-groups';
import { WebRecordingSessionService } from './web-recording-session.service';
import { WebRecorderRuntimeService } from './web-recorder-runtime.service';
import { WebRecorderFlowBuilderService } from './flow-builder';
import { StartRecordingDto } from './dto/start-recording.dto';
import { UpdateRecordingStepDto } from './dto/update-recording-step.dto';
import { ReorderRecordingStepsDto } from './dto/reorder-recording-steps.dto';
import { ConvertRecordingDto } from './dto/convert-recording.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class WebRecorderController {
  constructor(
    private readonly sessions: WebRecordingSessionService,
    private readonly runtime: WebRecorderRuntimeService,
    private readonly flowBuilder: WebRecorderFlowBuilderService,
  ) {}

  @Roles(...OPERATIONAL_ROLES)
  @Post('applications/:applicationId/recording-sessions')
  async start(
    @Param('applicationId') applicationId: string,
    @Body() dto: StartRecordingDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const session = await this.sessions.create(
      applicationId,
      dto.targetUrl,
      dto.framework ?? 'PLAYWRIGHT',
      user.id,
    );
    // Fire-and-forget, same shape as ScannerService.startScan's own
    // this.runScan(...).catch(...) — the caller gets the session row back
    // immediately and follows progress by polling GET .../:id.
    this.runtime.launch(session.id, dto.targetUrl).catch(async (err) => {
      await this.sessions
        .markStatus(session.id, ['LAUNCHING'], 'FAILED', {
          endedAt: new Date(),
          errorMessage: (err as Error).message,
        })
        .catch(() => undefined);
    });
    return session;
  }

  @Get('applications/:applicationId/recording-sessions')
  list(@Param('applicationId') applicationId: string) {
    return this.sessions.list(applicationId);
  }

  @Get('recording-sessions/:id')
  get(@Param('id') id: string) {
    return this.sessions.get(id);
  }

  @Roles(...OPERATIONAL_ROLES)
  @Post('recording-sessions/:id/pause')
  async pause(@Param('id') id: string) {
    await this.sessions.markStatus(id, ['RECORDING'], 'PAUSED');
    this.runtime.pause(id);
    return this.sessions.get(id);
  }

  @Roles(...OPERATIONAL_ROLES)
  @Post('recording-sessions/:id/resume')
  async resume(@Param('id') id: string) {
    await this.sessions.markStatus(id, ['PAUSED'], 'RECORDING');
    this.runtime.resume(id);
    return this.sessions.get(id);
  }

  @Roles(...OPERATIONAL_ROLES)
  @Post('recording-sessions/:id/stop')
  async stop(@Param('id') id: string) {
    await this.sessions.markStatus(id, ['RECORDING', 'PAUSED'], 'STOPPED', { endedAt: new Date() });
    await this.runtime.close(id);
    return this.sessions.get(id);
  }

  @Roles(...OPERATIONAL_ROLES)
  @Post('recording-sessions/:id/cancel')
  async cancel(@Param('id') id: string) {
    await this.sessions.markStatus(id, ['LAUNCHING', 'RECORDING', 'PAUSED'], 'CANCELLED', { endedAt: new Date() });
    await this.runtime.close(id);
    return this.sessions.get(id);
  }

  @Roles(...OPERATIONAL_ROLES)
  @Put('recording-sessions/:sessionId/steps/:stepId')
  updateStep(
    @Param('sessionId') sessionId: string,
    @Param('stepId') stepId: string,
    @Body() dto: UpdateRecordingStepDto,
  ) {
    return this.sessions.updateStep(sessionId, stepId, dto);
  }

  @Roles(...OPERATIONAL_ROLES)
  @Delete('recording-sessions/:sessionId/steps/:stepId')
  deleteStep(@Param('sessionId') sessionId: string, @Param('stepId') stepId: string) {
    return this.sessions.deleteStep(sessionId, stepId);
  }

  @Roles(...OPERATIONAL_ROLES)
  @Put('recording-sessions/:id/steps/reorder')
  reorder(@Param('id') id: string, @Body() dto: ReorderRecordingStepsDto) {
    return this.sessions.reorderSteps(id, dto.orderedStepIds);
  }

  @Roles(...OPERATIONAL_ROLES)
  @Post('recording-sessions/:id/convert')
  convert(@Param('id') id: string, @Body() dto: ConvertRecordingDto) {
    return this.flowBuilder.convert(id, dto);
  }

  @Roles(...APPROVAL_ROLES)
  @Delete('recording-sessions/:id')
  remove(@Param('id') id: string) {
    return this.sessions.remove(id);
  }
}
