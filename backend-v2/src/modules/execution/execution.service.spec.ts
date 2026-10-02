jest.mock('./locator-health.util');
jest.mock('fs/promises');

import * as fs from 'fs/promises';
import { ExecutionService } from './execution.service';
import { verifyLocatorLive } from './locator-health.util';

// Regression baseline for the execution dispatch path, written before any
// SAP-focused change lands — runLocked() routes purely on script.framework,
// and this must keep routing PLAYWRIGHT/SELENIUM exactly as before once
// SAP_VBSCRIPT/HYBRID handling is extended.

function makePrismaMock(scriptFramework: string) {
  return {
    generatedScript: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'script-1',
        applicationId: 'app-1',
        framework: scriptFramework,
        files: [],
        automationFlow: { steps: [] },
      }),
    },
    executionRun: {
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'run-1', ...data })),
      findUnique: jest.fn().mockResolvedValue({ status: 'RUNNING', scriptId: 'script-1' }),
      update: jest.fn().mockResolvedValue(undefined),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    executionStepResult: {
      create: jest.fn().mockResolvedValue(undefined),
      createMany: jest.fn().mockResolvedValue(undefined),
      updateMany: jest.fn().mockResolvedValue(undefined),
      deleteMany: jest.fn().mockResolvedValue(undefined),
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
}

function makeService(scriptFramework: string) {
  const prisma = makePrismaMock(scriptFramework);
  const goldenRule = { checkScriptExecutionBlockers: jest.fn().mockResolvedValue({ blocked: false }) };
  const ragService = {};
  const bugReportsService = {};
  const aiProvider = {};
  const scriptGenerator = { compileFlowForValidation: jest.fn() };
  const service = new ExecutionService(
    prisma as never,
    goldenRule as never,
    ragService as never,
    bugReportsService as never,
    aiProvider as never,
    scriptGenerator as never,
  );
  return { service, prisma };
}

describe('ExecutionService — framework dispatch', () => {
  const HANDLERS = ['runPlaywrightLocked', 'runSeleniumLocked', 'runSapGuiLocked', 'runHybridLocked'] as const;

  // withWatchdog() schedules a real setTimeout (up to 195s for Playwright)
  // that it never clears once the guarded work finishes first — harmless in
  // a long-lived server process, but a live timer handle keeps a Jest worker
  // from exiting cleanly. Fake timers avoid creating a real OS timer at all,
  // so there's nothing left dangling once the test finishes.
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] });
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  function spyOnAllHandlers(service: ExecutionService) {
    const spies = Object.fromEntries(
      HANDLERS.map((name) => [name, jest.spyOn(service as never as Record<string, () => unknown>, name).mockImplementation(async () => {})]),
    ) as Record<(typeof HANDLERS)[number], jest.SpyInstance>;
    return spies;
  }

  it('a PLAYWRIGHT script dispatches to runPlaywrightLocked only', async () => {
    const { service } = makeService('PLAYWRIGHT');
    const spies = spyOnAllHandlers(service);

    await service.executeScript('script-1');
    await jest.advanceTimersByTimeAsync(0);

    expect(spies.runPlaywrightLocked).toHaveBeenCalled();
    expect(spies.runSeleniumLocked).not.toHaveBeenCalled();
    expect(spies.runSapGuiLocked).not.toHaveBeenCalled();
    expect(spies.runHybridLocked).not.toHaveBeenCalled();
  });

  it('a SELENIUM script dispatches to runSeleniumLocked only', async () => {
    const { service } = makeService('SELENIUM');
    const spies = spyOnAllHandlers(service);

    await service.executeScript('script-1');
    await jest.advanceTimersByTimeAsync(0);

    expect(spies.runSeleniumLocked).toHaveBeenCalled();
    expect(spies.runPlaywrightLocked).not.toHaveBeenCalled();
    expect(spies.runSapGuiLocked).not.toHaveBeenCalled();
    expect(spies.runHybridLocked).not.toHaveBeenCalled();
  });

  it('a SAP_VBSCRIPT script dispatches to runSapGuiLocked only', async () => {
    const { service } = makeService('SAP_VBSCRIPT');
    const spies = spyOnAllHandlers(service);

    await service.executeScript('script-1');
    await jest.advanceTimersByTimeAsync(0);

    expect(spies.runSapGuiLocked).toHaveBeenCalled();
    expect(spies.runPlaywrightLocked).not.toHaveBeenCalled();
    expect(spies.runSeleniumLocked).not.toHaveBeenCalled();
    expect(spies.runHybridLocked).not.toHaveBeenCalled();
  });

  it('a HYBRID script dispatches to runHybridLocked only', async () => {
    const { service } = makeService('HYBRID');
    const spies = spyOnAllHandlers(service);

    await service.executeScript('script-1');
    await jest.advanceTimersByTimeAsync(0);

    expect(spies.runHybridLocked).toHaveBeenCalled();
    expect(spies.runPlaywrightLocked).not.toHaveBeenCalled();
    expect(spies.runSeleniumLocked).not.toHaveBeenCalled();
    expect(spies.runSapGuiLocked).not.toHaveBeenCalled();
  });

  it('an unrecognized framework value defaults to the Playwright handler, same as today', async () => {
    const { service } = makeService('SOMETHING_UNEXPECTED');
    const spies = spyOnAllHandlers(service);

    await service.executeScript('script-1');
    await jest.advanceTimersByTimeAsync(0);

    expect(spies.runPlaywrightLocked).toHaveBeenCalled();
  });
});

