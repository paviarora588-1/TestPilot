import { Controller, Get, Param, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ReportingService } from './reporting.service';

@UseGuards(JwtAuthGuard)
@Controller('applications/:applicationId/reports')
export class ReportingController {
  constructor(private readonly reportingService: ReportingService) {}

  @Get('summary')
  getSummary(@Param('applicationId') applicationId: string) {
    return this.reportingService.getSummary(applicationId);
  }

  @Get('coverage')
  getCoverage(@Param('applicationId') applicationId: string) {
    return this.reportingService.getModuleCoverage(applicationId);
  }

  @Get('trends')
  getTrends(@Param('applicationId') applicationId: string) {
    return this.reportingService.getFailureTrends(applicationId);
  }

  @Get('failure-breakdown')
  getFailureBreakdown(@Param('applicationId') applicationId: string) {
    return this.reportingService.getFailureBreakdown(applicationId);
  }

  @Get('quality-score')
  getQualityScore(@Param('applicationId') applicationId: string) {
    return this.reportingService.getQualityScore(applicationId);
  }

  @Get('export.csv')
  async exportCsv(@Param('applicationId') applicationId: string, @Res() res: Response) {
    const csv = await this.reportingService.exportCsv(applicationId);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="testpilot-report.csv"');
    res.send(csv);
  }

  @Get('export.xlsx')
  async exportExcel(@Param('applicationId') applicationId: string, @Res() res: Response) {
    const buffer = await this.reportingService.exportExcel(applicationId);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="testpilot-report.xlsx"');
    res.send(Buffer.from(buffer));
  }

  @Get('export.pdf')
  async exportPdf(@Param('applicationId') applicationId: string, @Res() res: Response) {
    const buffer = await this.reportingService.exportPdf(applicationId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="testpilot-report.pdf"');
    res.send(buffer);
  }
}
