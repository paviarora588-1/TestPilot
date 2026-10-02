import type { HistoryEvent, MappingRow, Product, RepositoryObject, TestCase } from '../types';

export const product: Product = {
  id: 1,
  name: 'Enterprise Access Automation',
  type: 'Hybrid',
  environment: 'QA Regression',
  entryPoint: 'https://qa.example-enterprise.com',
  framework: 'Hybrid Runner',
  owner: 'QA Manager',
  description: 'Generic cross-platform automation pilot for SAP GUI, Web, Desktop, and Hybrid flows.',
  readiness: 86
};

export const readiness = {
  knowledge: 92,
  library: 88,
  mapping: 84,
  product: 86
};

export const stats = [
  ['Total Products', '04', '1 active pilot'],
  ['Knowledge Sources', '128', '24 processed today'],
  ['Library Objects', '546', '37 need review'],
  ['Test Cases Imported', '1,240', '92 new this sprint'],
  ['Automated Test Cases', '740', '56 generated this week'],
  ['Failed Mappings', '38', '12 below confidence'],
  ['Auto-Healed Objects', '31', '8 approved today']
];

export const platformCoverage = [
  ['SAP GUI', 42],
  ['Web', 31],
  ['Desktop', 12],
  ['Hybrid', 15]
] as const;

export const automationStatus = [
  ['Ready', 740],
  ['Need Review', 112],
  ['Failed', 38],
  ['Executed', 186]
];

export const objects: RepositoryObject[] = [
  {
    id: 1,
    objectName: 'Role Name',
    platform: 'Web',
    product: product.name,
    module: 'Role Catalog',
    feature: 'Role Search',
    screen: 'Search Home',
    objectType: 'Input',
    locator: '//input[@placeholder="Role Name"]',
    supportedActions: ['Enter Text', 'Clear', 'Verify Value'],
    status: 'Active',
    confidence: 96,
    aliases: ['Role', 'Business Role', 'Role Search'],
    lastVerified: 'Today 10:30 AM'
  },
  {
    id: 2,
    objectName: 'Execute',
    platform: 'SAP GUI',
    product: product.name,
    module: 'SAP Validation',
    feature: 'Backend Search',
    screen: 'Toolbar',
    objectType: 'Button',
    locator: 'wnd[0]/tbar[1]/btn[8]',
    supportedActions: ['Click', 'Verify Enabled'],
    status: 'Active',
    confidence: 94,
    aliases: ['Run', 'Search', 'Execute'],
    lastVerified: 'Today 10:22 AM'
  },
  {
    id: 3,
    objectName: 'Upload File',
    platform: 'Web',
    product: product.name,
    module: 'Generic Upload',
    feature: 'File Validation',
    screen: 'Upload Page',
    objectType: 'File Button',
    locator: '#upload-file',
    supportedActions: ['Upload', 'Verify File Name'],
    status: 'Review',
    confidence: 82,
    aliases: ['Attach File', 'Choose File'],
    lastVerified: 'Yesterday 04:45 PM'
  },
  {
    id: 4,
    objectName: 'Function ID',
    platform: 'SAP GUI',
    product: product.name,
    module: 'Sample SE',
    feature: 'Search Screen',
    screen: 'Selection Screen',
    objectType: 'Input',
    locator: 'wnd[0]/usr/ctxtS_FUNC-LOW',
    supportedActions: ['Enter Text', 'Clear', 'Verify Value'],
    status: 'Active',
    confidence: 91,
    aliases: ['Function', 'Function Code'],
    lastVerified: 'Today 09:40 AM'
  }
];

export const testCases: TestCase[] = [
  { id: 1, externalId: 'TC-101', title: 'Validate role search result', module: 'Role Catalog', feature: 'Role Search', source: 'Zephyr', steps: 8, expectedResult: 'Matching role appears in result table.', readiness: 91, status: 'Ready' },
  { id: 2, externalId: 'TC-102', title: 'Upload invalid file and verify error', module: 'Generic Upload', feature: 'File Validation', source: 'Excel', steps: 6, expectedResult: 'Invalid file format error appears.', readiness: 76, status: 'Need Review' },
  { id: 3, externalId: 'TC-103', title: 'Create access request and validate SAP status', module: 'Access Request', feature: 'Request Creation', source: 'Jira', steps: 12, expectedResult: 'SAP status confirms success.', readiness: 84, status: 'Ready' },
  { id: 4, externalId: 'TC-104', title: 'Verify desktop batch upload retry', module: 'Desktop Client', feature: 'Batch Upload', source: 'CSV', steps: 9, expectedResult: 'Retry succeeds after transient failure.', readiness: 68, status: 'Review' }
];

