import type { AiEngineeringTask } from './types';

const IN_FLIGHT_STATUSES = new Set(['PENDING', 'PLANNING', 'IN_PROGRESS', 'WAITING_REVIEW']);

export interface AiEngineeringStats {
  total: number;
  completed: number;
  rejected: number;
  failed: number;
  needsHuman: number;
  inFlight: number;
  awaitingReview: number;
  successRatePct: number | null;
  pctNeedingRepair: number | null;
  avgTimeToFixMs: number | null;
}

// Shared by the AI Engineering page's stats row and the Settings shortcut
// card so both read the same numbers off the same task list — no separate
// backend endpoint, everything here is derivable from GET /ai-engineering/tasks.
export function computeAiEngineeringStats(tasks: AiEngineeringTask[]): AiEngineeringStats {
  const completed = tasks.filter((t) => t.status === 'COMPLETED');
  const rejected = tasks.filter((t) => t.status === 'REJECTED').length;
  const failed = tasks.filter((t) => t.status === 'FAILED').length;
  const needsHuman = tasks.filter((t) => t.area === 'NEEDS_HUMAN').length;
  const inFlight = tasks.filter((t) => IN_FLIGHT_STATUSES.has(t.status)).length;
  const awaitingReview = tasks.filter((t) => t.status === 'WAITING_REVIEW').length;

  const resolved = completed.length + rejected + failed;
  const successRatePct = resolved > 0 ? (completed.length / resolved) * 100 : null;

  const verified = tasks.filter((t) => t.status === 'COMPLETED' || t.status === 'WAITING_REVIEW');
  const pctNeedingRepair =
    verified.length > 0 ? (verified.filter((t) => t.repairAttempts > 0).length / verified.length) * 100 : null;

  const fixTimes = completed
    .filter((t) => t.completedAt)
    .map((t) => new Date(t.completedAt as string).getTime() - new Date(t.createdAt).getTime())
    .filter((ms) => Number.isFinite(ms) && ms >= 0);
  const avgTimeToFixMs = fixTimes.length > 0 ? fixTimes.reduce((a, b) => a + b, 0) / fixTimes.length : null;

  return {
    total: tasks.length,
    completed: completed.length,
    rejected,
    failed,
    needsHuman,
    inFlight,
    awaitingReview,
    successRatePct,
    pctNeedingRepair,
    avgTimeToFixMs,
  };
}

// The raw output stored on a task is the real, unfiltered stdout+stderr of
// `jest --silent` or `tsc --noEmit` — it can include unrelated test fixtures
// that deliberately log ERROR/stack traces as part of testing error-handling
// paths (e.g. a scanner test that intentionally crashes a scan to verify
// logging), which reads as a real failure to anyone skimming it. Jest's own
// final "Test Suites: ...compact" / "Tests: ...compact" summary lines are
// the actual signal — pulling them out lets the UI show a real PASS/FAIL
// headline instead of forcing a human to parse a wall of log noise.
export function extractTestSummary(output: string): string | null {
  const suitesLine = /Test Suites:.*$/m.exec(output)?.[0];
  const testsLine = /Tests:.*$/m.exec(output)?.[0];
  if (!testsLine) return null;
  return [suitesLine, testsLine].filter(Boolean).join('\n');
}

export function formatDurationMs(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return remMinutes > 0 ? `${hours}h ${remMinutes}m` : `${hours}h`;
}
