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
import { CreateDataBindingDto } from './dto/create-data-binding.dto';
import { CreateTestDataItemDto, UpdateTestDataItemDto } from './dto/create-test-data-item.dto';
import { CreateTestDataSetDto } from './dto/create-test-data-set.dto';
import { GenerateTestDataDto } from './dto/generate-test-data.dto';
import { TestDataService } from './test-data.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class TestDataController {
  constructor(private readonly testDataService: TestDataService) {}

  @Get('placeholder-tokens')
  supportedPlaceholders() {
    return this.testDataService.supportedPlaceholders();
  }

  @Get('applications/:applicationId/test-data-sets')
  listSets(@Param('applicationId') applicationId: string) {
    return this.testDataService.listSets(applicationId);
  }

  @Roles(...OPERATIONAL_ROLES)
  @Post('applications/:applicationId/test-data-sets')
  createSet(@Param('applicationId') applicationId: string, @Body() dto: CreateTestDataSetDto) {
    return this.testDataService.createSet(applicationId, dto);
  }

  @Get('test-data-sets/:id')
  getSet(@Param('id') id: string) {
    return this.testDataService.getSet(id);
  }

  @Roles(...OPERATIONAL_ROLES)
  @Post('applications/:applicationId/test-data-sets/generate-with-ai')
  generateSetWithAi(@Param('applicationId') applicationId: string, @Body() dto: GenerateTestDataDto) {
    return this.testDataService.generateSetWithAi(applicationId, dto);
  }

  @Roles(...ADMIN_ONLY)
  @Post('applications/:applicationId/test-data-sets/generate-with-codex')
  generateSetWithCodex(@Param('applicationId') applicationId: string, @Body() dto: GenerateTestDataDto) {
    return this.testDataService.generateSetWithCodex(applicationId, dto);
  }

  @Roles(...APPROVAL_ROLES)
  @Delete('test-data-sets/:id')
  deleteSet(@Param('id') id: string) {
    return this.testDataService.deleteSet(id);
  }

  @Roles(...OPERATIONAL_ROLES)
  @Post('test-data-sets/:id/items')
  createItem(@Param('id') id: string, @Body() dto: CreateTestDataItemDto) {
    return this.testDataService.createItem(id, dto);
  }

  @Roles(...OPERATIONAL_ROLES)
  @Post('test-data-sets/:id/items/import')
  @UseInterceptors(FileInterceptor('file'))
  async importItems(@Param('id') id: string, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file uploaded');
    const name = file.originalname.toLowerCase();
    if (name.endsWith('.xlsx')) return this.testDataService.importExcel(id, file.buffer);
    if (name.endsWith('.json')) return this.testDataService.importJson(id, file.buffer);
    return this.testDataService.importCsv(id, file.buffer);
  }

  @Roles(...OPERATIONAL_ROLES)
  @Put('test-data-items/:id')
  updateItem(@Param('id') id: string, @Body() dto: UpdateTestDataItemDto) {
    return this.testDataService.updateItem(id, dto);
  }

  @Roles(...APPROVAL_ROLES)
  @Delete('test-data-items/:id')
  deleteItem(@Param('id') id: string) {
    return this.testDataService.deleteItem(id);
  }

  @Get('test-data-items/:id/resolve')
  resolveItem(@Param('id') id: string) {
    return this.testDataService.resolveItem(id);
  }

  @Roles(...OPERATIONAL_ROLES)
  @Post('applications/:applicationId/data-bindings')
  createBinding(@Param('applicationId') applicationId: string, @Body() dto: CreateDataBindingDto) {
    return this.testDataService.createBinding(applicationId, dto);
  }

  @Get('test-cases/:testCaseId/data-bindings')
  listBindingsForTestCase(@Param('testCaseId') testCaseId: string) {
    return this.testDataService.listBindingsForTestCase(testCaseId);
  }

  @Roles(...APPROVAL_ROLES)
  @Delete('data-bindings/:id')
  deleteBinding(@Param('id') id: string) {
    return this.testDataService.deleteBinding(id);
  }
}