describe('ExecutionService — retryRun attempt tracking', () => {
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] });
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('increments attemptNumber on the same run row when retrying', async () => {
    const { service, prisma } = makeService('PLAYWRIGHT');
    jest.spyOn(service as never as Record<string, () => unknown>, 'runPlaywrightLocked').mockImplementation(async () => {});

    await service.retryRun('run-1');
    await jest.advanceTimersByTimeAsync(0);

    expect(prisma.executionRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'run-1', status: { in: ['FAILED', 'BLOCKED'] } },
        data: expect.objectContaining({ attemptNumber: { increment: 1 } }),
      }),
    );
  });
});

describe('ExecutionService — runQualityWatch (Continuous Locator Health Watch)', () => {
  const mockVerify = verifyLocatorLive as jest.Mock;

  function makeQualityWatchPrisma(objects: Array<Record<string, unknown>>) {
    return {
      automationPolicySetting: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'policy-1', applicationId: 'app-1', qualityWatchEnabled: true, qualityWatchMaxObjectsPerRun: 25 },
        ]),
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue(undefined),
      },
      application: {
        findUnique: jest.fn().mockResolvedValue({ id: 'app-1', entryUrl: 'http://example.com/login' }),
      },
      objectRepository: {
        findMany: jest.fn().mockResolvedValue(objects),
        update: jest.fn().mockResolvedValue(undefined),
      },
      autoHealSuggestion: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(undefined),
      },
    };
  }

  function makeQualityWatchService(prisma: ReturnType<typeof makeQualityWatchPrisma>) {
    return new ExecutionService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
  }

  afterEach(() => jest.clearAllMocks());

  it('does nothing when no application has quality watch enabled', async () => {
    const prisma = makeQualityWatchPrisma([]);
    prisma.automationPolicySetting.findMany.mockResolvedValue([]);
    const service = makeQualityWatchService(prisma);

    await service.runQualityWatch();

    expect(prisma.objectRepository.findMany).not.toHaveBeenCalled();
  });

  it('marks an object WORKING and stamps lastValidatedAt when its locator still resolves', async () => {
    const object = {
      id: 'obj-1',
      technicalPath: '#login',
      locatorStrategy: 'ID',
      confidenceScore: 0.9,
      backupLocators: [],
      sourceScanObject: null,
    };
    const prisma = makeQualityWatchPrisma([object]);
    mockVerify.mockResolvedValue({ resolves: true, ambiguous: false });
    const service = makeQualityWatchService(prisma);

    await service.runQualityWatch();

    expect(prisma.objectRepository.update).toHaveBeenCalledWith({
      where: { id: 'obj-1' },
      data: { verificationStatus: 'WORKING', lastValidatedAt: expect.any(Date) },
    });
    expect(prisma.autoHealSuggestion.create).not.toHaveBeenCalled();
  });

  it('creates a PENDING suggestion when the primary locator is broken but a backup resolves live', async () => {
    const object = {
      id: 'obj-2',
      technicalPath: '#old-button',
      locatorStrategy: 'ID',
      confidenceScore: 0.8,
      backupLocators: ['#new-button'],
      sourceScanObject: null,
    };
    const prisma = makeQualityWatchPrisma([object]);
    mockVerify.mockImplementation(async (_url: string, path: string) =>
      path === '#new-button' ? { resolves: true, ambiguous: false } : { resolves: false, ambiguous: false },
    );
    const service = makeQualityWatchService(prisma);

    await service.runQualityWatch();

    expect(prisma.autoHealSuggestion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          applicationId: 'app-1',
          objectId: 'obj-2',
          executionId: null,
          oldPath: '#old-button',
          suggestedPath: '#new-button',
          status: 'PENDING',
        }),
      }),
    );
    // Never writes technicalPath itself — only decideAutoHeal (on human
    // approval) is allowed to do that.
    expect(prisma.objectRepository.update).toHaveBeenCalledWith({
      where: { id: 'obj-2' },
      data: { lastValidatedAt: expect.any(Date) },
    });
  });

  it('does not create a duplicate suggestion when one is already PENDING for the same object', async () => {
    const object = {
      id: 'obj-3',
      technicalPath: '#old-button',
      locatorStrategy: 'ID',
      confidenceScore: 0.8,
      backupLocators: ['#new-button'],
      sourceScanObject: null,
    };
    const prisma = makeQualityWatchPrisma([object]);
    prisma.autoHealSuggestion.findFirst.mockResolvedValue({ id: 'existing-suggestion' });
    mockVerify.mockImplementation(async (_url: string, path: string) =>
      path === '#new-button' ? { resolves: true, ambiguous: false } : { resolves: false, ambiguous: false },
    );
    const service = makeQualityWatchService(prisma);

    await service.runQualityWatch();

    expect(prisma.autoHealSuggestion.create).not.toHaveBeenCalled();
  });

  it('marks an object BROKEN with no suggestion when neither the primary locator nor any backup resolves', async () => {
    const object = {
      id: 'obj-4',
      technicalPath: '#gone',
      locatorStrategy: 'ID',
      confidenceScore: 0.8,
      backupLocators: ['#also-gone'],
      sourceScanObject: null,
    };
    const prisma = makeQualityWatchPrisma([object]);
    mockVerify.mockResolvedValue({ resolves: false, ambiguous: false });
    const service = makeQualityWatchService(prisma);

    await service.runQualityWatch();

    expect(prisma.objectRepository.update).toHaveBeenCalledWith({
      where: { id: 'obj-4' },
      data: { verificationStatus: 'BROKEN', lastValidatedAt: expect.any(Date) },
    });
    expect(prisma.autoHealSuggestion.create).not.toHaveBeenCalled();
  });

  it("falls back to the application's entryUrl when an object has no source scan page", async () => {
    const object = {
      id: 'obj-5',
      technicalPath: '#login',
      locatorStrategy: 'ID',
      confidenceScore: 0.9,
      backupLocators: [],
      sourceScanObject: null,
    };
    const prisma = makeQualityWatchPrisma([object]);
    mockVerify.mockResolvedValue({ resolves: true, ambiguous: false });
    const service = makeQualityWatchService(prisma);

    await service.runQualityWatch();

    expect(mockVerify).toHaveBeenCalledWith('http://example.com/login', '#login', 'ID');
  });

  it('prefers the source scan page URL over the application entryUrl when both exist', async () => {
    const object = {
      id: 'obj-6',
      technicalPath: '#login',
      locatorStrategy: 'ID',
      confidenceScore: 0.9,
      backupLocators: [],
      sourceScanObject: { scanPage: { url: 'http://example.com/exact-page' } },
    };
    const prisma = makeQualityWatchPrisma([object]);
    mockVerify.mockResolvedValue({ resolves: true, ambiguous: false });
    const service = makeQualityWatchService(prisma);

    await service.runQualityWatch();

    expect(mockVerify).toHaveBeenCalledWith('http://example.com/exact-page', '#login', 'ID');
  });

  it('records qualityWatchLastRunAt for the processed application', async () => {
    const object = {
      id: 'obj-7',
      technicalPath: '#login',
      locatorStrategy: 'ID',
      confidenceScore: 0.9,
      backupLocators: [],
      sourceScanObject: null,
    };
    const prisma = makeQualityWatchPrisma([object]);
    mockVerify.mockResolvedValue({ resolves: true, ambiguous: false });
    const service = makeQualityWatchService(prisma);

    await service.runQualityWatch();

    expect(prisma.automationPolicySetting.update).toHaveBeenCalledWith({
      where: { id: 'policy-1' },
      data: { qualityWatchLastRunAt: expect.any(Date) },
    });
  });
});

