import { ScriptGeneratorService, segmentSteps } from './script-generator.service';
import { SapScriptLanguage } from './dto/generate-script.dto';

// Regression baseline for the web compile path, written before the VBScript
// compiler lands — the driver-inference logic in segmentSteps() and the
// dispatch in generateForFlow() are exactly what a SAP-focused change is
// most likely to accidentally perturb for pure-web flows.

jest.mock('./playwright-compiler', () => ({
  compileFlowToPlaywright: jest.fn().mockReturnValue({ files: [{ fileName: 'flow.spec.ts', code: '// pw', role: 'SPEC' }], command: 'npx playwright test flow.spec.ts' }),
}));
jest.mock('./selenium-java-compiler', () => ({
  compileFlowToSeleniumJava: jest.fn().mockReturnValue({ files: [{ fileName: 'Flow.java', code: '// selenium', role: 'SPEC' }], command: 'mvn test' }),
}));
jest.mock('./sap-gui-compiler', () => ({
  compileFlowToSapGui: jest.fn().mockReturnValue({ files: [{ fileName: 'flow.ps1', code: '# sap', role: 'SPEC' }], command: 'powershell flow.ps1' }),
}));
jest.mock('./sap-gui-vbscript-compiler', () => ({
  compileFlowToSapGuiVbs: jest.fn().mockReturnValue({ files: [{ fileName: 'flow.vbs', code: "' sap vbs", role: 'SPEC' }], command: 'cscript //NoLogo flow.vbs' }),
}));

describe('segmentSteps — driver inference (pure)', () => {
  function webStep(stepOrder: number, stepType = 'CLICK') {
    return { stepOrder, stepType, object: { locatorStrategy: 'CSS' } };
  }
  function sapStep(stepOrder: number, stepType = 'CLICK') {
    return { stepOrder, stepType, object: { locatorStrategy: 'SAP_GUI_ID' } };
  }
  function unboundStep(stepOrder: number, stepType = 'WAIT') {
    return { stepOrder, stepType, object: null };
  }

  it('groups an all-web flow into a single WEB segment', () => {
    const segments = segmentSteps([webStep(1), webStep(2), webStep(3)]);
    expect(segments).toHaveLength(1);
    expect(segments[0].driver).toBe('WEB');
    expect(segments[0].steps).toHaveLength(3);
  });

  it('groups an all-SAP flow into a single SAP_GUI segment', () => {
    const segments = segmentSteps([sapStep(1), sapStep(2)]);
    expect(segments).toHaveLength(1);
    expect(segments[0].driver).toBe('SAP_GUI');
  });

  it('splits a mixed flow into contiguous alternating segments', () => {
    const segments = segmentSteps([webStep(1), webStep(2), sapStep(3), sapStep(4), webStep(5)]);
    expect(segments.map((s) => s.driver)).toEqual(['WEB', 'SAP_GUI', 'WEB']);
    expect(segments[0].steps).toHaveLength(2);
    expect(segments[1].steps).toHaveLength(2);
    expect(segments[2].steps).toHaveLength(1);
  });

  it('an unbound step joins the currently-open segment rather than starting a new one', () => {
    const segments = segmentSteps([webStep(1), unboundStep(2), webStep(3)]);
    expect(segments).toHaveLength(1);
    expect(segments[0].steps.map((s) => s.stepOrder)).toEqual([1, 2, 3]);
  });

  it('a leading unbound non-SAP step defaults to WEB', () => {
    const segments = segmentSteps([unboundStep(1), webStep(2)]);
    expect(segments[0].driver).toBe('WEB');
  });

  // Regression: SAP_START_TRANSACTION (and every other SAP_*-prefixed step
  // type) never has a bound object by design, so the generic "unbound ->
  // default WEB" rule above previously misclassified a flow starting with
  // one as a WEB segment — a real generated script ended up with a whole
  // Playwright segment that just opened about:blank and did nothing, ahead
  // of the actual SAP GUI automation.
  it('a leading unbound SAP_*-prefixed step defaults to SAP_GUI, not WEB', () => {
    const segments = segmentSteps([unboundStep(1, 'SAP_START_TRANSACTION'), sapStep(2)]);
    expect(segments).toHaveLength(1);
    expect(segments[0].driver).toBe('SAP_GUI');
  });

  it('an unbound SAP_*-prefixed step starts a new SAP_GUI segment rather than joining an open WEB one', () => {
    const segments = segmentSteps([webStep(1), unboundStep(2, 'SAP_SEND_VKEY'), sapStep(3)]);
    expect(segments.map((s) => s.driver)).toEqual(['WEB', 'SAP_GUI']);
    expect(segments[1].steps.map((s) => s.stepOrder)).toEqual([2, 3]);
  });
});

