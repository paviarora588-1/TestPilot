import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AI_PROVIDER_TOKEN } from '../ai-provider/ai-provider.tokens';
import type { AiProvider } from '../ai-provider/ai-provider.interface';
import { decryptCredential } from '../../common/crypto.util';
import { createJiraIssue } from '../integrations/jira.client';
import { UpdateBugReportDto } from './dto/update-bug-report.dto';

interface StoredCredentials {
  apiToken: string;
  email?: string;
}

interface AiBugDraft {
  title?: string;
  stepsToReproduce?: string[];
  actualResult?: string;
  severity?: string;
}

const VALID_SEVERITIES = new Set(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);

@Injectable()
export class BugReportsService {
  private readonly logger = new Logger(BugReportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(AI_PROVIDER_TOKEN) private readonly aiProvider: AiProvider,
  ) {}

  list(applicationId: string) {
    return this.prisma.bugReport.findMany({
      where: { applicationId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(id: string) {
    const report = await this.prisma.bugReport.findUnique({ where: { id } });
    if (!report) throw new NotFoundException(`Bug report ${id} not found`);
    return report;
  }

  // AI drafts everything from the real execution evidence, but never
  // submits — status starts DRAFT so a human always reviews/edits first,
  // matching the vision's explicit "user should review before submitting."
  async generateFromExecution(executionId: string) {
    const execution = await this.prisma.executionRun.findUnique({
      where: { id: executionId },
      include: {
        stepResults: { orderBy: { stepOrder: 'asc' } },
        script: { include: { automationFlow: { select: { testCaseId: true, name: true } } } },
      },
    });
    if (!execution) throw new NotFoundException(`Execution ${executionId} not found`);
    if (execution.status !== 'FAILED') {
      throw new ConflictException({
        statusCode: 409,
        blocked: true,
        reasons: ['A bug report can only be generated from a failed execution.'],
        nextActions: ['Select a failed execution run.'],
      });
    }

    const testCaseId = execution.script.automationFlow?.testCaseId ?? null;
    const testCase = testCaseId
      ? await this.prisma.testCase.findUnique({ where: { id: testCaseId }, select: { expectedResult: true } })
      : null;

    const failureAnalysis = (execution.failureAnalysisJson ?? {}) as Record<string, unknown>;
    const stepInstructions = execution.stepResults
      .filter((s) => s.instruction)
      .map((s, i) => `${i + 1}. ${s.instruction}${s.status === 'FAILED' ? ' (FAILED HERE)' : ''}`);
    const evidencePaths = execution.stepResults.map((s) => s.screenshotPath).filter((p): p is string => !!p);

    let draft: AiBugDraft = {};
    try {
      draft = await this.aiProvider.generateJson<AiBugDraft>(
        `Automation flow: ${execution.script.automationFlow?.name ?? 'unknown'}\n` +
          `Steps executed:\n${stepInstructions.join('\n')}\n\n` +
          `Failure category: ${failureAnalysis.category ?? 'unknown'}\n` +
          `Root cause: ${failureAnalysis.aiRootCause ?? failureAnalysis.likelyRootCause ?? 'unknown'}\n` +
          `Error: ${failureAnalysis.failureMessage ?? 'unknown'}`,
        {
          system:
            'You are a QA engineer drafting a bug report from a failed automated test. Return ONLY a JSON object: ' +
            '{ "title": string (concise, specific), "stepsToReproduce": string[] (numbered steps a human can follow), ' +
            '"actualResult": string, "severity": "LOW"|"MEDIUM"|"HIGH"|"CRITICAL" }.',
        },
      );
    } catch (err) {
      this.logger.warn(`Bug report AI drafting unavailable for execution ${executionId}: ${(err as Error).message}`);
    }

    return this.prisma.bugReport.create({
      data: {
        applicationId: execution.applicationId,
        executionId: execution.id,
        title: draft.title || `${execution.script.automationFlow?.name ?? 'Test'} failed`,
        stepsToReproduce: (draft.stepsToReproduce?.length ? draft.stepsToReproduce : stepInstructions) as never,
        actualResult: draft.actualResult || (failureAnalysis.failureMessage as string) || 'See execution logs.',
        expectedResult: testCase?.expectedResult ?? undefined,
        severity: (VALID_SEVERITIES.has(draft.severity ?? '') ? draft.severity : 'MEDIUM') as never,
        environment: execution.environment ?? undefined,
        evidencePaths: evidencePaths as never,
        logsSnapshot: Array.isArray(execution.logs) ? (execution.logs as string[]).join('\n') : undefined,
        status: 'DRAFT',
      },
    });
  }

  async update(id: string, dto: UpdateBugReportDto) {
    await this.get(id);
    return this.prisma.bugReport.update({
      where: { id },
      data: {
        title: dto.title,
        stepsToReproduce: dto.stepsToReproduce as never,
        actualResult: dto.actualResult,
        expectedResult: dto.expectedResult,
        severity: dto.severity,
        priority: dto.priority,
        environment: dto.environment,
      },
    });
  }

  async remove(id: string) {
    await this.get(id);
    await this.prisma.bugReport.delete({ where: { id } });
    return { success: true };
  }

  // Only fires on explicit user action, after review/edit — never automatic.
  async submit(id: string) {
    const report = await this.get(id);
    const config = await this.prisma.integrationConfig.findFirst({
      where: { applicationId: report.applicationId, type: 'JIRA' },
    });
    if (!config) {
      throw new ConflictException({
        statusCode: 409,
        blocked: true,
        reasons: ['No Jira integration connected for this application.'],
        nextActions: ['Connect a Jira Cloud integration in Settings or the Integrations page first.'],
      });
    }

    const credentials = JSON.parse(decryptCredential(config.credentialsEncrypted)) as StoredCredentials;
    const steps = Array.isArray(report.stepsToReproduce) ? (report.stepsToReproduce as string[]) : [];
    const description =
      `${report.title}\n\nSteps to reproduce:\n${steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n\n` +
      `Actual result: ${report.actualResult}\n` +
      (report.expectedResult ? `Expected result: ${report.expectedResult}\n` : '') +
      (report.environment ? `Environment: ${report.environment}\n` : '') +
      `Severity: ${report.severity} · Priority: ${report.priority}` +
      (report.evidencePaths ? `\n\nEvidence: ${(report.evidencePaths as string[]).join(', ')}` : '');

    try {
      const issue = await createJiraIssue(config.baseUrl, credentials.email ?? '', credentials.apiToken, config.projectKey ?? '', {
        summary: report.title,
        description,
      });
      return this.prisma.bugReport.update({
        where: { id },
        data: { status: 'SUBMITTED', externalIssueKey: issue.key, errorMessage: null },
      });
    } catch (err) {
      return this.prisma.bugReport.update({
        where: { id },
        data: { status: 'FAILED', errorMessage: (err as Error).message },
      });
    }
  }
}
