import { compileFlowToSapGuiVbs, type CompilerStep } from './sap-gui-vbscript-compiler';

function step(overrides: Partial<CompilerStep> & { stepOrder: number; stepType: string }): CompilerStep {
  return {
    id: `step-${overrides.stepOrder}`,
    inlineValue: null,
    config: null,
    object: null,
    testDataItem: null,
    ...overrides,
  };
}

const submitButton = { objectName: 'Submit', objectType: 'GuiButton', technicalPath: 'wnd[0]/usr/btnSUBMIT' };
const homeTab = { objectName: 'Home', objectType: 'GuiTab', technicalPath: 'wnd[0]/usr/tabsTAB/tabHome' };
const usernameField = { objectName: 'Username', objectType: 'GuiTextField', technicalPath: 'wnd[0]/usr/txtUSERNAME' };
const activeCheckbox = { objectName: 'Active', objectType: 'GuiCheckBox', technicalPath: 'wnd[0]/usr/chkACTIVE' };
const orderGrid = { objectName: 'OrderGrid', objectType: 'GuiGridView', technicalPath: 'wnd[0]/usr/cntlGRID/shellcont/shell' };
const lineTable = { objectName: 'LineItems', objectType: 'GuiTableControl', technicalPath: 'wnd[0]/usr/tblLINES' };

describe('compileFlowToSapGuiVbs — file shape', () => {
  it('produces a .vbs file with a cscript command and a session-attach header with fail-fast error checks', () => {
    const result = compileFlowToSapGuiVbs({
      flowName: 'Submit Order',
      steps: [step({ stepOrder: 1, stepType: 'CLICK', object: submitButton })],
    });

    expect(result.files).toHaveLength(1);
    expect(result.files[0].fileName).toBe('SubmitOrder.vbs');
    expect(result.command).toBe('cscript //NoLogo SubmitOrder.vbs');

    const code = result.files[0].code;
    expect(code).toContain('Option Explicit');
    expect(code).toContain('GetObject("SAPGUI")');
    expect(code).toContain('SapGuiAuto.GetScriptingEngine');
    expect(code).toContain('Engine.Children(0)');
    expect(code).toContain('Connection.Children(0)');
    expect(code).toContain('Could not attach to a running SAP GUI session');
    expect(code).toContain('WScript.Quit 1');
  });

  it('writes step results in the shared "<order>|STATUS|message" pipe format', () => {
    const result = compileFlowToSapGuiVbs({
      flowName: 'Flow',
      steps: [step({ stepOrder: 3, stepType: 'CLICK', object: submitButton })],
    });
    const code = result.files[0].code;
    expect(code).toMatch(/LogStep 3, "PASS", ""/);
    expect(code).toContain('Sub LogStep(stepOrder, status, msg)');
  });

  it('an unsupported step type is skipped with a comment and no LogStep call for that order', () => {
    const result = compileFlowToSapGuiVbs({
      flowName: 'Flow',
      steps: [step({ stepOrder: 1, stepType: 'OPEN_URL' })],
    });
    const code = result.files[0].code;
    expect(code).toContain('Step 1: OPEN_URL has no SAP GUI equivalent — skipped');
    expect(code).not.toMatch(/LogStep 1,/);
  });

});

