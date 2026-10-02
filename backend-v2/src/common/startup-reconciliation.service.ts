import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { destroyWorkspace } from '../modules/ai-engineering/workspace.util';

const RESTART_MESSAGE = 'Interrupted by a server restart.';

// Scans, executions, and suite runs all execute fire-and-forget in-process,
// each guarded only by an in-memory watchdog timer (see ScannerService,
// ExecutionService) — neither the work nor its watchdog survives the process
// that started them dying. A restart mid-run has repeatedly left rows stuck
// at RUNNING forever with no way to recover except editing the database by
// hand, since nothing can legitimately still be RUNNING the instant a fresh
// process boots. Sweep them here instead, once, on every startup.
@Injectable()
export class StartupReconciliationService implements OnApplicationBootstrap {
  private readonly logger = new Logger(StartupReconciliationService.name);

  constructor(private readonly prisma: PrismaService) {}

  // The local dev database has repeatedly dropped connections for a moment
  // right around process startup (confirmed live, several times) — before
  // this, a single transient failure here rejected the whole Promise.all
  // uncaught, which crashed the entire app on every boot until the db
  // happened to be ready in time. Reconciliation is a best-effort cleanup,
  // not something worth taking the whole process down over: skip and log
  // instead of crashing when one query can't reach the database.
  private async safeUpdateMany(label: string, run: () => Promise<{ count: number }>): Promise<number> {
    try {
      return (await run()).count;
    } catch (err) {
      this.logger.warn(`Startup reconciliation skipped for ${label}: ${(err as Error).message}`);
      return 0;
    }
  }

  // AI Engineering tasks run their triage+specialist+verify pipeline the
  // exact same way — fire-and-forget in-process, via `createTask`'s
  // `.catch()`-only call to `runPipeline` (see ai-engineering.service.ts).
  // No status past PLANNING can legitimately still be in flight the instant
  // a fresh process boots, for the same reason as scans/executions above.
  // Unlike those, each task also owns an isolated on-disk workspace
  // (`.ai-tasks/<id>/`) that a restart can't clean up either — best-effort
  // destroy it here too, per task, so a dead task doesn't also leak disk.
  private async reconcileAiEngineeringTasks(): Promise<number> {
    let count = 0;
    try {
      const stuck = await this.prisma.aiEngineeringTask.findMany({
        where: { status: { in: ['PLANNING', 'IN_PROGRESS'] } },
        select: { id: true },
      });
      for (const task of stuck) {
        try {
          await destroyWorkspace(task.id);
        } catch (err) {
          this.logger.warn(`Failed to clean up workspace for orphaned AI task ${task.id}: ${(err as Error).message}`);
        }
        await this.prisma.aiEngineeringTask.update({
          where: { id: task.id },
          data: {
            status: 'FAILED',
            errorMessage: RESTART_MESSAGE,
            workspacePath: null,
            secondaryWorkspacePath: null,
          },
        });
        count++;
      }
    } catch (err) {
      this.logger.warn(`Startup reconciliation skipped for AI engineering tasks: ${(err as Error).message}`);
    }
    return count;
  }

  async onApplicationBootstrap() {
    const [scans, executions, suites, recordings, aiTasks] = await Promise.all([
      this.safeUpdateMany('scans', () =>
        this.prisma.scanSession.updateMany({
          where: { status: 'RUNNING' },
          data: { status: 'FAILED', finishedAt: new Date(), errorMessage: RESTART_MESSAGE },
        }),
      ),
      this.safeUpdateMany('executions', () =>
        this.prisma.executionRun.updateMany({
          where: { status: 'RUNNING' },
          data: { status: 'FAILED', logs: [RESTART_MESSAGE] },
        }),
      ),
      this.safeUpdateMany('suites', () =>
        this.prisma.executionSuiteRun.updateMany({
          where: { status: 'RUNNING' },
          data: { status: 'FAILED', finishedAt: new Date() },
        }),
      ),
      // A recording session's live Browser/Page lives only in
      // WebRecorderRuntimeService's in-memory registry (see its own header
      // comment) — it cannot survive a restart any more than a scan's
      // watchdog can, and the orphaned Chromium process itself is gone too.
      this.safeUpdateMany('recordings', () =>
        this.prisma.webRecordingSession.updateMany({
          where: { status: { in: ['LAUNCHING', 'RECORDING', 'PAUSED'] } },
          data: { status: 'FAILED', endedAt: new Date(), errorMessage: RESTART_MESSAGE },
        }),
      ),
      this.reconcileAiEngineeringTasks(),
    ]);
    await this.safeUpdateMany('step results', () =>
      this.prisma.executionStepResult.updateMany({
        where: { status: { in: ['PENDING', 'RUNNING'] }, execution: { status: 'FAILED' } },
        data: { status: 'SKIPPED' },
      }),
    );

    const total = scans + executions + suites + recordings + aiTasks;
    if (total > 0) {
      this.logger.warn(
        `Reconciled ${total} orphaned run(s) left RUNNING by a previous process (scans: ${scans}, executions: ${executions}, suites: ${suites}, recordings: ${recordings}, aiTasks: ${aiTasks}).`,
      );
    }
  }
}
