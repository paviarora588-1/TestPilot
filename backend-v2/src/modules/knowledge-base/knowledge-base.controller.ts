import { BadRequestException, Controller, Delete, Get, Param, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { APPROVAL_ROLES, OPERATIONAL_ROLES } from '../../common/role-groups';
import { KnowledgeBaseService } from './knowledge-base.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class KnowledgeBaseController {
  constructor(private readonly knowledgeBaseService: KnowledgeBaseService) {}

  @Get('applications/:applicationId/knowledge-sources')
  list(@Param('applicationId') applicationId: string) {
    return this.knowledgeBaseService.list(applicationId);
  }

  @Roles(...OPERATIONAL_ROLES)
  @Post('applications/:applicationId/knowledge-sources')
  @UseInterceptors(FileInterceptor('file'))
  async upload(@Param('applicationId') applicationId: string, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file uploaded');
    return this.knowledgeBaseService.upload(applicationId, file);
  }

  @Get('knowledge-sources/:id')
  get(@Param('id') id: string) {
    return this.knowledgeBaseService.get(id);
  }

  @Roles(...APPROVAL_ROLES)
  @Delete('knowledge-sources/:id')
  remove(@Param('id') id: string) {
    return this.knowledgeBaseService.remove(id);
  }
}
