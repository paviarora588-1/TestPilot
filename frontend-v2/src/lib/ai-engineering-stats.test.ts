import { describe, expect, it } from 'vitest';
import { computeAiEngineeringStats, extractTestSummary, formatDurationMs } from './ai-engineering-stats';
import type { AiEngineeringTask } from './types';

function makeTask(overrides: Partial<AiEngineeringTask>): AiEngineeringTask {
  return {
    id: 'task-1',
    title: 'Some bug',
    description: 'desc',
    reproSteps: null,
    severity: 'MEDIUM',
    status: 'COMPLETED',
    area: 'BACKEND',
    source: 'HUMAN_REPORT',
    friendlySummary: null,
    planSummary: null,
    specialistSummary: null,
    diffSummary: null,
    verificationJson: null,
    repairAttempts: 0,
    touchesSchema: false,
    migrationSql: null,
    aiReviewPassed: null,
    aiReviewSummary: null,
    secondaryDiffSummary: null,
    secondaryVerificationJson: null,
    secondaryRepairAttempts: 0,
    secondaryAiReviewPassed: null,
    secondaryAiReviewSummary: null,
    errorMessage: null,
    createdById: null,
    reviewedById: null,
    autoApproved: false,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    completedAt: null,
    ...overrides,
  };
}

describe('computeAiEngineeringStats', () => {
  it('returns all-null/zero stats for an empty task list', () => {
    const stats = computeAiEngineeringStats([]);
    expect(stats.total).toBe(0);
    expect(stats.successRatePct).toBeNull();
    expect(stats.pctNeedingRepair).toBeNull();
    expect(stats.avgTimeToFixMs).toBeNull();
  });

  it('computes success rate from completed vs. rejected+failed, ignoring in-flight tasks', () => {
    const tasks = [
      makeTask({ id: '1', status: 'COMPLETED' }),
      makeTask({ id: '2', status: 'COMPLETED' }),
      makeTask({ id: '3', status: 'REJECTED' }),
      makeTask({ id: '4', status: 'PENDING' }), // in-flight, excluded from the rate
    ];
    const stats = computeAiEngineeringStats(tasks);
    expect(stats.total).toBe(4);
    expect(stats.inFlight).toBe(1);
    expect(stats.successRatePct).toBeCloseTo((2 / 3) * 100);
  });

  it('counts NEEDS_HUMAN tasks separately from failed/rejected', () => {
    const tasks = [makeTask({ id: '1', area: 'NEEDS_HUMAN', status: 'PENDING' })];
    const stats = computeAiEngineeringStats(tasks);
    expect(stats.needsHuman).toBe(1);
    expect(stats.failed).toBe(0);
  });

  it('computes the repair rate only across verified (completed/waiting-review) tasks', () => {
    const tasks = [
      makeTask({ id: '1', status: 'COMPLETED', repairAttempts: 1 }),
      makeTask({ id: '2', status: 'COMPLETED', repairAttempts: 0 }),
      makeTask({ id: '3', status: 'FAILED', repairAttempts: 2 }), // not verified, excluded
    ];
    const stats = computeAiEngineeringStats(tasks);
    expect(stats.pctNeedingRepair).toBeCloseTo(50);
  });

  it('averages time-to-fix in milliseconds across completed tasks with a completedAt', () => {
    const tasks = [
      makeTask({
        id: '1',
        status: 'COMPLETED',
        createdAt: '2026-08-01T00:00:00.000Z',
        completedAt: '2026-08-01T00:01:00.000Z', // 60s
      }),
      makeTask({
        id: '2',
        status: 'COMPLETED',
        createdAt: '2026-08-01T00:00:00.000Z',
        completedAt: '2026-08-01T00:03:00.000Z', // 180s
      }),
    ];
    const stats = computeAiEngineeringStats(tasks);
    expect(stats.avgTimeToFixMs).toBe(120_000);
  });
});

describe('extractTestSummary', () => {
  it('pulls out only the Test Suites / Tests summary lines from raw jest output', () => {
    const raw = [
      '[Nest] some noisy startup log',
      'console.error some intentional test-fixture noise',
      'Test Suites: 15 passed, 15 total',
      'Tests:       140 passed, 140 total',
      'Snapshots:   0 total',
      'Time:        7.05 s',
    ].join('\n');
    expect(extractTestSummary(raw)).toBe('Test Suites: 15 passed, 15 total\nTests:       140 passed, 140 total');
  });

  it('returns null when the output has no Tests: line (e.g. tsc output, not jest)', () => {
    expect(extractTestSummary('src/foo.ts(3,1): error TS2345: bad types')).toBeNull();
  });
});

describe('formatDurationMs', () => {
  it('formats sub-minute durations as whole seconds', () => {
    expect(formatDurationMs(45_000)).toBe('45s');
  });

  it('formats minute-scale durations as Xm Ys, dropping the seconds when they are zero', () => {
    expect(formatDurationMs(90_000)).toBe('1m 30s');
    expect(formatDurationMs(120_000)).toBe('2m');
  });

  it('formats hour-scale durations as Xh Ym, dropping the minutes when they are zero', () => {
    expect(formatDurationMs(3_660_000)).toBe('1h 1m');
    expect(formatDurationMs(3_600_000)).toBe('1h');
  });
});
