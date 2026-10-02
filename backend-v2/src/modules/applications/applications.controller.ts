import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApplicationsService } from './applications.service';
import { CreateApplicationDto } from './dto/create-application.dto';
import { UpdateApplicationDto } from './dto/update-application.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { APPROVAL_ROLES, OPERATIONAL_ROLES } from '../../common/role-groups';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('applications')
export class ApplicationsController {
  constructor(private readonly applicationsService: ApplicationsService) {}

  @Get()
  list() {
    return this.applicationsService.list();
  }

  // Registered before ':id' — Nest/Express matches routes in declaration
  // order, so a literal path here must come first or ':id' would swallow
  // 'fleet-overview' as if it were an application id.
  @Get('fleet-overview')
  listFleet() {
    return this.applicationsService.listWithQualityScores();
  }

  @Get('fleet-overview/export.csv')
  async exportFleetCsv(@Res() res: Response) {
    const csv = await this.applicationsService.exportFleetCsv();
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="testpilot-fleet-report.csv"');
    res.send(csv);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.applicationsService.get(id);
  }

  @Roles(...OPERATIONAL_ROLES)
  @Post()
  create(@Body() dto: CreateApplicationDto) {
    return this.applicationsService.create(dto);
  }

  @Roles(...OPERATIONAL_ROLES)
  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateApplicationDto) {
    return this.applicationsService.update(id, dto);
  }

  @Roles(...APPROVAL_ROLES)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.applicationsService.remove(id);
  }
}
