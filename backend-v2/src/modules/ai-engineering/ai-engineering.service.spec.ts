import { ConflictException, NotFoundException } from '@nestjs/common';
import { AiEngineeringService, parseEslintFindings, parseTscFindings } from './ai-engineering.service';
import * as workspaceUtil from './workspace.util';
import * as codexCli from '../../common/codex-cli.util';

jest.mock('./workspace.util', () => ({
  ...jest.requireActual('./workspace.util'),
  applyApprovedChanges: jest.fn(),
  destroyWorkspace: jest.fn(),
  getProjectDir: jest.fn().mockReturnValue('/fake/project'),
  buildWorkspace: jest.fn(),
  diffWorkspace: jest.fn(),
  runVerification: jest.fn(),
}));

jest.mock('../../common/codex-cli.util', () => ({
  ...jest.requireActual('../../common/codex-cli.util'),
  runCodexAgent: jest.fn(),
  runCodexExecJson: jest.fn(),
}));

function makePrismaMock(task: Record<string, unknown> | null) {
  return {
    aiEngineeringTask: {
      findUnique: jest.fn().mockResolvedValue(task),
      update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...task, ...data })),
    },
  };
}

function runPipeline(service: AiEngineeringService, taskId: string): Promise<void> {
  return (service as unknown as { runPipeline(id: string): Promise<void> }).runPipeline(taskId);
}

