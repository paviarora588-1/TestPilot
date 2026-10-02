import { ConflictException } from '@nestjs/common';
import { ApplicationsService } from './applications.service';

// Regression for a bug found testing application registration: creating a
// second application with the same name (even different casing/whitespace)
// silently succeeded, producing two indistinguishable rows in the app
// switcher. Uses a minimal hand-rolled Prisma mock rather than a real DB —
// this service's create/update logic is simple enough not to need one, and
// there's no existing Prisma-test-double convention in this repo yet.
function makePrismaMock(existing: { id: string; name: string }[]) {
  return {
    application: {
      findMany: jest.fn().mockResolvedValue(existing),
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'new-id', ...data })),
      update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'existing-id', ...data })),
      findUnique: jest.fn().mockResolvedValue(existing[0] ?? null),
    },
  };
}

describe('ApplicationsService', () => {
  it('rejects creating an application whose name already exists', async () => {
    const prisma = makePrismaMock([{ id: 'app-1', name: 'RP - Reset Password' }]);
    const service = new ApplicationsService(prisma as never, {} as never);

    await expect(service.create({ name: 'RP - Reset Password' } as never)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.application.create).not.toHaveBeenCalled();
  });

  it('rejects a duplicate name that only differs by case/whitespace', async () => {
    const prisma = makePrismaMock([{ id: 'app-1', name: 'RP - Reset Password' }]);
    const service = new ApplicationsService(prisma as never, {} as never);

    await expect(service.create({ name: '  rp - reset password  ' } as never)).rejects.toBeInstanceOf(ConflictException);
  });

  it('allows creating an application with a genuinely different name', async () => {
    const prisma = makePrismaMock([{ id: 'app-1', name: 'RP - Reset Password' }]);
    const service = new ApplicationsService(prisma as never, {} as never);

    await expect(service.create({ name: 'SP - Secure Pro' } as never)).resolves.toMatchObject({ name: 'SP - Secure Pro' });
    expect(prisma.application.create).toHaveBeenCalled();
  });

  it('allows updating an application to keep its own existing name', async () => {
    const prisma = makePrismaMock([{ id: 'app-1', name: 'RP - Reset Password' }]);
    prisma.application.findUnique.mockResolvedValue({ id: 'app-1', name: 'RP - Reset Password' });
    const service = new ApplicationsService(prisma as never, {} as never);

    await expect(service.update('app-1', { name: 'RP - Reset Password' } as never)).resolves.toBeDefined();
    expect(prisma.application.update).toHaveBeenCalled();
  });
});

// listWithQualityScores() fans out one ReportingService call per application
// — a fleet-wide endpoint over N concurrent DB queries is exactly the load
// shape that has repeatedly wedged this project's local Postgres adapter, so
// this must stay a plain sequential loop, never Promise.all.
describe('ApplicationsService.listWithQualityScores', () => {
  it('resolves one row per application, sequentially, using ReportingService', async () => {
    const prisma = {
      application: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'app-1', name: 'Alpha' },
          { id: 'app-2', name: 'Beta' },
        ]),
      },
      scanSession: {
        findFirst: jest.fn().mockResolvedValue({ createdAt: new Date('2026-01-01T00:00:00.000Z') }),
      },
    };
    const callOrder: string[] = [];
    const reportingService = {
      getSummary: jest.fn().mockImplementation(async (id: string) => {
        callOrder.push(`summary:${id}`);
        return { automationCoverage: 50, passRate: 60, totalObjects: 4, objectHealth: { working: 2 }, totalTestCases: 5 };
      }),
      getQualityScore: jest.fn().mockImplementation(async (id: string) => {
        callOrder.push(`score:${id}`);
        return { score: 55, components: [], executionTrend: [] };
      }),
    };
    const service = new ApplicationsService(prisma as never, reportingService as never);

    const rows = await service.listWithQualityScores();

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ id: 'app-1', name: 'Alpha', automationCoverage: 50, objectHealthPct: 50, passRate: 60 });
    expect(rows[1]).toMatchObject({ id: 'app-2', name: 'Beta' });
    // Sequential, not fanned out: app-1's calls complete before app-2's start.
    expect(callOrder).toEqual(['summary:app-1', 'score:app-1', 'summary:app-2', 'score:app-2']);
  });
});