describe('ExecutionService — runQualityWatchNow (on-demand trigger)', () => {
  const mockVerify = verifyLocatorLive as jest.Mock;

  function makePrisma(objects: Array<Record<string, unknown>>, policy: Record<string, unknown> | null) {
    return {
      automationPolicySetting: {
        findFirst: jest.fn().mockResolvedValue(policy),
        update: jest.fn().mockResolvedValue(undefined),
      },
      application: {
        findUnique: jest.fn().mockResolvedValue({ id: 'app-1', entryUrl: 'http://example.com/login' }),
      },
      objectRepository: {
        findMany: jest.fn().mockResolvedValue(objects),
        update: jest.fn().mockResolvedValue(undefined),
      },
      autoHealSuggestion: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(undefined),
      },
    };
  }

  function makeService(prisma: ReturnType<typeof makePrisma>) {
    return new ExecutionService(prisma as never, {} as never, {} as never, {} as never, {} as never, {} as never);
  }

  afterEach(() => jest.clearAllMocks());

  it('runs even when no policy row exists yet for this application, using the default object cap', async () => {
    const object = { id: 'obj-1', technicalPath: '#login', locatorStrategy: 'ID', confidenceScore: 0.9, backupLocators: [], sourceScanObject: null };
    const prisma = makePrisma([object], null);
    mockVerify.mockResolvedValue({ resolves: true, ambiguous: false });
    const service = makeService(prisma);

    const result = await service.runQualityWatchNow('app-1');

    expect(result).toEqual({ checked: 1 });
    expect(prisma.automationPolicySetting.update).not.toHaveBeenCalled();
  });

  it('runs even when qualityWatchEnabled is off, since clicking "Run now" is explicit intent', async () => {
    const object = { id: 'obj-1', technicalPath: '#login', locatorStrategy: 'ID', confidenceScore: 0.9, backupLocators: [], sourceScanObject: null };
    const prisma = makePrisma([object], { id: 'policy-1', applicationId: 'app-1', qualityWatchEnabled: false, qualityWatchMaxObjectsPerRun: 10 });
    mockVerify.mockResolvedValue({ resolves: true, ambiguous: false });
    const service = makeService(prisma);

    const result = await service.runQualityWatchNow('app-1');

    expect(result).toEqual({ checked: 1 });
    expect(prisma.objectRepository.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 10 }));
  });

  it('records qualityWatchLastRunAt when a policy row does exist', async () => {
    const object = { id: 'obj-1', technicalPath: '#login', locatorStrategy: 'ID', confidenceScore: 0.9, backupLocators: [], sourceScanObject: null };
    const prisma = makePrisma([object], { id: 'policy-1', applicationId: 'app-1', qualityWatchEnabled: true, qualityWatchMaxObjectsPerRun: 25 });
    mockVerify.mockResolvedValue({ resolves: true, ambiguous: false });
    const service = makeService(prisma);

    await service.runQualityWatchNow('app-1');

    expect(prisma.automationPolicySetting.update).toHaveBeenCalledWith({
      where: { id: 'policy-1' },
      data: { qualityWatchLastRunAt: expect.any(Date) },
    });
  });
});