describe('ScriptGeneratorService.generateForFlow — dispatch by segment', () => {
  const { compileFlowToPlaywright } = jest.requireMock('./playwright-compiler');
  const { compileFlowToSeleniumJava } = jest.requireMock('./selenium-java-compiler');
  const { compileFlowToSapGui } = jest.requireMock('./sap-gui-compiler');
  const { compileFlowToSapGuiVbs } = jest.requireMock('./sap-gui-vbscript-compiler');

  beforeEach(() => {
    jest.clearAllMocks();
  });

  function makeService(flowSteps: { stepOrder: number; stepType: string; object: { locatorStrategy: string } | null }[], framework = 'PLAYWRIGHT') {
    const generatedScript = { id: 'script-1', applicationId: 'app-1', files: [] as unknown[] };
    const prisma = {
      automationFlow: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'flow-1',
          name: 'Test Flow',
          applicationId: 'app-1',
          testCaseId: 'tc-1',
          framework,
          steps: flowSteps,
          application: { entryUrl: 'https://example.com' },
        }),
        update: jest.fn().mockResolvedValue(undefined),
      },
      generatedScript: {
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...generatedScript, ...data })),
        findUnique: jest.fn().mockResolvedValue({ ...generatedScript, framework, files: [] }),
        update: jest.fn().mockResolvedValue(undefined),
      },
      generatedScriptFile: { create: jest.fn().mockResolvedValue(undefined) },
      testCase: {
        findUnique: jest.fn().mockResolvedValue({ automationStatus: 'MAPPED' }),
        update: jest.fn().mockResolvedValue(undefined),
      },
    };
    const goldenRule = { checkFlowGenerationBlockers: jest.fn().mockResolvedValue({ blocked: false }) };
    const ragService = { retrieveContext: jest.fn().mockResolvedValue({ chunks: [], used: false }) };

    const service = new ScriptGeneratorService(prisma as never, goldenRule as never, ragService as never);
    return { service, prisma };
  }

  it('a pure-web flow calls only the web compiler, never either SAP compiler', async () => {
    const { service, prisma } = makeService([
      { stepOrder: 1, stepType: 'CLICK', object: { locatorStrategy: 'CSS' } },
      { stepOrder: 2, stepType: 'CLICK', object: { locatorStrategy: 'XPATH' } },
    ]);

    await service.generateForFlow('flow-1');

    expect(compileFlowToPlaywright).toHaveBeenCalledTimes(1);
    expect(compileFlowToSeleniumJava).not.toHaveBeenCalled();
    expect(compileFlowToSapGui).not.toHaveBeenCalled();
    expect(compileFlowToSapGuiVbs).not.toHaveBeenCalled();
    expect(prisma.generatedScript.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ framework: 'PLAYWRIGHT' }) }),
    );
  });

  it('a pure-web flow with framework SELENIUM calls the Selenium compiler, not Playwright or either SAP compiler', async () => {
    const { service } = makeService([{ stepOrder: 1, stepType: 'CLICK', object: { locatorStrategy: 'CSS' } }], 'SELENIUM');

    await service.generateForFlow('flow-1');

    expect(compileFlowToSeleniumJava).toHaveBeenCalledTimes(1);
    expect(compileFlowToPlaywright).not.toHaveBeenCalled();
    expect(compileFlowToSapGui).not.toHaveBeenCalled();
    expect(compileFlowToSapGuiVbs).not.toHaveBeenCalled();
  });

  it('a pure-SAP flow defaults to the VBScript compiler, never a web compiler or the PowerShell compiler', async () => {
    const { service, prisma } = makeService([{ stepOrder: 1, stepType: 'CLICK', object: { locatorStrategy: 'SAP_GUI_ID' } }]);

    await service.generateForFlow('flow-1');

    expect(compileFlowToSapGuiVbs).toHaveBeenCalledTimes(1);
    expect(compileFlowToSapGui).not.toHaveBeenCalled();
    expect(compileFlowToPlaywright).not.toHaveBeenCalled();
    expect(compileFlowToSeleniumJava).not.toHaveBeenCalled();
    expect(prisma.generatedScript.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ framework: 'SAP_VBSCRIPT' }) }),
    );
  });

  it('a pure-SAP flow explicitly requesting POWERSHELL calls the existing PowerShell compiler instead', async () => {
    const { service } = makeService([{ stepOrder: 1, stepType: 'CLICK', object: { locatorStrategy: 'SAP_GUI_ID' } }]);

    await service.generateForFlow('flow-1', SapScriptLanguage.POWERSHELL);

    expect(compileFlowToSapGui).toHaveBeenCalledTimes(1);
    expect(compileFlowToSapGuiVbs).not.toHaveBeenCalled();
  });

  it('a mixed flow compiles HYBRID and calls the web compiler plus the default (VBScript) SAP compiler, once per segment', async () => {
    const { service, prisma } = makeService([
      { stepOrder: 1, stepType: 'CLICK', object: { locatorStrategy: 'CSS' } },
      { stepOrder: 2, stepType: 'CLICK', object: { locatorStrategy: 'SAP_GUI_ID' } },
    ]);

    await service.generateForFlow('flow-1');

    expect(compileFlowToPlaywright).toHaveBeenCalledTimes(1);
    expect(compileFlowToSapGuiVbs).toHaveBeenCalledTimes(1);
    expect(compileFlowToSapGui).not.toHaveBeenCalled();
    expect(prisma.generatedScript.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ framework: 'HYBRID' }) }),
    );
  });
});