export const mappingRows: MappingRow[] = [
  { id: 1, manualStep: 'Open Role Catalog search page', aiUnderstanding: 'Launch configured product and navigate to Role Search.', mappedObject: 'Role Search Page', action: 'navigate', confidence: 96, status: 'Ready' },
  { id: 2, manualStep: 'Enter role name AM_ANALYST', aiUnderstanding: 'Use known Role Name input with test data.', mappedObject: 'Role Name', action: 'enter_text', confidence: 95, status: 'Ready' },
  { id: 3, manualStep: 'Click Search', aiUnderstanding: 'Trigger search action using primary search control.', mappedObject: 'Search Button', action: 'click', confidence: 93, status: 'Ready' },
  { id: 4, manualStep: 'Verify result table contains role', aiUnderstanding: 'Read result table and assert expected role is present.', mappedObject: 'Role Result Table', action: 'assert_table', confidence: 88, status: 'Ready' },
  { id: 5, manualStep: 'Update Zephyr result', aiUnderstanding: 'Publish pass/fail and attach evidence.', mappedObject: 'Zephyr Cycle', action: 'publish_result', confidence: 74, status: 'Need Review' }
];

export const history: HistoryEvent[] = [
  { time: '09:00 AM', actor: 'User', action: 'Product created', entity: product.name, status: 'Success', details: 'Hybrid product configured for QA Regression.' },
  { time: '09:18 AM', actor: 'User', action: 'Knowledge uploaded', entity: 'User guides and specs', status: 'Success', details: '24 documents uploaded.' },
  { time: '09:30 AM', actor: 'TestPilot Agent', action: 'Knowledge processed', entity: 'Knowledge Base', status: 'Success', details: '214 business rules extracted.' },
  { time: '09:48 AM', actor: 'User', action: 'Product library captured', entity: 'Object Repository', status: 'Success', details: '546 objects captured across SAP, Web, Desktop.' },
  { time: '10:05 AM', actor: 'TestPilot Agent', action: 'Object path changed', entity: 'Role Name', status: 'Review', details: 'Release changed role locator.', before: '//input[@id="role"]', after: '//input[@placeholder="Role Name"]' },
  { time: '10:42 AM', actor: 'TestPilot Agent', action: 'Mapping generated', entity: 'TC-101', status: 'Review', details: '7 of 8 steps mapped.' },
  { time: '11:12 AM', actor: 'User', action: 'Mapping approved', entity: 'TC-101', status: 'Approved', details: 'Approved for script generation.' },
  { time: '11:17 AM', actor: 'TestPilot Agent', action: 'Test executed', entity: 'TC-101', status: 'Success', details: 'Execution completed with evidence.' },
  { time: '11:24 AM', actor: 'TestPilot Agent', action: 'Zephyr updated', entity: 'TC-101', status: 'Success', details: 'Result and evidence pushed.' }
];

export const scriptTabs: Record<string, string> = {
  'Generated Code': `' Hybrid Runner sample\nrunner.openProduct(config.entryPoint)\nrunner.enterText('Role Name', data.roleName)\nrunner.click('Search Button')\nrunner.assertTableContains('Role Result Table', data.roleName)\nrunner.captureEvidence('role-search')`,
  'Reusable Actions': 'open_product(entryPoint)\nenter_text(alias, value)\nclick_object(alias)\nassert_table_contains(alias, value)\ncapture_evidence(name)',
  'Test Data': 'roleName: AM_ANALYST\nenvironment: QA Regression\nexpectedStatus: Validation completed',
  Config: 'framework: Hybrid Runner\napprovalRequired: true\nminimumMappingConfidence: 85',
  'Execution Command': 'testpilot-runner run --case TC-101 --framework hybrid --evidence on'
};