describe('compileFlowToSapGuiVbs — step type coverage', () => {
  function compileOne(s: CompilerStep): string {
    return compileFlowToSapGuiVbs({ flowName: 'F', steps: [s] }).files[0].code;
  }

  it('CLICK on a GuiButton calls Press', () => {
    const code = compileOne(step({ stepOrder: 1, stepType: 'CLICK', object: submitButton }));
    expect(code).toContain('Set obj = Session.findById("wnd[0]/usr/btnSUBMIT")');
    expect(code).toContain('obj.Press');
  });

  it('CLICK on a GuiTab calls Select instead of Press', () => {
    const code = compileOne(step({ stepOrder: 1, stepType: 'CLICK', object: homeTab }));
    expect(code).toContain('obj.Select');
    expect(code).not.toContain('obj.Press');
  });

  it('ENTER_TEXT sets obj.Text via ResolvePlaceholders', () => {
    const code = compileOne(step({ stepOrder: 1, stepType: 'ENTER_TEXT', object: usernameField, inlineValue: 'jdoe' }));
    expect(code).toContain('obj.Text = ResolvePlaceholders("jdoe")');
  });

  it('VERIFY_TEXT raises a descriptive error when the text does not match', () => {
    const code = compileOne(step({ stepOrder: 1, stepType: 'VERIFY_TEXT', object: usernameField, inlineValue: 'jdoe' }));
    expect(code).toContain('If InStr(obj.Text, expected) = 0 Then Err.Raise');
  });

  it('VERIFY_ELEMENT_VISIBLE raises when not visible', () => {
    const code = compileOne(step({ stepOrder: 1, stepType: 'VERIFY_ELEMENT_VISIBLE', object: usernameField }));
    expect(code).toContain('If Not obj.Visible Then Err.Raise');
  });

  it('WAIT sleeps for the configured duration', () => {
    const code = compileOne(step({ stepOrder: 1, stepType: 'WAIT', config: { durationMs: 2500 } }));
    expect(code).toContain('WScript.Sleep 2500');
  });

  it('SAP_SEND_VKEY focuses the bound object then sends the vkey to wnd[0]', () => {
    const code = compileOne(step({ stepOrder: 1, stepType: 'SAP_SEND_VKEY', object: usernameField, config: { vkey: 8 } }));
    expect(code).toContain('obj.SetFocus');
    expect(code).toContain('Session.findById("wnd[0]").sendVKey 8');
  });

  it('SAP_SEND_VKEY with no bound object sends directly to wnd[0]', () => {
    const code = compileOne(step({ stepOrder: 1, stepType: 'SAP_SEND_VKEY', config: { vkey: 0 } }));
    expect(code).not.toContain('SetFocus');
    expect(code).toContain('Session.findById("wnd[0]").sendVKey 0');
  });

  it('SAP_START_TRANSACTION calls Session.StartTransaction with a forced /n reset', () => {
    const code = compileOne(step({ stepOrder: 1, stepType: 'SAP_START_TRANSACTION', inlineValue: 'VA01' }));
    expect(code).toContain('Session.StartTransaction ResolvePlaceholders("/nVA01")');
  });

  it('SAP_START_TRANSACTION does not double a transaction code that already has an explicit prefix', () => {
    const code = compileOne(step({ stepOrder: 1, stepType: 'SAP_START_TRANSACTION', inlineValue: '/oVA01' }));
    expect(code).toContain('Session.StartTransaction ResolvePlaceholders("/oVA01")');
  });

  it('SAP_CHECK sets Selected to True, SAP_UNCHECK sets it to False', () => {
    expect(compileOne(step({ stepOrder: 1, stepType: 'SAP_CHECK', object: activeCheckbox }))).toContain('obj.Selected = True');
    expect(compileOne(step({ stepOrder: 1, stepType: 'SAP_UNCHECK', object: activeCheckbox }))).toContain('obj.Selected = False');
  });

  it('SAP_GRID_SET_CELL sets the current cell then modifies it', () => {
    const code = compileOne(
      step({ stepOrder: 1, stepType: 'SAP_GRID_SET_CELL', object: orderGrid, inlineValue: '100', config: { row: 2, column: 'MATNR' } }),
    );
    expect(code).toContain('obj.SetCurrentCell 2, "MATNR"');
    expect(code).toContain('obj.ModifyCell 2, "MATNR", ResolvePlaceholders("100")');
  });

  it('SAP_GRID_DOUBLE_CLICK_CELL sets the current cell then double-clicks it', () => {
    const code = compileOne(step({ stepOrder: 1, stepType: 'SAP_GRID_DOUBLE_CLICK_CELL', object: orderGrid, config: { row: 0, column: 'MATNR' } }));
    expect(code).toContain('obj.SetCurrentCell 0, "MATNR"');
    expect(code).toContain('obj.DoubleClickCurrentCell');
  });

  it('SAP_TABLE_SET_CELL sets a table control cell text directly', () => {
    const code = compileOne(
      step({ stepOrder: 1, stepType: 'SAP_TABLE_SET_CELL', object: lineTable, inlineValue: 'Widget', config: { row: 1, column: 'DESC' } }),
    );
    expect(code).toContain('obj.GetCell(1, "DESC").Text = ResolvePlaceholders("Widget")');
  });

  it('SAP_READ_STATUS_BAR logs the status bar text without its own assertion', () => {
    const code = compileOne(step({ stepOrder: 1, stepType: 'SAP_READ_STATUS_BAR' }));
    expect(code).toContain('Session.findById("wnd[0]/sbar")');
    expect(code).toContain('LogAction "Status bar: ["');
    // The generic per-step scaffold (busy-wait + unexpected-popup + status-bar
    // check, now injected after every step) can still raise on its own —
    // this step type just doesn't add a SECOND, step-specific assertion on
    // top of that, unlike SAP_ASSERT_STATUS_MESSAGE/SAP_VALIDATION below.
    expect(code).not.toContain('"AssertStatusMessage"');
    expect(code).not.toContain('"SapValidation"');
  });

  it('SAP_ASSERT_STATUS_MESSAGE raises when the status bar text does not match', () => {
    const code = compileOne(step({ stepOrder: 1, stepType: 'SAP_ASSERT_STATUS_MESSAGE', inlineValue: 'saved' }));
    expect(code).toContain('Session.findById("wnd[0]/sbar")');
    expect(code).toContain('If InStr(sbar.Text, expected) = 0 Then Err.Raise');
  });

  it('SAP_HANDLE_POPUP checks for wnd[1] without failing when no popup is present', () => {
    const code = compileOne(step({ stepOrder: 1, stepType: 'SAP_HANDLE_POPUP' }));
    expect(code).toContain('Session.findById("wnd[1]")');
    expect(code).toContain('If popupExists Then');
    expect(code).toContain('sendVKey 0');
  });

  it('SAP_HANDLE_POPUP presses a specific button when buttonId is configured', () => {
    const code = compileOne(step({ stepOrder: 1, stepType: 'SAP_HANDLE_POPUP', config: { buttonId: 'usr/btnSPOP-OPTION1' } }));
    expect(code).toContain('Session.findById("wnd[1]/usr/btnSPOP-OPTION1").Press');
  });

  it('SAP_VALIDATION raises when the status bar reports an Error or Abort message type', () => {
    const code = compileOne(step({ stepOrder: 1, stepType: 'SAP_VALIDATION' }));
    expect(code).toContain('Session.findById("wnd[0]/sbar")');
    expect(code).toContain('If sbar.MessageType = "E" Or sbar.MessageType = "A" Then Err.Raise');
  });
});

