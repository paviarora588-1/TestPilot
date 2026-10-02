import { WebRecorderFlowBuilderService } from './flow-builder';
import { encryptCredential } from '../../common/crypto.util';

function makePrismaMock(steps: unknown[]) {
  const testDataItems: { id: string; testDataSetId: string; key: string; value: string; isSensitive: boolean }[] = [];
  let nextId = 1;
  return {
    webRecordingSession: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'rec-1',
        applicationId: 'app-1',
        status: 'STOPPED',
        automationFlowId: null,
        targetUrl: 'https://app.example.com/login',
        framework: 'PLAYWRIGHT',
        steps,
      }),
    },
    testDataSet: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'dataset-1' }),
    },
    testDataItem: {
      findFirst: jest.fn().mockImplementation(({ where }) =>
        Promise.resolve(testDataItems.find((i) => i.testDataSetId === where.testDataSetId && i.key === where.key) ?? null),
      ),
      create: jest.fn().mockImplementation(({ data }) => {
        const item = { id: `item-${nextId++}`, ...data };
        testDataItems.push(item);
        return Promise.resolve(item);
      }),
    },
  };
}

function makeSessionsMock() {
  return { markStatus: jest.fn().mockResolvedValue(undefined) };
}

function makeObjectLibraryMock() {
  return {
    findOrCreateObjectForLocator: jest.fn().mockResolvedValue({ id: 'obj-1' }),
  };
}

function makeAutomationBuilderMock() {
  return {
    get: jest.fn().mockResolvedValue({ id: 'flow-1', name: 'Recorded flow' }),
    create: jest.fn().mockResolvedValue({ id: 'flow-1', name: 'Recorded flow' }),
    updateGraph: jest.fn().mockResolvedValue(undefined),
  };
}

const baseStep = {
  id: 'step-1',
  stepOrder: 1,
  pageTitle: 'Login',
  recommendedLocator: '#password',
  recommendedLocatorType: 'ID',
  backupLocators: null,
  objectTypeHint: 'password-input',
};

describe('WebRecorderFlowBuilderService — sensitive step conversion', () => {
  // Regression: a recorded password step that the user never explicitly
  // marked as a variable used to be left with no value at all (neither
  // inlineValue nor a TestDataItem) — the resulting script typed an empty
  // string into the password field and submitted anyway. Confirmed against
  // a real recorded SAP Fiori login before this fix.
  it('binds a sensitive step to a real TestDataItem even when isVariable is false', async () => {
    const step = {
      ...baseStep,
      actionType: 'ENTER_TEXT',
      label: 'Password',
      isVariable: false,
      variableName: null,
      isSensitive: true,
      rawValue: null,
      encryptedValue: encryptCredential('hunter2'),
    };
    const prisma = makePrismaMock([step]);
    const automationBuilder = makeAutomationBuilderMock();
    const service = new WebRecorderFlowBuilderService(
      prisma as never,
      makeSessionsMock() as never,
      makeObjectLibraryMock() as never,
      automationBuilder as never,
    );

    await service.convert('rec-1', {});

    expect(prisma.testDataItem.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ value: 'hunter2', isSensitive: true }) }),
    );
    // The node written for this step must carry a real testDataItemId and
    // NOT a blank inlineValue — this is the actual bug: previously
    // testDataItemId stayed null and inlineValue stayed null too, which
    // compiled to an ENTER_TEXT step typing an empty string.
    const graphJson = automationBuilder.updateGraph.mock.calls[0][1];
    expect(graphJson.nodes[0].data.testDataItemId).toBe('item-1');
    expect(graphJson.nodes[0].data.inlineValue).toBeNull();
  });

  it('auto-derives a variable name from the label when the user never provided one', async () => {
    const step = {
      ...baseStep,
      actionType: 'ENTER_TEXT',
      label: 'Password',
      isVariable: false,
      variableName: null,
      isSensitive: true,
      rawValue: null,
      encryptedValue: encryptCredential('hunter2'),
    };
    const prisma = makePrismaMock([step]);
    const service = new WebRecorderFlowBuilderService(
      prisma as never,
      makeSessionsMock() as never,
      makeObjectLibraryMock() as never,
      makeAutomationBuilderMock() as never,
    );

    await service.convert('rec-1', {});

    expect(prisma.testDataItem.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ key: 'password' }) }),
    );
  });

  it('still leaves an ordinary (non-sensitive, non-variable) step as a plain inline value', async () => {
    const step = {
      ...baseStep,
      actionType: 'ENTER_TEXT',
      label: 'Search box',
      recommendedLocator: '#search',
      isVariable: false,
      variableName: null,
      isSensitive: false,
      rawValue: 'widgets',
      encryptedValue: null,
    };
    const prisma = makePrismaMock([step]);
    const automationBuilder = makeAutomationBuilderMock();
    const service = new WebRecorderFlowBuilderService(
      prisma as never,
      makeSessionsMock() as never,
      makeObjectLibraryMock() as never,
      automationBuilder as never,
    );

    await service.convert('rec-1', {});

    expect(prisma.testDataItem.create).not.toHaveBeenCalled();
    const graphJson = automationBuilder.updateGraph.mock.calls[0][1];
    expect(graphJson.nodes[0].data.inlineValue).toBe('widgets');
    expect(graphJson.nodes[0].data.testDataItemId).toBeNull();
  });
});
