import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { stringify } from 'csv-stringify/sync';
import { PrismaService } from '../../prisma/prisma.service';
import { ReportingService, QualityScoreResult } from '../reporting/reporting.service';
import { CreateApplicationDto } from './dto/create-application.dto';
import { UpdateApplicationDto } from './dto/update-application.dto';

export interface FleetApplicationOverview {
  id: string;
  name: string;
  qualityScore: QualityScoreResult;
  automationCoverage: number;
  objectHealthPct: number | null;
  passRate: number;
  totalObjects: number;
  totalTestCases: number;
  lastScanAt: string | null;
}

@Injectable()
export class ApplicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reportingService: ReportingService,
  ) {}

  list() {
    return this.prisma.application.findMany({ orderBy: { createdAt: 'desc' } });
  }

  // Sequential, not Promise.all — a fleet endpoint fanning out N concurrent
  // queries against the local Postgres adapter is exactly the load shape
  // that has repeatedly wedged it (see runQualityWatch for the same call).
  async listWithQualityScores() {
    const applications = await this.list();
    const rows: FleetApplicationOverview[] = [];
    for (const application of applications) {
      const summary = await this.reportingService.getSummary(application.id);
      const qualityScore = await this.reportingService.getQualityScore(application.id);
      const lastScan = await this.prisma.scanSession.findFirst({
        where: { applicationId: application.id },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      });
      rows.push({
        id: application.id,
        name: application.name,
        qualityScore,
        automationCoverage: summary.automationCoverage,
        objectHealthPct:
          summary.totalObjects > 0 ? Math.round((summary.objectHealth.working / summary.totalObjects) * 100) : null,
        passRate: summary.passRate,
        totalObjects: summary.totalObjects,
        totalTestCases: summary.totalTestCases,
        lastScanAt: lastScan?.createdAt.toISOString() ?? null,
      });
    }
    return rows;
  }

  async exportFleetCsv(): Promise<string> {
    const rows = await this.listWithQualityScores();
    const table = [
      ['Application', 'Quality score', 'Automation coverage', 'Object health', 'Pass rate', 'Last scan'],
      ...rows.map((r) => [
        r.name,
        r.qualityScore.score != null ? String(r.qualityScore.score) : '',
        `${r.automationCoverage}%`,
        r.objectHealthPct != null ? `${r.objectHealthPct}%` : '',
        `${r.passRate}%`,
        r.lastScanAt ?? '',
      ]),
    ];
    return stringify(table);
  }

  async get(id: string) {
    const application = await this.prisma.application.findUnique({ where: { id } });
    if (!application) {
      throw new NotFoundException(`Application ${id} not found`);
    }
    return application;
  }

  // No DB-level unique constraint on name (SQLite text comparison is
  // case-sensitive by default, and "same app, different casing/whitespace"
  // is exactly the duplicate a QA lead would actually create by accident)
  // — checked here in JS instead, same pattern as every other duplicate
  // guard in this codebase (e.g. scanner.service.ts's blocked-conflict
  // shape).
  private async assertNameNotTaken(name: string, excludeId?: string) {
    const normalized = name.trim().toLowerCase();
    const existing = await this.prisma.application.findMany({ select: { id: true, name: true } });
    const clash = existing.find((a) => a.id !== excludeId && a.name.trim().toLowerCase() === normalized);
    if (clash) {
      throw new ConflictException({
        statusCode: 409,
        blocked: true,
        reasons: [`An application named "${clash.name}" already exists.`],
        nextActions: ['Use a different name, or open the existing application instead.'],
      });
    }
  }

  async create(dto: CreateApplicationDto) {
    await this.assertNameNotTaken(dto.name);
    // appType/defaultFramework have non-nullable schema defaults — those only
    // apply when the key is omitted from the create() call, not when the
    // client sends an explicit `null` (e.g. a select field submitted before
    // its value synced). Passing null through crashes Prisma with a raw 500
    // instead of just falling back to the default, so strip it here.
    const { appType, defaultFramework, ...rest } = dto;
    return this.prisma.application.create({
      data: {
        ...rest,
        ...(appType != null && { appType }),
        ...(defaultFramework != null && { defaultFramework }),
      },
    });
  }

  async update(id: string, dto: UpdateApplicationDto) {
    await this.get(id);
    if (dto.name != null) await this.assertNameNotTaken(dto.name, id);
    const { appType, defaultFramework, ...rest } = dto;
    return this.prisma.application.update({
      where: { id },
      data: {
        ...rest,
        ...(appType != null && { appType }),
        ...(defaultFramework != null && { defaultFramework }),
      },
    });
  }

  async remove(id: string) {
    await this.get(id);
    await this.prisma.application.delete({ where: { id } });
    return { success: true };
  }
}