describe('compileFlowToSapGuiVbs — placeholder resolution helper', () => {
  it('emits a ResolvePlaceholders function covering timestamp/randomEmail/randomUser/today/futureDate', () => {
    const code = compileFlowToSapGuiVbs({ flowName: 'F', steps: [] }).files[0].code;
    expect(code).toContain('Function ResolvePlaceholders(value)');
    expect(code).toContain('{{timestamp}}');
    expect(code).toContain('{{randomEmail}}');
    expect(code).toContain('{{randomUser}}');
    expect(code).toContain('{{today}}');
    expect(code).toContain('{{futureDate');
  });
});

// Regression coverage for the runtime-hardening pass: SAP silently reports
// problems (a still-processing action, an unrequested popup, a status-bar
// error with no COM exception at all) that nothing before this caught,
// confirmed against a real execution failure landing on the wrong step.
describe('compileFlowToSapGuiVbs — runtime hardening', () => {
  function compileOne(s: CompilerStep): string {
    return compileFlowToSapGuiVbs({ flowName: 'F', steps: [s] }).files[0].code;
  }

  it('every step waits for Session.Busy to clear before deciding pass/fail', () => {
    const code = compileOne(step({ stepOrder: 1, stepType: 'CLICK', object: submitButton }));
    expect(code).toContain('Do While Session.Busy And busyWaitCount < 100');
    expect(code).toContain('WScript.Sleep 100');
  });

  it('every step checks for an unexpected wnd[1] popup and fails cleanly if one appears', () => {
    const code = compileOne(step({ stepOrder: 1, stepType: 'CLICK', object: submitButton }));
    expect(code).toContain('popupText = Session.findById("wnd[1]").Text');
    expect(code).toContain('LogAction "Unexpected popup detected: " & popupText');
    expect(code).toContain('Err.Raise vbObjectError + 900, "UnexpectedPopup"');
  });

  it('every step checks the status bar and fails on a lingering E/A message even if nothing else threw', () => {
    const code = compileOne(step({ stepOrder: 1, stepType: 'CLICK', object: submitButton }));
    expect(code).toContain('Set sbarCheck = Session.findById("wnd[0]/sbar")');
    expect(code).toContain('If sbarCheck.MessageType = "E" Or sbarCheck.MessageType = "A" Then');
    expect(code).toContain('Err.Raise vbObjectError + 901, "StatusBarError"');
  });

  it('the shared hardening variables are declared once, not re-declared per step (Option Explicit would reject that)', () => {
    const code = compileFlowToSapGuiVbs({
      flowName: 'F',
      steps: [
        step({ stepOrder: 1, stepType: 'CLICK', object: submitButton }),
        step({ stepOrder: 2, stepType: 'CLICK', object: homeTab }),
      ],
    }).files[0].code;
    const dimCount = (code.match(/Dim SapGuiAuto,/g) ?? []).length;
    expect(dimCount).toBe(1);
    expect(code).toContain('sbarCheck, busyWaitCount');
  });
});
