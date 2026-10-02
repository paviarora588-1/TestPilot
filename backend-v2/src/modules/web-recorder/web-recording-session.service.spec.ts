import { ConflictException, NotFoundException } from '@nestjs/common';
import { WebRecordingSessionService } from './web-recording-session.service';
import { encryptCredential } from '../../common/crypto.util';
import type { NormalizedStepInput } from './event-normalizer';

function makePrismaMock() {
  return {
    application: { findUnique: jest.fn().mockResolvedValue({ id: 'app-1' }) },
    webRecordingSession: {
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'rec-1', ...data })),
      findUnique: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue({ success: true }),
      findMany: jest.fn(),
    },
    webRecordingStep: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'step-1', ...data })),
      update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'step-1', isSensitive: false, ...data })),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    $transaction: jest.fn().mockImplementation((ops: unknown[]) => Promise.all(ops)),
  };
}

const baseInput: NormalizedStepInput = {
  actionType: 'CLICK',
  label: 'Submit',
  pageUrl: 'https://app.test/',
  pageTitle: 'Home',
  frameUrl: null,
  tabIndex: 0,
  recommendedLocator: '#submit',
  recommendedLocatorType: 'ID' as never,
  backupLocators: [],
  objectTypeHint: 'button',
  rawValue: null,
  config: null,
};

