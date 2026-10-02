import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ADMIN_ONLY, APPROVAL_ROLES, OPERATIONAL_ROLES } from '../../common/role-groups';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { CreateTestCaseDto } from './dto/create-test-case.dto';
import { GenerateTestCasesDto } from './dto/generate-test-cases.dto';
import { GenerateWithCodexDto } from './dto/generate-with-codex.dto';
import { UpdateTestCaseDto } from './dto/update-test-case.dto';
import { SaveDataRequirementsDto } from './dto/save-data-requirements.dto';
import { TestCasesService } from './test-cases.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class TestCasesController {
  constructor(private readonly testCasesService: TestCasesService) {}

  @Get('applications/:applicationId/test-cases')
  list(@Param('applicationId') applicationId: string) {
    return this.testCasesService.list(applicationId);
  }

  @Roles(...OPERATIONAL_ROLES)
  @Post('applications/:applicationId/test-cases')
  create(@Param('applicationId') applicationId: string, @Body() dto: CreateTestCaseDto) {
    return this.testCasesService.create(applicationId, dto);
  }

  @Roles(...OPERATIONAL_ROLES)
  @Post('applications/:applicationId/test-cases/generate-with-ai')
  generateWithAi(@Param('applicationId') applicationId: string, @Body() dto: GenerateTestCasesDto) {
    return this.testCasesService.generateWithAi(applicationId, dto);
  }

  // Job-based version: returns immediately, poll generation-jobs/:id for
  // real progress instead of one long-blocking request with no feedback.
  @Roles(...OPERATIONAL_ROLES)
  @Post('applications/:applicationId/test-cases/generate-with-ai-job')
  startGenerationJob(@Param('applicationId') applicationId: string, @Body() dto: GenerateTestCasesDto) {
    return this.testCasesService.startGenerationJob(applicationId, dto);
  }

  @Get('test-case-generation-jobs/:jobId')
  getGenerationJob(@Param('jobId') jobId: string) {
    return this.testCasesService.getGenerationJob(jobId);
  }

  @Roles(...OPERATIONAL_ROLES)
  @Post('test-case-generation-jobs/:jobId/cancel')
  cancelGenerationJob(@Param('jobId') jobId: string) {
    return this.testCasesService.cancelGenerationJob(jobId);
  }

  // Internal/admin-only Codex-powered path — source-aware (Knowledge Base,
  // linked Jira story, Zephyr, scanned objects, free-text prompt all
  // independently optional), reuses the same job/polling mechanism above.
  @Roles(...ADMIN_ONLY)
  @Post('applications/:applicationId/test-cases/generate-with-codex-job')
  startCodexGenerationJob(
    @Param('applicationId') applicationId: string,
    @Body() dto: GenerateWithCodexDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.testCasesService.startCodexGenerationJob(applicationId, dto, user.id);
  }

  @Roles(...ADMIN_ONLY)
  @Get('test-case-generation-jobs/:jobId/codex-prompts')
  getCodexGenerationPrompts(@Param('jobId') jobId: string) {
    return this.testCasesService.getCodexGenerationPrompts(jobId);
  }

  @Roles(...OPERATIONAL_ROLES)
  @Post('applications/:applicationId/test-cases/import')
  @UseInterceptors(FileInterceptor('file'))
  async import(@Param('applicationId') applicationId: string, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file uploaded');
    const isExcel = file.originalname.toLowerCase().endsWith('.xlsx');
    return isExcel
      ? this.testCasesService.importExcel(applicationId, file.buffer)
      : this.testCasesService.importCsv(applicationId, file.buffer);
  }

  @Get('test-cases/:id')
  get(@Param('id') id: string) {
    return this.testCasesService.get(id);
  }

  @Roles(...OPERATIONAL_ROLES)
  @Put('test-cases/:id')
  update(@Param('id') id: string, @Body() dto: UpdateTestCaseDto) {
    return this.testCasesService.update(id, dto);
  }

  @Roles(...OPERATIONAL_ROLES)
  @Post('test-cases/:id/analyze')
  analyze(@Param('id') id: string) {
    return this.testCasesService.analyze(id);
  }

  @Get('test-cases/:id/regression-recommendation')
  getRegressionRecommendation(@Param('id') id: string) {
    return this.testCasesService.getRegressionRecommendation(id);
  }

  @Get('test-cases/:id/data-requirements')
  getDataRequirements(@Param('id') id: string) {
    return this.testCasesService.getDataRequirements(id);
  }

  @Roles(...OPERATIONAL_ROLES)
  @Post('test-cases/:id/data-requirements')
  saveDataRequirements(@Param('id') id: string, @Body() dto: SaveDataRequirementsDto) {
    return this.testCasesService.saveDataRequirements(id, dto.values);
  }

  @Roles(...APPROVAL_ROLES)
  @Delete('test-cases/:id')
  remove(@Param('id') id: string) {
    return this.testCasesService.remove(id);
  }
}
