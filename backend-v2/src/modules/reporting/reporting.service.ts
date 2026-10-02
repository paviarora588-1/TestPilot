import { Injectable } from '@nestjs/common';
import { stringify } from 'csv-stringify/sync';
import ExcelJS from 'exceljs';
import { chromium } from 'playwright';
import { PrismaService } from '../../prisma/prisma.service';

// Cyan accent to match the app's own palette (see globals.css / the dataviz
// pass this session) — an "emphasis" hue, gray for everything else.
const ACCENT = '#0e7490';
const ACCENT_LIGHT = '#e0f2fe';
const INK = '#111827';
const MUTED = '#6b7280';
const BORDER = '#e5e7eb';

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// How much each dimension counts toward the blended Quality Score. Named and
// exported so both the score itself and any UI explaining it stay in sync
// with the same numbers, and so retuning them later is a one-line change.
export const QUALITY_SCORE_WEIGHTS = {
  automationCoverage: 0.4,
  executionPassRate: 0.35,
  objectHealth: 0.25,
};

export interface QualityScoreComponent {
  label: string;
  value: number; // 0-100
  weight: number; // the weight actually applied, after re-normalizing away any empty category
}

export interface QualityScoreResult {
  // null only when every underlying category is genuinely empty (a brand
  // new application) — never a fabricated number.
  score: number | null;
  components: QualityScoreComponent[];
  executionTrend: Array<{ date: string; passed: number; failed: number }>;
}

@Injectable()
export class ReportingService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary(applicationId: string) {
    const testCases = await this.prisma.testCase.findMany({ where: { applicationId } });
    const objects = await this.prisma.objectRepository.findMany({ where: { applicationId } });
    const scriptCount = await this.prisma.generatedScript.count({ where: { applicationId } });
    const executions = await this.prisma.executionRun.findMany({
      where: { applicationId },
      orderBy: { createdAt: 'desc' },
    });
    const dataSetCount = await this.prisma.testDataSet.count({ where: { applicationId } });
    const flowCount = await this.prisma.automationFlow.count({ where: { applicationId } });

    const automatedCount = testCases.filter((tc) => tc.automationStatus !== 'NOT_STARTED').length;
    const passed = executions.filter((e) => e.status === 'COMPLETED').length;
    const failed = executions.filter((e) => e.status === 'FAILED').length;
    const blocked = executions.filter((e) => e.status === 'BLOCKED').length;