describe('AiEngineeringService — approve/reject guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('reports 404 for a task that does not exist, not a raw conflict', async () => {
    const prisma = makePrismaMock(null);
    const service = new AiEngineeringService(prisma as never, {} as never);

    await expect(service.approve('missing')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses to approve a task that is not WAITING_REVIEW', async () => {
    const prisma = makePrismaMock({ id: 't-1', status: 'IN_PROGRESS' });
    const service = new AiEngineeringService(prisma as never, {} as never);

    await expect(service.approve('t-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses to reject a task that is not WAITING_REVIEW', async () => {
    const prisma = makePrismaMock({ id: 't-1', status: 'COMPLETED' });
    const service = new AiEngineeringService(prisma as never, {} as never);

    await expect(service.reject('t-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses to approve a task with no workspace to apply from', async () => {
    const prisma = makePrismaMock({ id: 't-1', status: 'WAITING_REVIEW', workspacePath: null, area: 'BACKEND' });
    const service = new AiEngineeringService(prisma as never, {} as never);

    await expect(service.approve('t-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses to approve a task the PM flagged NEEDS_HUMAN', async () => {
    const prisma = makePrismaMock({ id: 't-1', status: 'WAITING_REVIEW', workspacePath: '/fake/ws', area: 'NEEDS_HUMAN' });
    const service = new AiEngineeringService(prisma as never, {} as never);

    await expect(service.approve('t-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('applies changes and marks COMPLETED on a valid approval', async () => {
    const prisma = makePrismaMock({
      id: 't-1',
      status: 'WAITING_REVIEW',
      workspacePath: '/fake/ws',
      area: 'BACKEND',
      touchesSchema: false,
      diffSummary: [{ path: 'src/thing.ts', diff: '...' }],
    });
    (workspaceUtil.applyApprovedChanges as jest.Mock).mockResolvedValue({
      appliedFiles: ['src/thing.ts'],
      skippedFiles: [],
    });
    const service = new AiEngineeringService(prisma as never, {} as never);

    const result = await service.approve('t-1', 'user-1');

    expect(workspaceUtil.applyApprovedChanges).toHaveBeenCalledWith('/fake/ws', '/fake/project', ['src/thing.ts'], {
      allowSchema: false,
    });
    expect(workspaceUtil.destroyWorkspace).toHaveBeenCalledWith('t-1');
    expect(result.appliedFiles).toEqual(['src/thing.ts']);
    expect(prisma.aiEngineeringTask.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'COMPLETED', reviewedById: 'user-1' }) }),
    );
  });

  it('discards the workspace and marks REJECTED without touching real source', async () => {
    const prisma = makePrismaMock({ id: 't-1', status: 'WAITING_REVIEW', workspacePath: '/fake/ws', area: 'BACKEND' });
    const service = new AiEngineeringService(prisma as never, {} as never);

    await service.reject('t-1', 'user-1');

    expect(workspaceUtil.applyApprovedChanges).not.toHaveBeenCalled();
    expect(workspaceUtil.destroyWorkspace).toHaveBeenCalledWith('t-1');
    expect(prisma.aiEngineeringTask.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'REJECTED', reviewedById: 'user-1' }) }),
    );
  });
});

describe('AiEngineeringService — bounded auto-repair loop', () => {
  const baseTask = { id: 't-1', title: 'Bug', description: 'It is broken', reproSteps: [], severity: 'MEDIUM' };
  const passingVerification = { tsc: { passed: true, output: '' }, tests: { passed: true, output: '' } };
  const failingVerification = { tsc: { passed: false, output: 'error TS2345: bad' }, tests: { passed: true, output: '' } };

  beforeEach(() => {
    jest.clearAllMocks();
    (workspaceUtil.buildWorkspace as jest.Mock).mockResolvedValue({ workspaceDir: '/fake/ws' });
    (codexCli.runCodexExecJson as jest.Mock).mockResolvedValue({
      area: 'BACKEND',
      planSummary: 'Fix the thing',
      candidateFiles: ['src/a.ts'],
      reason: null,
    });
  });

  it('repairs on the first attempt and reaches WAITING_REVIEW with the repaired diff', async () => {
    const prisma = makePrismaMock(baseTask);
    const service = new AiEngineeringService(prisma as never, {} as never);
    (codexCli.runCodexAgent as jest.Mock)
      .mockResolvedValueOnce({ succeeded: true, summary: 'initial fix' })
      .mockResolvedValueOnce({ succeeded: true, summary: 'repaired the type error' })
      .mockResolvedValueOnce({ succeeded: true, summary: '{"safe": true, "summary": "no other usages found"}' });
    (workspaceUtil.diffWorkspace as jest.Mock)
      .mockResolvedValueOnce([{ path: 'src/a.ts', diff: 'd1' }])
      .mockResolvedValueOnce([{ path: 'src/a.ts', diff: 'd2' }]);
    (workspaceUtil.runVerification as jest.Mock)
      .mockResolvedValueOnce(failingVerification)
      .mockResolvedValueOnce(passingVerification);

    await runPipeline(service, 't-1');

    expect(codexCli.runCodexAgent).toHaveBeenCalledTimes(3);
    const lastUpdate = (prisma.aiEngineeringTask.update as jest.Mock).mock.calls.at(-1)![0].data;
    expect(lastUpdate).toMatchObject({
      status: 'WAITING_REVIEW',
      repairAttempts: 1,
      diffSummary: [{ path: 'src/a.ts', diff: 'd2' }],
      verificationJson: passingVerification,
      aiReviewPassed: true,
      aiReviewSummary: 'no other usages found',
    });
    expect(lastUpdate.specialistSummary).toContain('repaired the type error');
  });

  it('gives up after MAX_REPAIR_ATTEMPTS and still reaches WAITING_REVIEW with the last state', async () => {
    const prisma = makePrismaMock(baseTask);
    const service = new AiEngineeringService(prisma as never, {} as never);
    (codexCli.runCodexAgent as jest.Mock)
      .mockResolvedValueOnce({ succeeded: true, summary: 'initial fix' })
      .mockResolvedValueOnce({ succeeded: true, summary: 'repair 1' })
      .mockResolvedValueOnce({ succeeded: true, summary: 'repair 2' })
      .mockResolvedValueOnce({ succeeded: true, summary: '{"safe": true, "summary": "checked"}' });
    (workspaceUtil.diffWorkspace as jest.Mock)
      .mockResolvedValueOnce([{ path: 'src/a.ts', diff: 'd1' }])
      .mockResolvedValueOnce([{ path: 'src/a.ts', diff: 'd2' }])
      .mockResolvedValueOnce([{ path: 'src/a.ts', diff: 'd3' }]);
    (workspaceUtil.runVerification as jest.Mock).mockResolvedValue(failingVerification);

    await runPipeline(service, 't-1');

    expect(codexCli.runCodexAgent).toHaveBeenCalledTimes(4);
    const lastUpdate = (prisma.aiEngineeringTask.update as jest.Mock).mock.calls.at(-1)![0].data;
    expect(lastUpdate).toMatchObject({
      status: 'WAITING_REVIEW',
      repairAttempts: 2,
      diffSummary: [{ path: 'src/a.ts', diff: 'd3' }],
      verificationJson: failingVerification,
    });
  });

  it('stops the loop and keeps the prior diff when a repair call itself errors', async () => {
    const prisma = makePrismaMock(baseTask);
    const service = new AiEngineeringService(prisma as never, {} as never);
    (codexCli.runCodexAgent as jest.Mock)
      .mockResolvedValueOnce({ succeeded: true, summary: 'initial fix' })
      .mockResolvedValueOnce({ succeeded: false, summary: '', errorMessage: 'codex timed out' })
      .mockResolvedValueOnce({ succeeded: true, summary: '{"safe": true, "summary": "checked"}' });
    (workspaceUtil.diffWorkspace as jest.Mock).mockResolvedValueOnce([{ path: 'src/a.ts', diff: 'd1' }]);
    (workspaceUtil.runVerification as jest.Mock).mockResolvedValueOnce(failingVerification);

    await runPipeline(service, 't-1');

    expect(codexCli.runCodexAgent).toHaveBeenCalledTimes(3);
    expect(workspaceUtil.diffWorkspace).toHaveBeenCalledTimes(1);
    const lastUpdate = (prisma.aiEngineeringTask.update as jest.Mock).mock.calls.at(-1)![0].data;
    expect(lastUpdate).toMatchObject({
      status: 'WAITING_REVIEW',
      repairAttempts: 1,
      diffSummary: [{ path: 'src/a.ts', diff: 'd1' }],
      verificationJson: failingVerification,
    });
    expect(lastUpdate.specialistSummary).toContain('codex timed out');
  });

  it('degrades gracefully to no review verdict when the AI review call fails, without failing the task', async () => {
    const prisma = makePrismaMock(baseTask);
    const service = new AiEngineeringService(prisma as never, {} as never);
    (codexCli.runCodexAgent as jest.Mock)
      .mockResolvedValueOnce({ succeeded: true, summary: 'initial fix' })
      .mockResolvedValueOnce({ succeeded: false, summary: '', errorMessage: 'review call timed out' });
    (workspaceUtil.diffWorkspace as jest.Mock).mockResolvedValueOnce([{ path: 'src/a.ts', diff: 'd1' }]);
    (workspaceUtil.runVerification as jest.Mock).mockResolvedValueOnce(passingVerification);

    await runPipeline(service, 't-1');

    const lastUpdate = (prisma.aiEngineeringTask.update as jest.Mock).mock.calls.at(-1)![0].data;
    expect(lastUpdate.status).toBe('WAITING_REVIEW');
    expect(lastUpdate.aiReviewPassed).toBeUndefined();
    expect(lastUpdate.aiReviewSummary).toBeUndefined();
  });

  it('degrades gracefully when the AI review returns non-JSON text instead of erroring', async () => {
    const prisma = makePrismaMock(baseTask);
    const service = new AiEngineeringService(prisma as never, {} as never);
    (codexCli.runCodexAgent as jest.Mock)
      .mockResolvedValueOnce({ succeeded: true, summary: 'initial fix' })
      .mockResolvedValueOnce({ succeeded: true, summary: 'not valid json at all' });
    (workspaceUtil.diffWorkspace as jest.Mock).mockResolvedValueOnce([{ path: 'src/a.ts', diff: 'd1' }]);
    (workspaceUtil.runVerification as jest.Mock).mockResolvedValueOnce(passingVerification);

    await runPipeline(service, 't-1');

    const lastUpdate = (prisma.aiEngineeringTask.update as jest.Mock).mock.calls.at(-1)![0].data;
    expect(lastUpdate.status).toBe('WAITING_REVIEW');
    expect(lastUpdate.aiReviewPassed).toBeUndefined();
  });
});

describe('AiEngineeringService — cross-area (BOTH) tasks', () => {
  const baseTask = { id: 't-1', title: 'Bug', description: 'It is broken', reproSteps: [], severity: 'MEDIUM' };
  const passingVerification = { tsc: { passed: true, output: '' }, tests: { passed: true, output: '' } };

  beforeEach(() => {
    jest.clearAllMocks();
    (codexCli.runCodexExecJson as jest.Mock).mockResolvedValue({
      area: 'BOTH',
      planSummary: 'Coordinated fix',
      candidateFiles: [],
      reason: null,
    });
    (workspaceUtil.buildWorkspace as jest.Mock).mockImplementation((_taskId: string, area: string) =>
      Promise.resolve({ workspaceDir: area === 'BACKEND' ? '/fake/ws-backend' : '/fake/ws-frontend' }),
    );
    (workspaceUtil.runVerification as jest.Mock).mockResolvedValue(passingVerification);
  });

  it('runs both areas and persists backend into primary fields, frontend into secondary fields', async () => {
    const prisma = makePrismaMock(baseTask);
    const service = new AiEngineeringService(prisma as never, {} as never);
    (codexCli.runCodexAgent as jest.Mock).mockImplementation(({ cwd }: { cwd: string }) =>
      Promise.resolve({ succeeded: true, summary: cwd === '/fake/ws-backend' ? 'backend fix' : 'frontend fix' }),
    );
    (workspaceUtil.diffWorkspace as jest.Mock).mockImplementation((dir: string) =>
      Promise.resolve(
        dir === '/fake/ws-backend' ? [{ path: 'src/b.ts', diff: 'bdiff' }] : [{ path: 'src/f.ts', diff: 'fdiff' }],
      ),
    );

    await runPipeline(service, 't-1');

    const lastUpdate = (prisma.aiEngineeringTask.update as jest.Mock).mock.calls.at(-1)![0].data;
    expect(lastUpdate).toMatchObject({
      status: 'WAITING_REVIEW',
      workspacePath: '/fake/ws-backend',
      diffSummary: [{ path: 'src/b.ts', diff: 'bdiff' }],
      verificationJson: passingVerification,
      repairAttempts: 0,
      secondaryWorkspacePath: '/fake/ws-frontend',
      secondaryDiffSummary: [{ path: 'src/f.ts', diff: 'fdiff' }],
      secondaryVerificationJson: passingVerification,
      secondaryRepairAttempts: 0,
    });
    expect(lastUpdate.specialistSummary).toContain('backend fix');
    expect(lastUpdate.specialistSummary).toContain('frontend fix');
  });

  it('fails the whole task and cleans up when either side fails', async () => {
    const prisma = makePrismaMock(baseTask);
    const service = new AiEngineeringService(prisma as never, {} as never);
    (codexCli.runCodexAgent as jest.Mock).mockImplementation(({ cwd }: { cwd: string }) =>
      cwd === '/fake/ws-backend'
        ? Promise.resolve({ succeeded: true, summary: 'backend fix' })
        : Promise.resolve({ succeeded: false, summary: '', errorMessage: 'frontend codex call failed' }),
    );
    (workspaceUtil.diffWorkspace as jest.Mock).mockResolvedValue([{ path: 'src/b.ts', diff: 'bdiff' }]);

    await runPipeline(service, 't-1');

    expect(workspaceUtil.destroyWorkspace).toHaveBeenCalledWith('t-1');
    const lastUpdate = (prisma.aiEngineeringTask.update as jest.Mock).mock.calls.at(-1)![0].data;
    expect(lastUpdate.status).toBe('FAILED');
    expect(lastUpdate.errorMessage).toContain('Frontend: frontend codex call failed');
  });
});

// Val's clean review is now trusted enough to skip the human gate entirely —
// but only for the exact combination of clean review + passing verification
// + no schema change. Each test below isolates one of those conditions to
// confirm the fallback to WAITING_REVIEW still holds whenever it's missing.
describe('AiEngineeringService — auto-approval (Val clean review, no human required)', () => {
  const passingVerification = { tsc: { passed: true, output: '' }, tests: { passed: true, output: '' } };

  // The mock's findUnique always returns this same static object regardless
  // of prior update() calls (see makePrismaMock) — so it doubles as both the
  // task runPipeline fetches at the start and the task maybeAutoApprove
  // re-fetches at the end, already shaped as if the WAITING_REVIEW update
  // had landed.
  function makeWaitingReviewTask(overrides: Record<string, unknown> = {}) {
    return {
      id: 't-1',
      title: 'Bug',
      description: 'It is broken',
      reproSteps: [],
      severity: 'MEDIUM',
      status: 'WAITING_REVIEW',
      workspacePath: '/fake/ws',
      area: 'BACKEND',
      touchesSchema: false,
      diffSummary: [{ path: 'src/a.ts', diff: 'd1' }],
      ...overrides,
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    (workspaceUtil.buildWorkspace as jest.Mock).mockResolvedValue({ workspaceDir: '/fake/ws' });
    (workspaceUtil.diffWorkspace as jest.Mock).mockResolvedValue([{ path: 'src/a.ts', diff: 'd1' }]);
    (workspaceUtil.applyApprovedChanges as jest.Mock).mockResolvedValue({ appliedFiles: ['src/a.ts'], skippedFiles: [] });
    (codexCli.runCodexExecJson as jest.Mock).mockResolvedValue({
      area: 'BACKEND',
      planSummary: 'Fix the thing',
      candidateFiles: ['src/a.ts'],
      reason: null,
      touchesSchema: false,
    });
  });

  it('applies the change and completes with no human, when review is clean and verification passes', async () => {
    const prisma = makePrismaMock(makeWaitingReviewTask());
    const service = new AiEngineeringService(prisma as never, {} as never);
    (codexCli.runCodexAgent as jest.Mock)
      .mockResolvedValueOnce({ succeeded: true, summary: 'initial fix' })
      .mockResolvedValueOnce({ succeeded: true, summary: '{"safe": true, "summary": "no other usages found"}' });
    (workspaceUtil.runVerification as jest.Mock).mockResolvedValueOnce(passingVerification);

    await runPipeline(service, 't-1');

    expect(workspaceUtil.applyApprovedChanges).toHaveBeenCalledWith('/fake/ws', '/fake/project', ['src/a.ts'], {
      allowSchema: false,
    });
    expect(workspaceUtil.destroyWorkspace).toHaveBeenCalledWith('t-1');
    const lastUpdate = (prisma.aiEngineeringTask.update as jest.Mock).mock.calls.at(-1)![0].data;
    expect(lastUpdate).toMatchObject({ status: 'COMPLETED', autoApproved: true, reviewedById: undefined });
  });

  it('leaves it for a human when Val flags a concern, even though verification passes', async () => {
    const prisma = makePrismaMock(makeWaitingReviewTask());
    const service = new AiEngineeringService(prisma as never, {} as never);
    (codexCli.runCodexAgent as jest.Mock)
      .mockResolvedValueOnce({ succeeded: true, summary: 'initial fix' })
      .mockResolvedValueOnce({ succeeded: true, summary: '{"safe": false, "summary": "touches auth logic, take a look"}' });
    (workspaceUtil.runVerification as jest.Mock).mockResolvedValueOnce(passingVerification);

    await runPipeline(service, 't-1');

    expect(workspaceUtil.applyApprovedChanges).not.toHaveBeenCalled();
    const lastUpdate = (prisma.aiEngineeringTask.update as jest.Mock).mock.calls.at(-1)![0].data;
    expect(lastUpdate).toMatchObject({ status: 'WAITING_REVIEW', aiReviewPassed: false });
  });

  it('leaves it for a human when the task touches schema, even with a clean review and passing verification', async () => {
    (codexCli.runCodexExecJson as jest.Mock).mockResolvedValue({
      area: 'BACKEND',
      planSummary: 'Migrate the thing',
      candidateFiles: ['src/a.ts'],
      reason: null,
      touchesSchema: true,
    });
    const prisma = makePrismaMock(makeWaitingReviewTask({ touchesSchema: true }));
    const service = new AiEngineeringService(prisma as never, {} as never);
    (codexCli.runCodexAgent as jest.Mock)
      .mockResolvedValueOnce({ succeeded: true, summary: 'initial fix' })
      .mockResolvedValueOnce({ succeeded: true, summary: '{"safe": true, "summary": "clean"}' });
    (workspaceUtil.runVerification as jest.Mock).mockResolvedValueOnce(passingVerification);

    await runPipeline(service, 't-1');

    expect(workspaceUtil.applyApprovedChanges).not.toHaveBeenCalled();
    const lastUpdate = (prisma.aiEngineeringTask.update as jest.Mock).mock.calls.at(-1)![0].data;
    expect(lastUpdate).toMatchObject({ status: 'WAITING_REVIEW', aiReviewPassed: true });
  });

  it('leaves it for a human when verification fails, even with a clean review', async () => {
    const failingVerification = { tsc: { passed: false, output: 'error TS2345: bad' }, tests: { passed: true, output: '' } };
    const prisma = makePrismaMock(makeWaitingReviewTask());
    const service = new AiEngineeringService(prisma as never, {} as never);
    (codexCli.runCodexAgent as jest.Mock)
      .mockResolvedValueOnce({ succeeded: true, summary: 'initial fix' })
      .mockResolvedValueOnce({ succeeded: true, summary: 'repair 1' })
      .mockResolvedValueOnce({ succeeded: true, summary: 'repair 2' })
      .mockResolvedValueOnce({ succeeded: true, summary: '{"safe": true, "summary": "clean"}' });
    (workspaceUtil.runVerification as jest.Mock).mockResolvedValue(failingVerification);

    await runPipeline(service, 't-1');

    expect(workspaceUtil.applyApprovedChanges).not.toHaveBeenCalled();
    const lastUpdate = (prisma.aiEngineeringTask.update as jest.Mock).mock.calls.at(-1)![0].data;
    expect(lastUpdate.status).toBe('WAITING_REVIEW');
  });
});

describe('AiEngineeringService — reportRuntimeAnomaly (runtime-signal task source)', () => {
  // The third way a task can get created, alongside a human's bug report
  // and the nightly tsc/eslint scan — this one is for a caller (today,
  // ScannerService) that just measured something concrete and wrong about
  // TestPilot's own real output. Confirmed live: the scan-duplication bug
  // this was built for passed every tsc/eslint check, so neither of the
  // other two sources would ever have caught it on their own.
  function makeCreateTaskPrismaMock(existingOpenTaskDescriptions: string[] = []) {
    return {
      aiEngineeringTask: {
        findMany: jest.fn().mockResolvedValue(existingOpenTaskDescriptions.map((description) => ({ description }))),
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'task-1', status: 'PENDING', ...data })),
        // Only reached by the fire-and-forget runPipeline() this file isn't
        // testing (triage rejects immediately, see beforeEach below) — just
        // enough here to keep that expected, already-caught failure from
        // logging unrelated "X is not a function" noise under every test.
        findUnique: jest.fn().mockResolvedValue({ id: 'task-1', status: 'PENDING' }),
        update: jest.fn().mockResolvedValue(undefined),
      },
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    // reportRuntimeAnomaly fires the full pipeline fire-and-forget, same as
    // createTask/runScheduledScan — not what these tests are checking, and
    // its own rejection is already caught internally, so this just gives
    // it an explicit, honest failure instead of an unmocked undefined.
    (codexCli.runCodexExecJson as jest.Mock).mockRejectedValue(new Error('not exercised in this test'));
  });

  it('files a new task with source RUNTIME_ANOMALY when nothing is already open for this signal', async () => {
    const prisma = makeCreateTaskPrismaMock([]);
    const service = new AiEngineeringService(prisma as never, {} as never);

    const task = await service.reportRuntimeAnomaly({
      title: 'Scanner produced 25% duplicate pages',
      description: 'A completed scan captured real, measured duplicate pages.',
      dedupeKey: 'runtime-anomaly:scanner-duplicate-pages',
    });

    expect(task).not.toBeNull();
    expect(prisma.aiEngineeringTask.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ source: 'RUNTIME_ANOMALY', status: 'PENDING' }) }),
    );
  });

  it('does not file a duplicate task while one for the same signal is already open', async () => {
    const prisma = makeCreateTaskPrismaMock([
      'Some earlier task text [dedupe:runtime-anomaly:scanner-duplicate-pages]',
    ]);
    const service = new AiEngineeringService(prisma as never, {} as never);

    const task = await service.reportRuntimeAnomaly({
      title: 'Scanner produced 30% duplicate pages',
      description: 'More evidence of the same underlying defect.',
      dedupeKey: 'runtime-anomaly:scanner-duplicate-pages',
    });

    expect(task).toBeNull();
    expect(prisma.aiEngineeringTask.create).not.toHaveBeenCalled();
  });

  it('only checks OPEN tasks for the dedup match, not resolved ones', async () => {
    const prisma = makeCreateTaskPrismaMock([]);
    const service = new AiEngineeringService(prisma as never, {} as never);

    await service.reportRuntimeAnomaly({
      title: 'x',
      description: 'y',
      dedupeKey: 'runtime-anomaly:scanner-duplicate-pages',
    });

    expect(prisma.aiEngineeringTask.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: { in: ['PENDING', 'PLANNING', 'IN_PROGRESS', 'WAITING_REVIEW'] } } }),
    );
  });

  it('a different anomaly signal (a different dedupeKey) still files its own task independently', async () => {
    const prisma = makeCreateTaskPrismaMock([
      'An open task about something else [dedupe:runtime-anomaly:scanner-duplicate-pages]',
    ]);
    const service = new AiEngineeringService(prisma as never, {} as never);

    const task = await service.reportRuntimeAnomaly({
      title: 'Execution runs failing at an unusual rate',
      description: 'A completely different runtime signal.',
      dedupeKey: 'runtime-anomaly:execution-failure-spike',
    });

    expect(task).not.toBeNull();
  });
});