describe('WebRecordingSessionService — state transitions', () => {
  it('markStatus succeeds when the row is in one of the allowed "from" statuses', async () => {
    const prisma = makePrismaMock();
    prisma.webRecordingSession.updateMany.mockResolvedValue({ count: 1 });
    const service = new WebRecordingSessionService(prisma as never);

    await expect(service.markStatus('rec-1', ['RECORDING'], 'PAUSED')).resolves.toBeUndefined();
    expect(prisma.webRecordingSession.updateMany).toHaveBeenCalledWith({
      where: { id: 'rec-1', status: { in: ['RECORDING'] } },
      data: { status: 'PAUSED' },
    });
  });

  it('markStatus rejects a transition when the row is not in an allowed "from" status (e.g. pausing an already-STOPPED session)', async () => {
    const prisma = makePrismaMock();
    prisma.webRecordingSession.updateMany.mockResolvedValue({ count: 0 });
    prisma.webRecordingSession.findUnique.mockResolvedValue({ status: 'STOPPED' });
    const service = new WebRecordingSessionService(prisma as never);

    await expect(service.markStatus('rec-1', ['RECORDING'], 'PAUSED')).rejects.toBeInstanceOf(ConflictException);
  });

  it('markStatus reports 404 for a session that does not exist, not a raw conflict', async () => {
    const prisma = makePrismaMock();
    prisma.webRecordingSession.updateMany.mockResolvedValue({ count: 0 });
    prisma.webRecordingSession.findUnique.mockResolvedValue(null);
    const service = new WebRecordingSessionService(prisma as never);

    await expect(service.markStatus('missing', ['RECORDING'], 'PAUSED')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('WebRecordingSessionService — appendStep sensitivity detection', () => {
  it('flags a step whose label looks like a password field as sensitive and encrypts its value', async () => {
    const prisma = makePrismaMock();
    prisma.webRecordingStep.findFirst.mockResolvedValue(null);
    const service = new WebRecordingSessionService(prisma as never);

    await service.appendStep('rec-1', { ...baseInput, actionType: 'ENTER_TEXT', label: 'Password', rawValue: 'hunter2' });

    const createArgs = prisma.webRecordingStep.create.mock.calls[0][0];
    expect(createArgs.data.isSensitive).toBe(true);
    expect(createArgs.data.rawValue).toBeUndefined();
    expect(typeof createArgs.data.encryptedValue).toBe('string');
  });

  it('leaves an ordinary field unencrypted', async () => {
    const prisma = makePrismaMock();
    prisma.webRecordingStep.findFirst.mockResolvedValue(null);
    const service = new WebRecordingSessionService(prisma as never);

    await service.appendStep('rec-1', { ...baseInput, actionType: 'ENTER_TEXT', label: 'Username', rawValue: 'pranav' });

    const createArgs = prisma.webRecordingStep.create.mock.calls[0][0];
    expect(createArgs.data.isSensitive).toBe(false);
    expect(createArgs.data.rawValue).toBe('pranav');
    expect(createArgs.data.encryptedValue).toBeUndefined();
  });

  it('numbers a new step one past the current highest stepOrder', async () => {
    const prisma = makePrismaMock();
    prisma.webRecordingStep.findFirst.mockResolvedValue({ stepOrder: 4 });
    const service = new WebRecordingSessionService(prisma as never);

    await service.appendStep('rec-1', baseInput);

    expect(prisma.webRecordingStep.create.mock.calls[0][0].data.stepOrder).toBe(5);
  });

  // Regression: a CLICK on a "New Password" tab was flagged sensitive purely
  // because its label contains "Password", with no captured value at all to
  // actually protect — confirmed live against a real app.
  it('does not flag a valueless click as sensitive just because its label mentions "password"', async () => {
    const prisma = makePrismaMock();
    prisma.webRecordingStep.findFirst.mockResolvedValue(null);
    const service = new WebRecordingSessionService(prisma as never);

    await service.appendStep('rec-1', { ...baseInput, actionType: 'CLICK', label: 'New Password', rawValue: null });

    const createArgs = prisma.webRecordingStep.create.mock.calls[0][0];
    expect(createArgs.data.isSensitive).toBe(false);
  });

  // Regression: a NAVIGATE step was flagged sensitive purely because the
  // destination page's own title happened to contain "Password" ("Reset
  // Password - RP") — its rawValue was just the destination URL, nothing a
  // user ever typed. Only ENTER_TEXT/SELECT_OPTION represent genuine
  // user-entered data that could actually be a credential.
  it('does not flag a NAVIGATE as sensitive just because the destination page title mentions "password"', async () => {
    const prisma = makePrismaMock();
    prisma.webRecordingStep.findFirst.mockResolvedValue(null);
    const service = new WebRecordingSessionService(prisma as never);

    await service.appendStep('rec-1', {
      ...baseInput,
      actionType: 'NAVIGATE',
      label: 'Reset Password - RP',
      pageTitle: 'Reset Password - RP',
      rawValue: 'https://app.test/reset-password',
    });

    const createArgs = prisma.webRecordingStep.create.mock.calls[0][0];
    expect(createArgs.data.isSensitive).toBe(false);
    expect(createArgs.data.rawValue).toBe('https://app.test/reset-password');
  });
});

describe('WebRecordingSessionService — get() never leaks sensitive values', () => {
  it('nulls out rawValue and drops encryptedValue for a sensitive step', async () => {
    const prisma = makePrismaMock();
    prisma.webRecordingSession.findUnique.mockResolvedValue({
      id: 'rec-1',
      steps: [
        { id: 'step-1', isSensitive: true, rawValue: null, encryptedValue: encryptCredential('hunter2') },
        { id: 'step-2', isSensitive: false, rawValue: 'visible', encryptedValue: null },
      ],
    });
    const service = new WebRecordingSessionService(prisma as never);

    const result = await service.get('rec-1');

    expect(result.steps[0]).not.toHaveProperty('encryptedValue');
    expect(result.steps[0].rawValue).toBeNull();
    expect(result.steps[1].rawValue).toBe('visible');
  });
});

describe('WebRecordingSessionService — updateStep sensitivity toggling', () => {
  it('moves a plaintext value into encryptedValue when marked sensitive', async () => {
    const prisma = makePrismaMock();
    prisma.webRecordingStep.findFirst.mockResolvedValue({ id: 'step-1', isSensitive: false, rawValue: 'hunter2', encryptedValue: null });
    const service = new WebRecordingSessionService(prisma as never);

    await service.updateStep('rec-1', 'step-1', { isSensitive: true });

    const updateArgs = prisma.webRecordingStep.update.mock.calls[0][0];
    expect(updateArgs.data.rawValue).toBeNull();
    expect(typeof updateArgs.data.encryptedValue).toBe('string');
  });

  it('is a no-op on the value fields when isSensitive is not actually changing', async () => {
    const prisma = makePrismaMock();
    prisma.webRecordingStep.findFirst.mockResolvedValue({ id: 'step-1', isSensitive: true, rawValue: null, encryptedValue: encryptCredential('x') });
    const service = new WebRecordingSessionService(prisma as never);

    await service.updateStep('rec-1', 'step-1', { isSensitive: true, label: 'Renamed' });

    const updateArgs = prisma.webRecordingStep.update.mock.calls[0][0];
    expect(updateArgs.data.label).toBe('Renamed');
    expect(updateArgs.data.rawValue).toBeUndefined();
    expect(updateArgs.data.encryptedValue).toBeUndefined();
  });
});

describe('WebRecordingSessionService — reorderSteps validation', () => {
  it('rejects an orderedStepIds list that does not exactly match the session’s current steps', async () => {
    const prisma = makePrismaMock();
    prisma.webRecordingStep.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
    const service = new WebRecordingSessionService(prisma as never);

    await expect(service.reorderSteps('rec-1', ['a'])).rejects.toBeInstanceOf(ConflictException);
  });

  it('renumbers stepOrder to match the given order', async () => {
    const prisma = makePrismaMock();
    prisma.webRecordingStep.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
    const service = new WebRecordingSessionService(prisma as never);

    await service.reorderSteps('rec-1', ['b', 'a']);

    expect(prisma.$transaction).toHaveBeenCalled();
  });
});

describe('WebRecordingSessionService — remove()', () => {
  it('refuses to delete a still-active session', async () => {
    const prisma = makePrismaMock();
    prisma.webRecordingSession.findUnique.mockResolvedValue({ status: 'RECORDING' });
    const service = new WebRecordingSessionService(prisma as never);

    await expect(service.remove('rec-1')).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.webRecordingSession.delete).not.toHaveBeenCalled();
  });

  it('allows deleting a terminal session', async () => {
    const prisma = makePrismaMock();
    prisma.webRecordingSession.findUnique.mockResolvedValue({ status: 'STOPPED' });
    const service = new WebRecordingSessionService(prisma as never);

    await expect(service.remove('rec-1')).resolves.toEqual({ success: true });
    expect(prisma.webRecordingSession.delete).toHaveBeenCalled();
  });
});
