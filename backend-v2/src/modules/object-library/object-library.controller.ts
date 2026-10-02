import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { APPROVAL_ROLES, OPERATIONAL_ROLES } from '../../common/role-groups';
import { CreateObjectDto } from './dto/create-object.dto';
import { PromoteManyDto } from './dto/promote-many.dto';
import { PromoteScanObjectDto } from './dto/promote-scan-object.dto';
import { UpdateObjectDto } from './dto/update-object.dto';
import { ObjectLibraryService } from './object-library.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class ObjectLibraryController {
  constructor(private readonly objectLibraryService: ObjectLibraryService) {}

  @Get('applications/:applicationId/object-library')
  list(@Param('applicationId') applicationId: string) {
    return this.objectLibraryService.list(applicationId);
  }

  @Roles(...OPERATIONAL_ROLES)
  @Post('applications/:applicationId/object-library')
  create(@Param('applicationId') applicationId: string, @Body() dto: CreateObjectDto) {
    return this.objectLibraryService.create(applicationId, dto);
  }

  @Get('object-library/:id')
  get(@Param('id') id: string) {
    return this.objectLibraryService.get(id);
  }

  @Roles(...OPERATIONAL_ROLES)
  @Put('object-library/:id')
  update(@Param('id') id: string, @Body() dto: UpdateObjectDto) {
    return this.objectLibraryService.update(id, dto);
  }

  @Roles(...APPROVAL_ROLES)
  @Delete('object-library/:id')
  remove(@Param('id') id: string) {
    return this.objectLibraryService.remove(id);
  }

  @Roles(...OPERATIONAL_ROLES)
  @Post('scan-objects/:scanObjectId/promote')
  promote(@Param('scanObjectId') scanObjectId: string, @Body() dto: PromoteScanObjectDto) {
    return this.objectLibraryService.promoteFromScanObject(scanObjectId, dto);
  }

  @Roles(...OPERATIONAL_ROLES)
  @Post('scan-pages/:scanPageId/promote-all')
  promoteAll(@Param('scanPageId') scanPageId: string) {
    return this.objectLibraryService.promoteAllFromScanPage(scanPageId);
  }

  // For the Scanner page's synthetic "Common (shared across pages)" tab,
  // which has no real ScanPage id to promote-all against.
  @Roles(...OPERATIONAL_ROLES)
  @Post('scan-objects/promote-many')
  promoteMany(@Body() dto: PromoteManyDto) {
    return this.objectLibraryService.promoteMany(dto.scanObjectIds);
  }
}