describe('ExecutionService — listAutoHealSuggestions decider name resolution', () => {
  function makePrisma(suggestions: Array<Record<string, unknown>>, users: Array<{ id: string; name: string }>) {
    return {
      autoHealSuggestion: {
        findMany: jest.fn().mockResolvedValue(suggestions),
      },
      user: {
        findMany: jest.fn().mockResolvedValue(users),
      },
    };
  }

  function makeService(prisma: ReturnType<typeof makePrisma>) {
    return new ExecutionService(prisma as never, {} as never, {} as never, {} as never, {} as never, {} as never);
  }

  it('resolves decidedById to a real name for decided suggestions', async () => {
    const prisma = makePrisma(
      [{ id: 'sugg-1', status: 'APPROVED', decidedById: 'user-1' }],
      [{ id: 'user-1', name: 'Alex Rivera' }],
    );
    const service = makeService(prisma);

    const result = await service.listAutoHealSuggestions('app-1');

    expect(prisma.user.findMany).toHaveBeenCalledWith({ where: { id: { in: ['user-1'] } }, select: { id: true, name: true } });
    expect(result[0].decidedByName).toBe('Alex Rivera');
  });

  it('leaves decidedByName null for suggestions nobody has decided on yet', async () => {
    const prisma = makePrisma([{ id: 'sugg-2', status: 'PENDING', decidedById: null }], []);
    const service = makeService(prisma);

    const result = await service.listAutoHealSuggestions('app-1');

    expect(prisma.user.findMany).not.toHaveBeenCalled();
    expect(result[0].decidedByName).toBeNull();
  });

  it('dedupes repeated decidedById values into a single user lookup', async () => {
    const prisma = makePrisma(
      [
        { id: 'sugg-3', status: 'APPROVED', decidedById: 'user-1' },
        { id: 'sugg-4', status: 'REJECTED', decidedById: 'user-1' },
      ],
      [{ id: 'user-1', name: 'Alex Rivera' }],
    );
    const service = makeService(prisma);

    await service.listAutoHealSuggestions('app-1');

    expect(prisma.user.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.user.findMany).toHaveBeenCalledWith({ where: { id: { in: ['user-1'] } }, select: { id: true, name: true } });
  });
});

