import { FlowStepType } from '../../../generated/prisma/enums';

export interface PaletteItem {
  stepType: FlowStepType;
  label: string;
  category: 'Navigation' | 'Interaction' | 'Assertion' | 'Control' | 'Integration';
  requiresObject: boolean;
  requiresData: boolean;
  description: string;
}

export const STEP_PALETTE: PaletteItem[] = [
  { stepType: 'OPEN_URL', label: 'Open URL', category: 'Navigation', requiresObject: false, requiresData: false, description: 'Navigate to a URL' },
  { stepType: 'CLICK', label: 'Click', category: 'Interaction', requiresObject: true, requiresData: false, description: 'Click an element' },
  { stepType: 'ENTER_TEXT', label: 'Enter Text', category: 'Interaction', requiresObject: true, requiresData: true, description: 'Type into a field' },
  { stepType: 'SELECT_DROPDOWN', label: 'Select Dropdown', category: 'Interaction', requiresObject: true, requiresData: true, description: 'Choose a dropdown option' },
  { stepType: 'WAIT', label: 'Wait', category: 'Control', requiresObject: false, requiresData: false, description: 'Pause for a duration' },
  { stepType: 'VERIFY_TEXT', label: 'Verify Text', category: 'Assertion', requiresObject: true, requiresData: true, description: "Assert an element's text" },
  { stepType: 'VERIFY_ELEMENT_VISIBLE', label: 'Verify Element Visible', category: 'Assertion', requiresObject: true, requiresData: false, description: 'Assert an element is visible' },
  { stepType: 'UPLOAD_FILE', label: 'Upload File', category: 'Interaction', requiresObject: true, requiresData: true, description: 'Upload a file' },
  { stepType: 'DOWNLOAD_FILE', label: 'Download File', category: 'Interaction', requiresObject: true, requiresData: false, description: 'Trigger and capture a download' },
  { stepType: 'SCROLL', label: 'Scroll', category: 'Interaction', requiresObject: true, requiresData: false, description: 'Scroll an element into view' },
  { stepType: 'HOVER', label: 'Hover', category: 'Interaction', requiresObject: true, requiresData: false, description: 'Hover over an element' },
  { stepType: 'SWITCH_TAB', label: 'Switch Tab', category: 'Control', requiresObject: false, requiresData: false, description: 'Switch to a newly opened browser tab' },
  { stepType: 'ACCEPT_ALERT', label: 'Accept Alert', category: 'Control', requiresObject: false, requiresData: false, description: 'Accept a JS dialog/alert' },
  { stepType: 'API_CALL', label: 'API Call', category: 'Integration', requiresObject: false, requiresData: true, description: 'Call a REST API' },
  { stepType: 'DB_VALIDATION', label: 'DB Validation', category: 'Integration', requiresObject: false, requiresData: false, description: 'Validate database state (future)' },
  { stepType: 'SAP_VALIDATION', label: 'SAP Validation', category: 'Assertion', requiresObject: false, requiresData: false, description: 'Assert the SAP status bar shows no error after the previous action' },
  // SAP GUI action vocabulary — CLICK/ENTER_TEXT/SELECT_DROPDOWN/VERIFY_TEXT/
  // VERIFY_ELEMENT_VISIBLE/WAIT above already cover press/setText/select/
  // selectTab/assertFieldValue/wait for SAP objects (the compiler picks
  // SAP GUI vs. web behavior from the bound object's own locator type, not
  // stepType), so only actions with no existing equivalent are listed here.
  { stepType: 'SAP_SEND_VKEY', label: 'Send Function Key', category: 'Interaction', requiresObject: false, requiresData: false, description: 'Send an SAP GUI function key (Enter, F8, Save, ...) to the active window' },
  { stepType: 'SAP_START_TRANSACTION', label: 'Start Transaction', category: 'Interaction', requiresObject: false, requiresData: true, description: 'Navigate directly to a transaction code' },
  { stepType: 'SAP_CHECK', label: 'Check Checkbox', category: 'Interaction', requiresObject: true, requiresData: false, description: 'Select an SAP GUI checkbox' },
  { stepType: 'SAP_UNCHECK', label: 'Uncheck Checkbox', category: 'Interaction', requiresObject: true, requiresData: false, description: 'Clear an SAP GUI checkbox' },
  { stepType: 'SAP_GRID_SET_CELL', label: 'Set Grid Cell', category: 'Interaction', requiresObject: true, requiresData: true, description: 'Set a cell value in a GuiGridView (row/column configured on the step)' },
  { stepType: 'SAP_GRID_DOUBLE_CLICK_CELL', label: 'Double-Click Grid Cell', category: 'Interaction', requiresObject: true, requiresData: false, description: 'Double-click a cell in a GuiGridView (row/column configured on the step)' },
  { stepType: 'SAP_TABLE_SET_CELL', label: 'Set Table Cell', category: 'Interaction', requiresObject: true, requiresData: true, description: 'Set a cell value in a GuiTableControl (row/column configured on the step)' },
  { stepType: 'SAP_READ_STATUS_BAR', label: 'Read Status Bar', category: 'Assertion', requiresObject: false, requiresData: false, description: 'Log the SAP status bar message without asserting on it' },
  { stepType: 'SAP_ASSERT_STATUS_MESSAGE', label: 'Assert Status Message', category: 'Assertion', requiresObject: false, requiresData: true, description: 'Assert the SAP status bar contains the expected text' },
  { stepType: 'SAP_HANDLE_POPUP', label: 'Handle Popup', category: 'Control', requiresObject: false, requiresData: false, description: 'Dismiss or confirm an SAP GUI popup window if one appears' },
];