describe('scan output parsers', () => {
  it('parses real tsc --noEmit output into distinct file+message findings', () => {
    const output = [
      "src/modules/execution/execution.service.spec.ts(70,123): error TS2345: Argument of type 'undefined' is not assignable to parameter of type 'never'.",
      "src/modules/execution/execution.service.spec.ts(148,108): error TS2345: Argument of type 'undefined' is not assignable to parameter of type 'never'.",
    ].join('\n');

    const findings = parseTscFindings(output, 'BACKEND');

    expect(findings).toHaveLength(2);
    expect(findings[0]).toMatchObject({ area: 'BACKEND', file: 'src/modules/execution/execution.service.spec.ts' });
    expect(findings[0].message).toContain('TS2345');
  });

  it('returns no findings for clean tsc output', () => {
    expect(parseTscFindings('', 'BACKEND')).toEqual([]);
  });

  it('parses real eslint stylish output into distinct file+message findings, errors only', () => {
    const projectDir = 'D:\\TestPilot\\frontend-v2';
    const output = [
      `${projectDir}\\src\\app\\(dashboard)\\object-library\\page.tsx`,
      "  100:77  error  `'` can be escaped with `&apos;`  react/no-unescaped-entities",
      '',
      `${projectDir}\\src\\app\\(dashboard)\\executions\\page.tsx`,
      '  212:21  warning  Using `<img>` could result in slower LCP  @next/next/no-img-element',
    ].join('\n');

    const findings = parseEslintFindings(output, 'FRONTEND', projectDir);

    expect(findings).toHaveLength(1);
    expect(findings[0].file).toBe('src/app/(dashboard)/object-library/page.tsx');
    expect(findings[0].message).toContain("can be escaped");
  });

  it('still captures a violation whose rule id trails a multi-line message + code frame', () => {
    // Real captured shape from react-hooks/set-state-in-effect — the rule id
    // appears many lines after the line:col header, inside a code frame.
    const projectDir = 'D:\\TestPilot\\frontend-v2';
    const output = [
      `${projectDir}\\src\\app\\(dashboard)\\settings\\page.tsx`,
      '  120:17  error  Error: Calling setState synchronously within an effect can trigger cascading renders',
      '',
      'Effects are intended to synchronize state between React and external systems.',
      '',
      `${projectDir}\\src\\app\\(dashboard)\\settings\\page.tsx:120:17`,
      '  119 |   useEffect(() => {',
      '> 120 |     if (policy) setForm(policy);',
      '      |                 ^^^^^^^ Avoid calling setState() directly within an effect',
      '  121 |   }, [policy]);',
      '  123 |   const saveMutation = useMutation({  react-hooks/set-state-in-effect',
    ].join('\n');

    const findings = parseEslintFindings(output, 'FRONTEND', projectDir);

    expect(findings).toHaveLength(1);
    expect(findings[0].file).toBe('src/app/(dashboard)/settings/page.tsx');
    expect(findings[0].message).toContain('Calling setState synchronously');
  });
});
