import { ReportingService } from './reporting.service';

// getQualityScore() is built entirely from getSummary()/getFailureTrends() —
// these tests exercise the actual new logic: weight renormalization when a
// category has zero underlying data, and the score:null case for a brand
// new application with nothing in it yet.
function makePrismaMock(data: {
  testCases?: Array<{ automationStatus: string }>;
  objects?: Array<{ verificationStatus: string }>;
  executions?: Array<{ status: string; createdAt: Date }>;
}) {
  return {
    testCase: { findMany: jest.fn().mockResolvedValue(data.testCases ?? []) },
    objectRepository: { findMany: jest.fn().mockResolvedValue(data.objects ?? []) },
    generatedScript: { count: jest.fn().mockResolvedValue(0) },
    executionRun: { findMany: jest.fn().mockResolvedValue(data.executions ?? []) },
    testDataSet: { count: jest.fn().mockResolvedValue(0) },
    automationFlow: { count: jest.fn().mockResolvedValue(0) },
  };
}

describe('ReportingService.getQualityScore', () => {
  it('blends all three categories when every one has data', async () => {
    const prisma = makePrismaMock({
      testCases: [
        ...Array(8).fill({ automationStatus: 'AUTOMATED' }),
        ...Array(2).fill({ automationStatus: 'NOT_STARTED' }),
      ],
      objects: [...Array(7).fill({ verificationStatus: 'WORKING' }), ...Array(3).fill({ verificationStatus: 'BROKEN' })],
      executions: [
        ...Array(6).fill({ status: 'COMPLETED', createdAt: new Date('2026-01-01') }),
        ...Array(4).fill({ status: 'FAILED', createdAt: new Date('2026-01-01') }),
      ],
    });
    const service = new ReportingService(prisma as never);

    const result = await service.getQualityScore('app-1');

    expect(result.score).toBe(71);
    expect(result.components).toEqual([
      { label: 'Automation coverage', value: 80, weight: 0.4 },
      { label: 'Execution pass rate', value: 60, weight: 0.35 },
      { label: 'Object health', value: 70, weight: 0.25 },
    ]);
  });

  it('excludes an empty category and redistributes its weight across the rest', async () => {
    const prisma = makePrismaMock({
      testCases: [],
      objects: [...Array(2).fill({ verificationStatus: 'WORKING' }), ...Array(2).fill({ verificationStatus: 'BROKEN' })],
      executions: [
        ...Array(3).fill({ status: 'COMPLETED', createdAt: new Date('2026-01-01') }),
        ...Array(2).fill({ status: 'FAILED', createdAt: new Date('2026-01-01') }),
      ],
    });
    const service = new ReportingService(prisma as never);

    const result = await service.getQualityScore('app-1');

    expect(result.components.map((c) => c.label)).toEqual(['Execution pass rate', 'Object health']);
    expect(result.score).toBe(56);
  });

  it('returns score: null when the application has no data in any category', async () => {
    const prisma = makePrismaMock({});
    const service = new ReportingService(prisma as never);

    const result = await service.getQualityScore('app-1');

    expect(result.score).toBeNull();
    expect(result.components).toEqual([]);
  });
});
