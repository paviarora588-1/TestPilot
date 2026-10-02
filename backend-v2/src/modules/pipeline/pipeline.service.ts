import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AutomationBuilderService } from '../automation-builder/automation-builder.service';
import { ScriptGeneratorService } from '../script-generator/script-generator.service';
import { ExecutionService } from '../execution/execution.service';

export interface AutoAutomateStepResult {
  testCaseId: string;
  testCaseTitle: string;
  status: 'EXECUTED' | 'SCRIPT_GENERATED' | 'FLOW_GENERATED' | 'BLOCKED';
  reasons: string[];
  flowId?: string;
  scriptId?: string;
}

/**
 * "Automate these test cases" in one call — chains the three actions a QA
 * engineer would otherwise click through one at a time per test case
 * (Generate Flow -> Generate Script -> Run), reusing each step's existing
 * service untouched. A test case that's already blocked or fails at an
 * earlier stage doesn't stop the batch — every other test case still gets
 * attempted, and the per-test-case result records exactly how far it got.
 * The actual executions run through the existing ExecutionSuiteRun
 * mechanism (runSuite) so progress is trackable the same way a manually
 * triggered "Run Suite" already is — no new job-tracking model needed.
 */
@Injectable()
export class PipelineService {
  private readonly logger = new Logger(PipelineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly automationBuilder: AutomationBuilderService,
    private readonly scriptGenerator: ScriptGeneratorService,
    private readonly executionService: ExecutionService,
  ) {}

  async autoAutomate(
    applicationId: string,
    testCaseIds: string[],
    triggeredById?: string,
    options?: {
      skipExecution?: boolean;
      engine?: 'LOCAL' | 'CODEX';
      // Returns false to signal "stop — this job was cancelled"; only
      // meaningful when called via startAutoAutomateJob below.
      onProgress?: (completed: number, currentStep: string) => Promise<boolean | void>;
    },
  ) {
    const skipExecution = options?.skipExecution ?? false;
    const engine = options?.engine ?? 'LOCAL';
    const results: AutoAutomateStepResult[] = [];
    const scriptIds: string[] = [];

    for (let i = 0; i < testCaseIds.length; i++) {
      const testCaseId = testCaseIds[i];
      const shouldContinue = await options?.onProgress?.(i, `Automating test case ${i + 1} of ${testCaseIds.length}…`);
      if (shouldContinue === false) break;
      const testCase = await this.prisma.testCase.findUnique({ where: { id: testCaseId } });
      if (!testCase || testCase.applicationId !== applicationId) {
        results.push({
          testCaseId,
          testCaseTitle: testCase?.title ?? 'Unknown',
          status: 'BLOCKED',
          reasons: ['Test case not found for this application.'],
        });
        continue;
      }

      let flowId: string;
      try {
        const flow =
          engine === 'CODEX'
            ? await this.automationBuilder.generateFromTestCaseWithCodex(applicationId, testCaseId)
            : await this.automationBuilder.generateFromTestCase(applicationId, testCaseId);
        flowId = flow.id;
      } catch (err) {
        const reasons = this.extractReasons(err);
        this.logger.warn(`Auto-automate: flow generation failed for test case ${testCaseId}: ${reasons.join('; ')}`);
        results.push({ testCaseId, testCaseTitle: testCase.title, status: 'BLOCKED', reasons });
        continue;
      }

      let scriptId: string;
      try {
        const script =
          engine === 'CODEX'
            ? await this.scriptGenerator.generateForFlowWithCodex(flowId)
            : await this.scriptGenerator.generateForFlow(flowId);
        scriptId = script.id;
      } catch (err) {
        const reasons = this.extractReasons(err);
        this.logger.warn(`Auto-automate: script generation failed for test case ${testCaseId}: ${reasons.join('; ')}`);
        results.push({ testCaseId, testCaseTitle: testCase.title, status: 'FLOW_GENERATED', reasons, flowId });
        continue;
      }

      scriptIds.push(scriptId);
      results.push({ testCaseId, testCaseTitle: testCase.title, status: 'SCRIPT_GENERATED', reasons: [], flowId, scriptId });
    }

    // Every test case that made it this far has a real script — hand them
    // all to the existing batch-execution mechanism in one suite run rather
    // than firing off separate individual executions. Skipped when the
    // caller wants generation to stop for human review/approval before
    // anything actually runs.
    const suiteRun =
      !skipExecution && scriptIds.length > 0
        ? await this.executionService.runSuite(applicationId, 'SELECTED', scriptIds, triggeredById)
        : null;

    for (const result of results) {
      if (result.status === 'SCRIPT_GENERATED' && suiteRun) {
        result.status = 'EXECUTED';
      }
    }

    await options?.onProgress?.(testCaseIds.length, 'Done');

    return {
      results,
      suiteRunId: suiteRun?.id ?? null,
      summary: {
        total: testCaseIds.length,
        executing: scriptIds.length,
        blocked: results.filter((r) => r.status === 'BLOCKED' || r.status === 'FLOW_GENERATED').length,
      },
    };
  }

  // Job-based wrapper — returns immediately, poll getAutoAutomateJob(jobId)
  // for progress. The actual work (flow generation, script generation, and
  // kicking off the suite run) keeps running server-side regardless of
  // whether the browser tab/route that started it is still around, unlike
  // calling autoAutomate directly from an HTTP request that stays open for
  // the whole batch.
  async startAutoAutomateJob(
    applicationId: string,
    testCaseIds: string[],
    triggeredById?: string,
    options?: { skipExecution?: boolean; engine?: 'LOCAL' | 'CODEX' },
  ) {
    const job = await this.prisma.autoAutomateJob.create({
      data: { applicationId, status: 'QUEUED', totalCount: testCaseIds.length },
    });

    const onProgress = async (completed: number, currentStep: string) => {
      const current = await this.prisma.autoAutomateJob.findUnique({ where: { id: job.id }, select: { status: true } });
      if (current?.status === 'FAILED') return false;
      await this.prisma.autoAutomateJob.update({
        where: { id: job.id },
        data: { status: 'RUNNING', completedCount: completed, currentStep },
      });
      return true;
    };

    this.autoAutomate(applicationId, testCaseIds, triggeredById, { ...options, onProgress })
      .then(async (result) => {
        const current = await this.prisma.autoAutomateJob.findUnique({ where: { id: job.id }, select: { status: true } });
        if (current?.status === 'FAILED') return;
        await this.prisma.autoAutomateJob.update({
          where: { id: job.id },
          data: { status: 'COMPLETED', completedCount: testCaseIds.length, resultJson: result as never, currentStep: null },
        });
      })
      .catch(async (err) => {
        const current = await this.prisma.autoAutomateJob.findUnique({ where: { id: job.id }, select: { status: true } });
        if (current?.status === 'FAILED') return;
        await this.prisma.autoAutomateJob.update({
          where: { id: job.id },
          data: { status: 'FAILED', errorMessage: (err as Error).message ?? 'Unknown error', currentStep: null },
        });
      });

    return job;
  }

  getAutoAutomateJob(jobId: string) {
    return this.prisma.autoAutomateJob.findUniqueOrThrow({ where: { id: jobId } });
  }

  private extractReasons(err: unknown): string[] {
    const response = (err as { response?: { reasons?: string[]; message?: string | string[] } })?.response;
    if (response?.reasons?.length) return response.reasons;
    if (Array.isArray(response?.message)) return response.message;
    if (typeof response?.message === 'string') return [response.message];
    return [(err as Error).message ?? 'Unknown error'];
  }
}
