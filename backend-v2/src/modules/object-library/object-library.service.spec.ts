import { ConflictException, NotFoundException } from '@nestjs/common';
import { ObjectLibraryService } from './object-library.service';

// Regression for a bug found testing the Object Library: promoting the same
// scan object twice used to hit ObjectRepository.sourceScanObjectId's DB
// unique constraint raw, surfacing as an unhandled 500 instead of a clear
// "already promoted" message.
function makePrismaMock(scanObject: { id: string; promoted: boolean } | null) {
  return {
    scanObject: {
      findUnique: jest.fn().mockResolvedValue(
        scanObject && {
          ...scanObject,
          objectType: 'text-input',
          recommendedLocator: '#foo',
          recommendedLocatorType: 'ID',
          backupLocators: null,
          confidenceScore: 0.9,
          lastWorkingStatus: 'UNKNOWN',
          buttonText: null,
          ariaLabel: null,
          nearbyLabelText: null,
          placeholder: null,
          scanPage: { screenshotPath: null, scanSession: { applicationId: 'app-1' } },
        },
      ),
      update: jest.fn().mockResolvedValue(undefined),
    },
    objectRepository: {
      create: jest.fn().mockResolvedValue({ id: 'obj-1' }),
    },
  };
}

describe('ObjectLibraryService.promoteFromScanObject', () => {
  it('rejects promoting a scan object that has already been promoted', async () => {
    const prisma = makePrismaMock({ id: 'scan-obj-1', promoted: true });
    const service = new ObjectLibraryService(prisma as never);

    await expect(
      service.promoteFromScanObject('scan-obj-1', { objectName: 'Foo' } as never),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.objectRepository.create).not.toHaveBeenCalled();
  });

  it('allows promoting a scan object that has not been promoted yet', async () => {
    const prisma = makePrismaMock({ id: 'scan-obj-2', promoted: false });
    const service = new ObjectLibraryService(prisma as never);

    await expect(
      service.promoteFromScanObject('scan-obj-2', { objectName: 'Foo' } as never),
    ).resolves.toMatchObject({ id: 'obj-1' });
    expect(prisma.objectRepository.create).toHaveBeenCalled();
  });

  it('reports 404 for a scan object that does not exist, not a raw crash', async () => {
    const prisma = makePrismaMock(null);
    const service = new ObjectLibraryService(prisma as never);

    await expect(
      service.promoteFromScanObject('missing', { objectName: 'Foo' } as never),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

// Used by the Web Action Recorder when converting a recording into an
// AutomationFlow — exact applicationId+technicalPath match only, no fuzzy
// matching (see the method's own comment for why that's the deliberate
// scope).
describe('ObjectLibraryService.findOrCreateObjectForLocator', () => {
  function makeDedupePrismaMock(existing: { id: string } | null) {
    return {
      objectRepository: {
        findFirst: jest.fn().mockResolvedValue(existing),
        create: jest.fn().mockResolvedValue({ id: 'new-obj-1' }),
      },
    };
  }

  const input = {
    objectName: 'Username',
    objectType: 'text-input',
    technicalPath: '#username',
    locatorStrategy: 'ID' as never,
  };

  it('reuses an existing object with the same applicationId + technicalPath instead of creating a duplicate', async () => {
    const prisma = makeDedupePrismaMock({ id: 'existing-obj-1' });
    const service = new ObjectLibraryService(prisma as never);

    const result = await service.findOrCreateObjectForLocator('app-1', input);

    expect(result).toEqual({ id: 'existing-obj-1' });
    expect(prisma.objectRepository.findFirst).toHaveBeenCalledWith({
      where: { applicationId: 'app-1', technicalPath: '#username' },
    });
    expect(prisma.objectRepository.create).not.toHaveBeenCalled();
  });

  it('creates a new object when no existing row matches', async () => {
    const prisma = makeDedupePrismaMock(null);
    const service = new ObjectLibraryService(prisma as never);

    const result = await service.findOrCreateObjectForLocator('app-1', input);

    expect(result).toEqual({ id: 'new-obj-1' });
    expect(prisma.objectRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ applicationId: 'app-1', technicalPath: '#username' }),
      }),
    );
  });
});