    return {
      totalTestCases: testCases.length,
      automatedTestCases: automatedCount,
      manualTestCases: testCases.length - automatedCount,
      automationCoverage: testCases.length > 0 ? Math.round((automatedCount / testCases.length) * 100) : 0,
      totalObjects: objects.length,
      objectHealth: {
        working: objects.filter((o) => o.verificationStatus === 'WORKING').length,
        broken: objects.filter((o) => o.verificationStatus === 'BROKEN').length,
        unknown: objects.filter((o) => o.verificationStatus === 'UNKNOWN').length,
      },
      totalScripts: scriptCount,
      totalFlows: flowCount,
      totalDataSets: dataSetCount,
      totalExecutions: executions.length,
      passedExecutions: passed,
      failedExecutions: failed,
      blockedExecutions: blocked,
      passRate: executions.length > 0 ? Math.round((passed / executions.length) * 100) : 0,
      latestExecutions: executions.slice(0, 10),
    };
  }

  async getModuleCoverage(applicationId: string) {
    const testCases = await this.prisma.testCase.findMany({ where: { applicationId } });
    const moduleMap = new Map<string, { total: number; automated: number }>();
    for (const tc of testCases) {
      const key = tc.moduleName || 'Unassigned';
      const entry = moduleMap.get(key) ?? { total: 0, automated: 0 };
      entry.total++;
      if (tc.automationStatus !== 'NOT_STARTED') entry.automated++;
      moduleMap.set(key, entry);
    }
    return Array.from(moduleMap.entries())
      .map(([module, { total, automated }]) => ({
        module,
        testCases: total,
        automated,
        coverage: total > 0 ? Math.round((automated / total) * 100) : 0,
      }))
      .sort((a, b) => a.module.localeCompare(b.module));
  }

  // First-run pass rate, by failure category. Reflects each run's CURRENT
  // attempt — retryRun() reuses the same row rather than creating a new one
  // (clearing failureAnalysisJson each time), so a run that failed on
  // attempt 1 and later passed on retry shows here as attemptNumber > 1,
  // passed — not as a separate "attempt 1 failed" data point, since that
  // history isn't preserved once retried. Still answers the question that
  // matters: of runs sitting at attempt 1 right now, what fraction pass, and
  // what's actually causing the rest.
  async getFailureBreakdown(applicationId: string) {
    const executions = await this.prisma.executionRun.findMany({
      where: { applicationId, status: { in: ['COMPLETED', 'FAILED'] } },
      select: { status: true, attemptNumber: true, failureAnalysisJson: true },
    });

    const firstAttempt = executions.filter((e) => e.attemptNumber <= 1);
    const firstAttemptPassed = firstAttempt.filter((e) => e.status === 'COMPLETED').length;

    const byCategory = new Map<string, { firstAttempt: number; retried: number }>();
    for (const run of executions) {
      if (run.status !== 'FAILED') continue;
      const category = (run.failureAnalysisJson as { category?: string } | null)?.category ?? 'unknown';
      const entry = byCategory.get(category) ?? { firstAttempt: 0, retried: 0 };
      if (run.attemptNumber <= 1) entry.firstAttempt++;
      else entry.retried++;
      byCategory.set(category, entry);
    }

    return {
      firstAttemptTotal: firstAttempt.length,
      firstAttemptPassed,
      firstAttemptPassRate: firstAttempt.length > 0 ? Math.round((firstAttemptPassed / firstAttempt.length) * 100) : 0,
      byCategory: Array.from(byCategory.entries())
        .map(([category, counts]) => ({ category, ...counts, total: counts.firstAttempt + counts.retried }))
        .sort((a, b) => b.total - a.total),
    };
  }

  async getFailureTrends(applicationId: string) {
    const executions = await this.prisma.executionRun.findMany({
      where: { applicationId, status: { in: ['COMPLETED', 'FAILED'] } },
      orderBy: { createdAt: 'asc' },
      select: { status: true, createdAt: true },
    });
    const byDay = new Map<string, { passed: number; failed: number }>();
    for (const run of executions) {
      const day = run.createdAt.toISOString().slice(0, 10);
      const entry = byDay.get(day) ?? { passed: 0, failed: 0 };
      if (run.status === 'COMPLETED') entry.passed++;
      else entry.failed++;
      byDay.set(day, entry);
    }
    return Array.from(byDay.entries()).map(([date, counts]) => ({ date, ...counts }));
  }

  // One blended number combining automation coverage, execution pass rate,
  // and object health — built entirely from getSummary()/getFailureTrends(),
  // no new Prisma queries. A category with zero underlying data (e.g. no
  // test cases yet) is excluded and its weight redistributed across the
  // rest, rather than defaulted to a fake number — a brand-new application
  // with nothing in it yet gets score: null, not a misleading 0 or 100.
  async getQualityScore(applicationId: string): Promise<QualityScoreResult> {
    const [summary, executionTrend] = await Promise.all([
      this.getSummary(applicationId),
      this.getFailureTrends(applicationId),
    ]);

    const candidates = [
      {
        label: 'Automation coverage',
        value: summary.automationCoverage,
        weight: QUALITY_SCORE_WEIGHTS.automationCoverage,
        hasData: summary.totalTestCases > 0,
      },
      {
        label: 'Execution pass rate',
        value: summary.passRate,
        weight: QUALITY_SCORE_WEIGHTS.executionPassRate,
        hasData: summary.totalExecutions > 0,
      },
      {
        label: 'Object health',
        value:
          summary.totalObjects > 0 ? Math.round((summary.objectHealth.working / summary.totalObjects) * 100) : 0,
        weight: QUALITY_SCORE_WEIGHTS.objectHealth,
        hasData: summary.totalObjects > 0,
      },
    ];

    const withData = candidates.filter((c) => c.hasData);
    if (withData.length === 0) {
      return { score: null, components: [], executionTrend };
    }

    const totalWeight = withData.reduce((sum, c) => sum + c.weight, 0);
    const components: QualityScoreComponent[] = withData.map((c) => ({
      label: c.label,
      value: c.value,
      weight: Math.round((c.weight / totalWeight) * 100) / 100,
    }));
    const score = Math.round(withData.reduce((sum, c) => sum + c.value * (c.weight / totalWeight), 0));

    return { score, components, executionTrend };
  }

  // Shared by all three export formats so PDF/Excel/CSV never drift apart on
  // what "the report" actually contains.
  private async getFullReportData(applicationId: string) {
    const [application, summary, coverage, trends, testCases] = await Promise.all([
      this.prisma.application.findUnique({ where: { id: applicationId } }),
      this.getSummary(applicationId),
      this.getModuleCoverage(applicationId),
      this.getFailureTrends(applicationId),
      this.prisma.testCase.findMany({
        where: { applicationId },
        orderBy: [{ moduleName: 'asc' }, { title: 'asc' }],
      }),
    ]);
    return { application, summary, coverage, trends, testCases };
  }

  async exportCsv(applicationId: string): Promise<string> {
    const { testCases } = await this.getFullReportData(applicationId);
    const rows = [
      ['Title', 'Module', 'Feature', 'Priority', 'Source', 'Automation Status', 'Created'],
      ...testCases.map((tc) => [
        tc.title,
        tc.moduleName ?? '',
        tc.featureName ?? '',
        tc.priority,
        tc.source,
        tc.automationStatus,
        tc.createdAt.toISOString().slice(0, 10),
      ]),
    ];
    return stringify(rows);
  }

  async exportExcel(applicationId: string): Promise<ExcelJS.Buffer> {
    const { application, summary, coverage, trends, testCases } = await this.getFullReportData(applicationId);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'TestPilot';
    workbook.created = new Date();

    const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0E7490' } };
    const HEADER_FONT: Partial<ExcelJS.Font> = { color: { argb: 'FFFFFFFF' }, bold: true };
    function styleHeaderRow(row: ExcelJS.Row) {
      row.eachCell((cell) => {
        cell.fill = HEADER_FILL;
        cell.font = HEADER_FONT;
        cell.alignment = { vertical: 'middle' };
      });
    }

    // --- Summary ---
    const summarySheet = workbook.addWorksheet('Summary');
    summarySheet.mergeCells('A1:B1');
    summarySheet.getCell('A1').value = `TestPilot Report — ${application?.name ?? applicationId}`;
    summarySheet.getCell('A1').font = { size: 16, bold: true, color: { argb: 'FF0E7490' } };
    summarySheet.getCell('A2').value = `Generated ${new Date().toLocaleString()}`;
    summarySheet.getCell('A2').font = { italic: true, color: { argb: 'FF6B7280' } };
    summarySheet.addRow([]);
    const summaryHeaderRow = summarySheet.addRow(['Metric', 'Value']);
    styleHeaderRow(summaryHeaderRow);
    summarySheet.columns = [{ width: 32 }, { width: 16 }];
    summarySheet.addRows([
      ['Total Test Cases', summary.totalTestCases],
      ['Automated Test Cases', summary.automatedTestCases],
      ['Manual Test Cases', summary.manualTestCases],
      ['Automation Coverage %', summary.automationCoverage],
      ['Total Object Library Entries', summary.totalObjects],
      ['Objects Working', summary.objectHealth.working],
      ['Objects Broken', summary.objectHealth.broken],
      ['Objects Unverified', summary.objectHealth.unknown],
      ['Total Automation Flows', summary.totalFlows],
      ['Total Generated Scripts', summary.totalScripts],
      ['Total Test Data Sets', summary.totalDataSets],
      ['Total Executions', summary.totalExecutions],
      ['Passed Executions', summary.passedExecutions],
      ['Failed Executions', summary.failedExecutions],
      ['Blocked Executions', summary.blockedExecutions],
      ['Pass Rate %', summary.passRate],
    ]);

    // --- Module Coverage ---
    const coverageSheet = workbook.addWorksheet('Module Coverage');
    coverageSheet.columns = [
      { header: 'Module', width: 30 },
      { header: 'Test Cases', width: 12 },
      { header: 'Automated', width: 12 },
      { header: 'Coverage %', width: 12 },
    ];
    styleHeaderRow(coverageSheet.getRow(1));
    for (const row of coverage) {
      const r = coverageSheet.addRow([row.module, row.testCases, row.automated, row.coverage]);
      r.getCell(4).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: row.coverage >= 75 ? 'FFDCFCE7' : row.coverage >= 40 ? 'FFFEF9C3' : 'FFFEE2E2' },
      };
    }

    // --- Failure Trends ---
    const trendsSheet = workbook.addWorksheet('Failure Trends');
    trendsSheet.columns = [
      { header: 'Date', width: 14 },
      { header: 'Passed', width: 10 },
      { header: 'Failed', width: 10 },
      { header: 'Pass Rate %', width: 12 },
    ];
    styleHeaderRow(trendsSheet.getRow(1));
    for (const t of trends) {
      const total = t.passed + t.failed;
      trendsSheet.addRow([t.date, t.passed, t.failed, total > 0 ? Math.round((t.passed / total) * 100) : 0]);
    }

    // --- Recent Executions ---
    const execSheet = workbook.addWorksheet('Recent Executions');
    execSheet.columns = [
      { header: 'Run ID', width: 20 },
      { header: 'Status', width: 14 },
      { header: 'Duration (s)', width: 12 },
      { header: 'Browser', width: 12 },
      { header: 'When', width: 20 },
    ];
    styleHeaderRow(execSheet.getRow(1));
    for (const run of summary.latestExecutions) {
      const r = execSheet.addRow([run.id, run.status, run.durationSeconds, run.browser ?? '', run.createdAt.toLocaleString()]);
      const statusColor =
        run.status === 'COMPLETED' ? 'FFDCFCE7' : run.status === 'FAILED' ? 'FFFEE2E2' : 'FFF3F4F6';
      r.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: statusColor } };
    }

    // --- Test Cases ---
    const tcSheet = workbook.addWorksheet('Test Cases');
    tcSheet.columns = [
      { header: 'Title', width: 40 },
      { header: 'Module', width: 20 },
      { header: 'Feature', width: 20 },
      { header: 'Priority', width: 12 },
      { header: 'Source', width: 16 },
      { header: 'Automation Status', width: 18 },
    ];
    styleHeaderRow(tcSheet.getRow(1));
    for (const tc of testCases) {
      tcSheet.addRow([tc.title, tc.moduleName ?? '', tc.featureName ?? '', tc.priority, tc.source, tc.automationStatus]);
    }

    return workbook.xlsx.writeBuffer();
  }

  async exportPdf(applicationId: string): Promise<Buffer> {
    const { application, summary, coverage, trends, testCases } = await this.getFullReportData(applicationId);
    const appName = application?.name ?? 'Application';

    const kpi = (label: string, value: string | number, sub?: string) => `
      <div class="kpi">
        <div class="kpi-label">${escapeHtml(label)}</div>
        <div class="kpi-value">${value}</div>
        ${sub ? `<div class="kpi-sub">${escapeHtml(sub)}</div>` : ''}
      </div>`;

    const coverageBars = coverage
      .map(
        (c) => `
      <div class="bar-row">
        <div class="bar-label">${escapeHtml(c.module)}</div>
        <div class="bar-track">
          <div class="bar-fill" style="width:${c.coverage}%"></div>
        </div>
        <div class="bar-value">${c.automated}/${c.testCases} · ${c.coverage}%</div>
      </div>`,
      )
      .join('');

    const maxTrend = Math.max(1, ...trends.map((t) => t.passed + t.failed));
    const trendBars = trends
      .map((t) => {
        const total = t.passed + t.failed || 1;
        const passH = Math.round((t.passed / maxTrend) * 100);
        const failH = Math.round((t.failed / maxTrend) * 100);
        return `
      <div class="trend-col">
        <div class="trend-stack">
          <div class="trend-fail" style="height:${failH}%"></div>
          <div class="trend-pass" style="height:${passH}%"></div>
        </div>
        <div class="trend-label">${t.date.slice(5)}</div>
        <div class="trend-rate">${Math.round((t.passed / total) * 100)}%</div>
      </div>`;
      })
      .join('');

    const objectTotal = summary.totalObjects || 1;
    const objectHealthBar = `
      <div class="stacked-bar">
        <div class="seg seg-good" style="width:${(summary.objectHealth.working / objectTotal) * 100}%" title="Working"></div>
        <div class="seg seg-bad" style="width:${(summary.objectHealth.broken / objectTotal) * 100}%" title="Broken"></div>
        <div class="seg seg-unknown" style="width:${(summary.objectHealth.unknown / objectTotal) * 100}%" title="Unverified"></div>
      </div>
      <div class="legend">
        <span><i class="dot dot-good"></i> Working (${summary.objectHealth.working})</span>
        <span><i class="dot dot-bad"></i> Broken (${summary.objectHealth.broken})</span>
        <span><i class="dot dot-unknown"></i> Unverified (${summary.objectHealth.unknown})</span>
      </div>`;

    const STATUS_BADGE: Record<string, string> = {
      COMPLETED: 'badge-good',
      FAILED: 'badge-bad',
      BLOCKED: 'badge-bad',
      RUNNING: 'badge-info',
      READY_TO_RUN: 'badge-muted',
    };
    const executionRows = summary.latestExecutions
      .map(
        (run) => `
      <tr>
        <td class="mono">${run.id.slice(0, 12)}…</td>
        <td><span class="badge ${STATUS_BADGE[run.status] ?? 'badge-muted'}">${run.status}</span></td>
        <td>${run.durationSeconds.toFixed(1)}s</td>
        <td>${escapeHtml(run.browser ?? '—')}</td>
        <td>${new Date(run.createdAt).toLocaleString()}</td>
      </tr>`,
      )
      .join('');

    const AUTOMATION_BADGE: Record<string, string> = {
      NOT_STARTED: 'badge-muted',
      MAPPED: 'badge-info',
      SCRIPT_GENERATED: 'badge-info',
      AUTOMATED: 'badge-good',
    };
    const testCaseRows = testCases
      .map(
        (tc) => `
      <tr>
        <td>${escapeHtml(tc.title)}</td>
        <td>${escapeHtml(tc.moduleName ?? '—')}</td>
        <td>${escapeHtml(tc.priority)}</td>
        <td><span class="badge ${AUTOMATION_BADGE[tc.automationStatus] ?? 'badge-muted'}">${tc.automationStatus.replace(/_/g, ' ')}</span></td>
      </tr>`,
      )
      .join('');

    const html = `
      <html>
        <head>
          <meta charset="utf-8" />
          <style>
            * { box-sizing: border-box; }
            body {
              font-family: 'Segoe UI', Arial, sans-serif;
              color: ${INK};
              margin: 0;
              padding: 36px 40px;
            }
            .cover {
              display: flex;
              justify-content: space-between;
              align-items: flex-end;
              border-bottom: 3px solid ${ACCENT};
              padding-bottom: 16px;
              margin-bottom: 24px;
            }
            .brand { font-size: 12px; letter-spacing: 3px; color: ${ACCENT}; font-weight: 700; text-transform: uppercase; }
            h1 { font-size: 26px; margin: 4px 0 0; }
            .meta { text-align: right; font-size: 11px; color: ${MUTED}; }
            h2 {
              font-size: 14px;
              text-transform: uppercase;
              letter-spacing: 1px;
              color: ${ACCENT};
              border-bottom: 1px solid ${BORDER};
              padding-bottom: 6px;
              margin-top: 32px;
            }
            .kpis { display: flex; gap: 14px; flex-wrap: wrap; margin-top: 14px; }
            .kpi {
              flex: 1;
              min-width: 110px;
              border: 1px solid ${BORDER};
              border-radius: 10px;
              padding: 12px 14px;
              background: ${ACCENT_LIGHT};
            }
            .kpi-label { font-size: 10px; color: ${MUTED}; text-transform: uppercase; letter-spacing: 0.5px; }
            .kpi-value { font-size: 24px; font-weight: 700; color: ${INK}; margin-top: 4px; }
            .kpi-sub { font-size: 10px; color: ${MUTED}; margin-top: 2px; }

            .bar-row { display: flex; align-items: center; gap: 10px; margin: 8px 0; font-size: 11px; }
            .bar-label { width: 130px; flex-shrink: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .bar-track { flex: 1; height: 10px; background: #f1f5f9; border-radius: 6px; overflow: hidden; }
            .bar-fill { height: 100%; background: ${ACCENT}; border-radius: 6px; }
            .bar-value { width: 90px; text-align: right; color: ${MUTED}; flex-shrink: 0; }

            .trend-chart { display: flex; align-items: flex-end; gap: 6px; height: 120px; margin-top: 16px; }
            .trend-col { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; height: 100%; }
            .trend-stack { width: 100%; max-width: 22px; height: 80px; display: flex; flex-direction: column-reverse; background: #f1f5f9; border-radius: 3px; overflow: hidden; }
            .trend-pass { background: ${ACCENT}; width: 100%; }
            .trend-fail { background: #f87171; width: 100%; }
            .trend-label { font-size: 8px; color: ${MUTED}; margin-top: 4px; }
            .trend-rate { font-size: 9px; font-weight: 600; color: ${INK}; }

            .stacked-bar { display: flex; height: 14px; border-radius: 7px; overflow: hidden; margin-top: 12px; }
            .seg-good { background: #22c55e; }
            .seg-bad { background: #f87171; }
            .seg-unknown { background: #d1d5db; }
            .legend { display: flex; gap: 16px; margin-top: 8px; font-size: 10px; color: ${MUTED}; }
            .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 4px; }
            .dot-good { background: #22c55e; } .dot-bad { background: #f87171; } .dot-unknown { background: #d1d5db; }

            table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 11px; }
            th, td { border-bottom: 1px solid ${BORDER}; padding: 7px 10px; text-align: left; }
            th { background: #f8fafc; color: ${MUTED}; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; }
            .mono { font-family: 'Consolas', monospace; }

            .badge { display: inline-block; padding: 2px 8px; border-radius: 20px; font-size: 9px; font-weight: 600; text-transform: uppercase; }
            .badge-good { background: #dcfce7; color: #166534; }
            .badge-bad { background: #fee2e2; color: #991b1b; }
            .badge-info { background: #dbeafe; color: #1e40af; }
            .badge-muted { background: #f3f4f6; color: #4b5563; }

            .footer { margin-top: 36px; padding-top: 10px; border-top: 1px solid ${BORDER}; font-size: 9px; color: ${MUTED}; text-align: center; }
            .empty { color: ${MUTED}; font-size: 11px; font-style: italic; }
          </style>
        </head>
        <body>
          <div class="cover">
            <div>
              <div class="brand">TestPilot</div>
              <h1>${escapeHtml(appName)} — Test Report</h1>
            </div>
            <div class="meta">
              Generated ${new Date().toLocaleString()}<br />
              ${summary.totalTestCases} test case(s) · ${summary.totalExecutions} execution(s)
            </div>
          </div>

          <div class="kpis">
            ${kpi('Automation Coverage', summary.automationCoverage + '%', `${summary.automatedTestCases}/${summary.totalTestCases} test cases`)}
            ${kpi('Pass Rate', summary.passRate + '%', `${summary.passedExecutions}/${summary.totalExecutions} executions`)}
            ${kpi('Object Library', summary.totalObjects, `${summary.objectHealth.working} working`)}
            ${kpi('Automation Flows', summary.totalFlows, `${summary.totalScripts} scripts generated`)}
          </div>

          <h2>Module Coverage</h2>
          ${coverage.length > 0 ? coverageBars : '<p class="empty">No test cases mapped to a module yet.</p>'}

          <h2>Failure Trends</h2>
          ${
            trends.length > 0
              ? `<div class="trend-chart">${trendBars}</div>
                 <div class="legend" style="margin-top:10px">
                   <span><i class="dot dot-good" style="background:${ACCENT}"></i> Passed</span>
                   <span><i class="dot dot-bad"></i> Failed</span>
                 </div>`
              : '<p class="empty">No completed executions yet.</p>'
          }

          <h2>Object Library Health</h2>
          ${summary.totalObjects > 0 ? objectHealthBar : '<p class="empty">No objects scanned yet.</p>'}

          <h2>Recent Executions</h2>
          ${
            summary.latestExecutions.length > 0
              ? `<table><tr><th>Run</th><th>Status</th><th>Duration</th><th>Browser</th><th>When</th></tr>${executionRows}</table>`
              : '<p class="empty">No executions yet.</p>'
          }

          <h2>Test Cases (${testCases.length})</h2>
          ${
            testCases.length > 0
              ? `<table><tr><th>Title</th><th>Module</th><th>Priority</th><th>Automation</th></tr>${testCaseRows}</table>`
              : '<p class="empty">No test cases yet.</p>'
          }

          <div class="footer">Generated by TestPilot — AI-assisted test automation platform</div>
        </body>
      </html>
    `;

    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(html);
      return await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '20px', bottom: '20px', left: '0', right: '0' },
      });
    } finally {
      await browser.close();
    }
  }
}