// Reactive fallback for when no recorded backup locator works either — a
// live AI re-scan of the page at the exact moment of failure (see
// playwright-compiler.ts's per-step try/catch). Deliberately fire-and-forget
// from suggestAutoHeal (see that method's own comment) since generateJson
// can legitimately take up to ~10 minutes on this local Ollama setup.
describe('ExecutionService — AI DOM-based auto-heal (attemptAiDomHeal)', () => {
  const failedObject = {
    id: 'obj-1',
    objectName: 'Incident Patterns',
    displayLabel: null,
    objectType: 'button',
    moduleName: null,
    featureName: null,
    screenName: 'ThreatDetectionDashboard',
    technicalPath: '#__filter1',
  };

  function makePrisma() {
    return {
      autoHealSuggestion: { create: jest.fn().mockResolvedValue(undefined) },
      objectRepository: { update: jest.fn().mockResolvedValue(undefined) },
    };
  }

  function makeService(prisma: ReturnType<typeof makePrisma>, aiProvider: object, goldenRule: object) {
    return new ExecutionService(prisma as never, goldenRule as never, {} as never, {} as never, aiProvider as never, {} as never);
  }

  function callAttemptAiDomHeal(service: ExecutionService, ...args: unknown[]) {
    return (service as unknown as { attemptAiDomHeal(...a: unknown[]): Promise<void> }).attemptAiDomHeal(...args);
  }

  afterEach(() => jest.clearAllMocks());

  it('auto-applies and creates an APPROVED, autoApproved suggestion when confidence clears the high bar (0.9)', async () => {
    (fs.readFile as jest.Mock).mockResolvedValue(JSON.stringify({ candidates: [{ label: 'Incident Patterns', objectType: 'button', recommendedLocator: '#newFilter' }] }));
    const aiProvider = { generateJson: jest.fn().mockResolvedValue({ matchedLocator: '#newFilter', confidence: 0.95 }) };
    const goldenRule = { getPolicyForApplication: jest.fn().mockResolvedValue({ minimumMappingConfidence: 0.7 }) };
    const prisma = makePrisma();
    const service = makeService(prisma, aiProvider, goldenRule);

    await callAttemptAiDomHeal(service, 'app-1', 'exec-1', failedObject, '/fake/dump.json', 'locator timed out');

    expect(prisma.objectRepository.update).toHaveBeenCalledWith({
      where: { id: 'obj-1' },
      data: { technicalPath: '#newFilter', verificationStatus: 'WORKING', lastValidatedAt: expect.any(Date) },
    });
    expect(prisma.autoHealSuggestion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'APPROVED', autoApproved: true, suggestedPath: '#newFilter', confidence: 0.95 }),
      }),
    );
  });

  it('creates a PENDING, non-auto-approved suggestion when confidence clears the mapping bar but not the auto-apply bar', async () => {
    (fs.readFile as jest.Mock).mockResolvedValue(JSON.stringify({ candidates: [{ label: 'Incident Patterns', objectType: 'button', recommendedLocator: '#newFilter' }] }));
    const aiProvider = { generateJson: jest.fn().mockResolvedValue({ matchedLocator: '#newFilter', confidence: 0.8 }) };
    const goldenRule = { getPolicyForApplication: jest.fn().mockResolvedValue({ minimumMappingConfidence: 0.7 }) };
    const prisma = makePrisma();
    const service = makeService(prisma, aiProvider, goldenRule);

    await callAttemptAiDomHeal(service, 'app-1', 'exec-1', failedObject, '/fake/dump.json', 'locator timed out');

    expect(prisma.objectRepository.update).not.toHaveBeenCalled();
    expect(prisma.autoHealSuggestion.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'PENDING', autoApproved: false, confidence: 0.8 }) }),
    );
  });

  it('creates no suggestion when confidence is below the ordinary mapping-confidence bar', async () => {
    (fs.readFile as jest.Mock).mockResolvedValue(JSON.stringify({ candidates: [{ label: 'Incident Patterns', objectType: 'button', recommendedLocator: '#newFilter' }] }));
    const aiProvider = { generateJson: jest.fn().mockResolvedValue({ matchedLocator: '#newFilter', confidence: 0.5 }) };
    const goldenRule = { getPolicyForApplication: jest.fn().mockResolvedValue({ minimumMappingConfidence: 0.7 }) };
    const prisma = makePrisma();
    const service = makeService(prisma, aiProvider, goldenRule);

    await callAttemptAiDomHeal(service, 'app-1', 'exec-1', failedObject, '/fake/dump.json', 'locator timed out');

    expect(prisma.objectRepository.update).not.toHaveBeenCalled();
    expect(prisma.autoHealSuggestion.create).not.toHaveBeenCalled();
  });

  it('creates no suggestion when the AI finds no confident match at all', async () => {
    (fs.readFile as jest.Mock).mockResolvedValue(JSON.stringify({ candidates: [{ label: 'Incident Patterns', objectType: 'button', recommendedLocator: '#newFilter' }] }));
    const aiProvider = { generateJson: jest.fn().mockResolvedValue({ matchedLocator: null, confidence: 0 }) };
    const goldenRule = { getPolicyForApplication: jest.fn().mockResolvedValue({ minimumMappingConfidence: 0.7 }) };
    const prisma = makePrisma();
    const service = makeService(prisma, aiProvider, goldenRule);

    await callAttemptAiDomHeal(service, 'app-1', 'exec-1', failedObject, '/fake/dump.json', 'locator timed out');

    expect(prisma.autoHealSuggestion.create).not.toHaveBeenCalled();
  });

  it('swallows a missing/corrupt dump file — no suggestion, no throw', async () => {
    (fs.readFile as jest.Mock).mockRejectedValue(new Error('ENOENT'));
    const aiProvider = { generateJson: jest.fn() };
    const goldenRule = { getPolicyForApplication: jest.fn() };
    const prisma = makePrisma();
    const service = makeService(prisma, aiProvider, goldenRule);

    await expect(callAttemptAiDomHeal(service, 'app-1', 'exec-1', failedObject, '/fake/dump.json', 'locator timed out')).resolves.toBeUndefined();

    expect(aiProvider.generateJson).not.toHaveBeenCalled();
    expect(prisma.autoHealSuggestion.create).not.toHaveBeenCalled();
  });

  it('swallows a generateJson failure — no suggestion, no throw', async () => {
    (fs.readFile as jest.Mock).mockResolvedValue(JSON.stringify({ candidates: [{ label: 'x', objectType: 'button', recommendedLocator: '#y' }] }));
    const aiProvider = { generateJson: jest.fn().mockRejectedValue(new Error('model unreachable')) };
    const goldenRule = { getPolicyForApplication: jest.fn() };
    const prisma = makePrisma();
    const service = makeService(prisma, aiProvider, goldenRule);

    await expect(callAttemptAiDomHeal(service, 'app-1', 'exec-1', failedObject, '/fake/dump.json', 'locator timed out')).resolves.toBeUndefined();

    expect(prisma.autoHealSuggestion.create).not.toHaveBeenCalled();
  });
});

describe('ExecutionService — suggestAutoHeal fallback wiring', () => {
  function callSuggestAutoHeal(service: ExecutionService, ...args: unknown[]) {
    return (service as unknown as { suggestAutoHeal(...a: unknown[]): Promise<void> }).suggestAutoHeal(...args);
  }

  const scriptWithBackup = {
    applicationId: 'app-1',
    automationFlow: {
      steps: [
        {
          stepOrder: 7,
          object: {
            id: 'obj-1',
            technicalPath: '#gone',
            backupLocators: ['#backup'],
            objectName: 'Incident Patterns',
            displayLabel: null,
            objectType: 'button',
            moduleName: null,
            featureName: null,
            screenName: 'ThreatDetectionDashboard',
            confidenceScore: 0.9,
          },
        },
      ],
    },
  };

  const scriptWithNoBackup = {
    applicationId: 'app-1',
    automationFlow: {
      steps: [
        {
          stepOrder: 7,
          object: {
            id: 'obj-1',
            technicalPath: '#gone',
            backupLocators: [],
            objectName: 'Incident Patterns',
            displayLabel: null,
            objectType: 'button',
            moduleName: null,
            featureName: null,
            screenName: 'ThreatDetectionDashboard',
            confidenceScore: 0.9,
          },
        },
      ],
    },
  };

  afterEach(() => jest.clearAllMocks());

  it('a working backup locator short-circuits before ever touching AI (unchanged fast path)', async () => {
    const aiProvider = { generateJson: jest.fn() };
    const prisma = { autoHealSuggestion: { create: jest.fn().mockResolvedValue(undefined) }, objectRepository: { update: jest.fn() } };
    const service = new ExecutionService(prisma as never, {} as never, {} as never, {} as never, aiProvider as never, {} as never);

    await callSuggestAutoHeal(service, 'exec-1', scriptWithBackup, 7, 'locator timed out', '/fake/dump.json');

    expect(aiProvider.generateJson).not.toHaveBeenCalled();
    expect(prisma.autoHealSuggestion.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ suggestedPath: '#backup', status: 'PENDING' }) }),
    );
  });

  it('no domDumpPath means the AI path is never attempted at all', async () => {
    (fs.readFile as jest.Mock).mockClear();
    const aiProvider = { generateJson: jest.fn() };
    const prisma = { autoHealSuggestion: { create: jest.fn() }, objectRepository: { update: jest.fn() } };
    const service = new ExecutionService(prisma as never, {} as never, {} as never, {} as never, aiProvider as never, {} as never);

    await callSuggestAutoHeal(service, 'exec-1', scriptWithNoBackup, 7, 'locator timed out', undefined);
    await Promise.resolve(); // flush any stray microtask

    expect(fs.readFile).not.toHaveBeenCalled();
    expect(aiProvider.generateJson).not.toHaveBeenCalled();
  });

  it("suggestAutoHeal's own promise resolves without waiting for the AI call to finish (the actual fire-and-forget guarantee)", async () => {
    (fs.readFile as jest.Mock).mockResolvedValue(JSON.stringify({ candidates: [{ label: 'x', objectType: 'button', recommendedLocator: '#y' }] }));
    let releaseAiCall: () => void = () => undefined;
    const aiCallGate = new Promise<{ matchedLocator: string; confidence: number }>((resolve) => {
      releaseAiCall = () => resolve({ matchedLocator: '#y', confidence: 0.95 });
    });
    const aiProvider = { generateJson: jest.fn().mockReturnValue(aiCallGate) };
    const goldenRule = { getPolicyForApplication: jest.fn().mockResolvedValue({ minimumMappingConfidence: 0.7 }) };
    const prisma = { autoHealSuggestion: { create: jest.fn().mockResolvedValue(undefined) }, objectRepository: { update: jest.fn().mockResolvedValue(undefined) } };
    const service = new ExecutionService(prisma as never, goldenRule as never, {} as never, {} as never, aiProvider as never, {} as never);

    // suggestAutoHeal must resolve even though the AI call it kicked off is
    // still pending — that's the whole point of not awaiting it.
    await callSuggestAutoHeal(service, 'exec-1', scriptWithNoBackup, 7, 'locator timed out', '/fake/dump.json');
    expect(prisma.autoHealSuggestion.create).not.toHaveBeenCalled();

    releaseAiCall();
    await aiCallGate;
    await Promise.resolve();
    await Promise.resolve();

    expect(prisma.autoHealSuggestion.create).toHaveBeenCalled();
  });
});
