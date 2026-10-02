window.TestPilot = window.TestPilot || {};

window.TestPilot.DATA = {
  product: {
    name: 'Enterprise Access Automation',
    type: 'Hybrid',
    environment: 'QA Regression',
    entry: 'https://qa.example-enterprise.com',
    framework: 'Hybrid Runner',
    owner: 'QA Manager',
    description: 'Generic product automation covering SAP GUI, Web, Desktop, and cross-platform validation flows.'
  },
  readiness: {
    product: 86,
    knowledge: 92,
    library: 88,
    mapping: 84
  },
  stats: [
    ['Total Products', '04', '1 active pilot'],
    ['Knowledge Sources', '128', '24 processed today'],
    ['Library Objects', '546', '37 need review'],
    ['Test Cases Imported', '1,240', '92 new this sprint'],
    ['Automated Test Cases', '740', '56 generated this week'],
    ['Failed Mappings', '38', '12 below confidence'],
    ['Auto-Healed Objects', '31', '8 approved today'],
    ['Executed Runs', '186', '89% pass rate']
  ],
  platformCoverage: [
    ['SAP GUI', 42],
    ['Web', 31],
    ['Desktop', 12],
    ['Hybrid', 15]
  ],
  automationStatus: [
    ['Ready', 740, 'success'],
    ['Need Review', 112, 'warning'],
    ['Failed', 38, 'error'],
    ['Executed', 186, 'primary']
  ],
  activity: [
    ['11:18 AM', 'TestPilot Agent', 'Zephyr result updated', 'TC-101 execution evidence attached.', 'Success'],
    ['11:12 AM', 'User', 'Mapping approved', 'Role search flow approved for script generation.', 'Approved'],
    ['10:58 AM', 'TestPilot Agent', 'Auto-heal suggestion created', 'Role Name locator changed after UI release.', 'Review'],
    ['10:42 AM', 'TestPilot Agent', 'Knowledge processed', '8 modules, 36 features, and 214 rules extracted.', 'Success']
  ],
  knowledgeSources: [
    ['User Guides', 'PDF / DOCX', 24, 'Processed'],
    ['Functional Specs', 'DOCX', 18, 'Processed'],
    ['Jira Stories', 'Jira', 42, 'Synced'],
    ['Screenshots', 'PNG / JPG', 36, 'Processed'],
    ['Existing Test Cases', 'Excel / Zephyr', 1_240, 'Indexed'],
    ['Release Notes', 'PDF', 8, 'Review'],
    ['Known Issues', 'Jira', 17, 'Indexed']
  ],
  extractedKnowledge: [
    ['Role Catalog', 'Role Search', 'Search filters must return active roles only.', 96],
    ['Access Request', 'Request Creation', 'Requester and approver fields are mandatory before submit.', 94],
    ['Generic Upload', 'File Validation', 'Invalid file format must show a blocking error.', 93],
    ['SAP Validation', 'Status Bar', 'Successful save must emit confirmation message.', 91],
    ['Desktop Client', 'Batch Upload', 'Upload queue must retry transient network failures.', 87],
    ['Hybrid Flow', 'Backend Validation', 'Web action must reconcile with SAP status.', 86]
  ],
  processing: {
    modules: ['Role Catalog', 'Access Request', 'Generic Upload', 'SAP Validation', 'Desktop Client', 'Hybrid Flow'],
    features: ['Role Search', 'Request Creation', 'File Validation', 'Approval Routing', 'Evidence Capture', 'Backend Reconciliation'],
    rules: [
      'Search filters require at least one business key.',
      'Approver cannot be the same as requester.',
      'Invalid upload files must not create backend records.',
      'Successful SAP save must include status bar confirmation.'
    ],
    validations: [
      'Field mandatory validation',
      'Table row count validation',
      'Status message validation',
      'Cross-system reconciliation'
    ],
    messages: [
      'Request submitted successfully',
      'No matching records found',
      'Invalid file format',
      'Backend validation completed'
    ],
    gaps: [
      ['Desktop retry behavior', 'Need screenshots for retry dialog', 'Medium'],
      ['Hybrid rollback path', 'Missing expected SAP message', 'High'],
      ['Jira defect mapping', 'Need project-specific defect fields', 'Low']
    ],
    suggestions: [
      'Upload release notes for the latest role search update.',
      'Capture SAP status bar screenshots for save and error scenarios.',
      'Add negative test cases for invalid upload file types.'
    ]
  },
  objects: [
    {
      name: 'Role Name',
      platform: 'Web',
      product: 'Enterprise Access Automation',
      module: 'Role Catalog',
      feature: 'Role Search',
      screen: 'Search Home',
      type: 'Input',
      path: '//input[@placeholder="Role Name"]',
      actions: ['Enter Text', 'Clear', 'Verify Value'],
      status: 'Active',
      confidence: 96,
      aliases: ['Role', 'Role Search', 'Business Role'],
      verified: 'Today 10:30 AM'
    },
    {
      name: 'Execute',
      platform: 'SAP GUI',
      product: 'Enterprise Access Automation',
      module: 'SAP Validation',
      feature: 'Backend Search',
      screen: 'Toolbar',
      type: 'Button',
      path: 'wnd[0]/tbar[1]/btn[8]',
      actions: ['Click', 'Verify Enabled'],
      status: 'Active',
      confidence: 94,
      aliases: ['Run', 'Search', 'Execute'],
      verified: 'Today 10:22 AM'
    },
    {
      name: 'Upload File',
      platform: 'Web',
      product: 'Enterprise Access Automation',
      module: 'Generic Upload',
      feature: 'File Validation',
      screen: 'Upload Page',
      type: 'File Button',
      path: '#upload-file',
      actions: ['Upload', 'Verify File Name'],
      status: 'Review',
      confidence: 82,
      aliases: ['Attach File', 'Choose File'],
      verified: 'Yesterday 04:45 PM'
    },
    {
      name: 'Function ID',
      platform: 'SAP GUI',
      product: 'Enterprise Access Automation',
      module: 'Sample SE',
      feature: 'Search Screen',
      screen: 'Selection Screen',
      type: 'Input',
      path: 'wnd[0]/usr/ctxtS_FUNC-LOW',
      actions: ['Enter Text', 'Clear', 'Verify Value'],
      status: 'Active',
      confidence: 91,
      aliases: ['Function', 'Function Code'],
      verified: 'Today 09:40 AM'
    },
    {
      name: 'Desktop Queue',
      platform: 'Desktop',
      product: 'Enterprise Access Automation',
      module: 'Desktop Client',
      feature: 'Batch Upload',
      screen: 'Queue Monitor',
      type: 'Table',
      path: 'AutomationId=UploadQueueGrid',
      actions: ['Verify Row', 'Select Row', 'Read Cell'],
      status: 'Active',
      confidence: 89,
      aliases: ['Upload Queue', 'Batch Queue'],
      verified: 'Yesterday 03:15 PM'
    }
  ],
  pathHistory: [
    ['Today 10:58 AM', 'Role Name', '//input[@id="role"]', '//input[@placeholder="Role Name"]', 'Pending approval'],
    ['Yesterday 04:45 PM', 'Upload File', '.old-upload-btn', '#upload-file', 'Approved'],
    ['Jun 07 02:20 PM', 'Function ID', 'wnd[0]/usr/oldFunc', 'wnd[0]/usr/ctxtS_FUNC-LOW', 'Approved']
  ],
  testCases: [
    ['TC-101', 'Validate role search result', 'Role Catalog', 'Role Search', 'Zephyr', 8, 'Matching role appears in result table.', 91, 'Ready'],
    ['TC-102', 'Upload invalid file and verify error', 'Generic Upload', 'File Validation', 'Excel', 6, 'Invalid file format error appears.', 76, 'Need Review'],
    ['TC-103', 'Create access request and validate SAP status', 'Access Request', 'Request Creation', 'Jira', 12, 'Request is saved and SAP status confirms success.', 84, 'Ready'],
    ['TC-104', 'Verify desktop batch upload retry', 'Desktop Client', 'Batch Upload', 'CSV', 9, 'Retry succeeds after transient failure.', 68, 'Missing Object'],
    ['TC-105', 'End-to-end hybrid approval flow', 'Hybrid Flow', 'Backend Validation', 'Manual Paste', 15, 'Web approval reconciles with SAP backend.', 73, 'Need Review']
  ],
  mappingSummary: {
    testCase: 'TC-101',
    title: 'Validate role search result',
    confidence: 91,
    mapped: 7,
    unmapped: 1,
    knowledgeReady: true,
    libraryReady: true
  },
  mappedSteps: [
    ['Open Role Catalog search page', 'Launch configured product entry point and navigate to Role Search.', 'Role Search Page', 'navigate', 96, 'Mapped'],
    ['Enter role name AM_ANALYST', 'Use the known Role Name input with test data.', 'Role Name', 'enter_text', 95, 'Mapped'],
    ['Click Search', 'Trigger search action using the primary search button.', 'Search Button', 'click', 93, 'Mapped'],
    ['Verify result table contains role', 'Read result table and assert expected role is present.', 'Role Result Table', 'assert_table', 88, 'Mapped'],
    ['Open backend SAP validation', 'Switch to SAP validation screen for cross-check.', 'SAP Entry Point', 'open_transaction', 84, 'Review'],
    ['Verify SAP status message', 'Read SAP status bar message after backend lookup.', 'Status Bar', 'assert_message', 82, 'Review'],
    ['Attach evidence', 'Capture screenshot and execution logs.', 'Evidence Service', 'capture_evidence', 97, 'Mapped'],
    ['Update Zephyr result', 'Publish pass/fail status and evidence.', 'Zephyr Cycle', 'publish_result', 74, 'Needs Context']
  ],
  frameworks: [
    ['SAP GUI - VBScript', 'Best for SAP Logon and SAP GUI scripting.', 92],
    ['Web - Selenium Java', 'Best for enterprise browser regression suites.', 86],
    ['Web - Playwright', 'Best for fast modern web automation.', 88],
    ['BDD - Cucumber', 'Best for business-readable acceptance tests.', 80],
    ['Desktop Automation', 'Best for Windows desktop clients.', 77],
    ['Hybrid Runner', 'Best for SAP plus Web plus Desktop flows.', 94]
  ],
  scripts: {
    'Generated Code': `' TestPilot AI generated hybrid script preview\n' Test Case: TC-101 Validate role search result\n\nSet runner = CreateObject("TestPilot.HybridRunner")\nrunner.OpenWeb "\${PRODUCT_URL}"\nrunner.EnterText "Role Name", testData("roleName")\nrunner.Click "Search Button"\nrunner.AssertTableContains "Role Result Table", testData("roleName")\nrunner.OpenSapTransaction "/n/VALIDATE_ROLE"\nrunner.AssertStatusBar "Validation completed"\nrunner.CaptureEvidence "role-search-result"\nrunner.PublishResult "Zephyr", "PASS"`,
    'Reusable Actions': `open_product(entryPoint)\nenter_text(objectAlias, value)\nclick_object(objectAlias)\nassert_table_contains(objectAlias, expectedValue)\nassert_status_message(expectedMessage)\ncapture_evidence(name)\npublish_result(target, status)`,
    'Test Data': `roleName: AM_ANALYST\nrequester: qa.manager\nexpectedStatus: Validation completed\nenvironment: QA Regression`,
    'Config': `product: Enterprise Access Automation\nagent: TestPilot Agent\nframework: Hybrid Runner\napprovalRequired: true\nminimumMappingConfidence: 85`,
    'Execution Command': `testpilot-runner run --project "Enterprise Access Automation" --case TC-101 --framework hybrid --evidence on`
  },
  executions: [
    ['TC-101', 'Hybrid', 'Hybrid Runner', 'Passed', '03:42', 'Screenshot + logs'],
    ['TC-102', 'Web', 'Selenium Java', 'Failed', '01:08', 'Console logs'],
    ['TC-103', 'SAP GUI', 'VBScript', 'Running', '02:15', 'Live capture'],
    ['TC-104', 'Desktop', 'Desktop Automation', 'Blocked', '--', 'Missing object'],
    ['TC-105', 'Hybrid', 'Hybrid Runner', 'Skipped', '--', 'Dependency failed']
  ],
  executionSteps: [
    ['1', 'Open product entry point', 'Passed', '00:12'],
    ['2', 'Enter role name', 'Passed', '00:05'],
    ['3', 'Click Search', 'Passed', '00:04'],
    ['4', 'Validate SAP backend', 'Running', '01:12'],
    ['5', 'Publish result', 'Queued', '--']
  ],
  logs: [
    '[11:17:02] Runner initialized for QA Regression',
    '[11:17:14] Object Role Name resolved with 96% confidence',
    '[11:17:28] Result table assertion passed',
    '[11:18:01] SAP status validation running'
  ],
  failureAnalysis: [
    ['Root Cause', 'Locator changed after Web UI release'],
    ['Failure Type', 'Object identification'],
    ['Suggested Action', 'Review auto-heal suggestion before repository update'],
    ['Risk', 'Low if approved by QA owner']
  ],
  heals: [
    ['Role Name', 'Web', '//input[@id="role"]', '//input[@placeholder="Role Name"]', 'Placeholder is stable across release build.', 88, 'Pending Review'],
    ['Upload File', 'Web', '.old-upload-btn', '#upload-file', 'New ID detected in DOM and verified by label.', 86, 'Pending Review'],
    ['Function ID', 'SAP GUI', 'wnd[0]/usr/oldFunc', 'wnd[0]/usr/ctxtS_FUNC-LOW', 'SAP technical ID changed after transport.', 92, 'Approved'],
    ['Desktop Queue', 'Desktop', 'Name=QueueGridOld', 'AutomationId=UploadQueueGrid', 'Automation ID remained stable in accessibility tree.', 81, 'Test Needed']
  ],
  syncHistory: [
    ['Today 11:18 AM', 'Export Execution Results', 'Zephyr cycle REG-QA-24 updated', 'Success'],
    ['Today 10:20 AM', 'Import Test Cases', '42 Zephyr cases imported', 'Success'],
    ['Yesterday 05:10 PM', 'Attach Logs', '3 failed execution logs attached', 'Success'],
    ['Yesterday 04:40 PM', 'Create Defect', '1 Jira defect drafted for failed mapping', 'Review']
  ],
  reportCards: [
    ['Automation Coverage', 78, 'primary'],
    ['Execution Trend', 82, 'success'],
    ['Framework Usage', 64, 'secondary'],
    ['Failure Categories', 18, 'error'],
    ['Auto-Heal Success Rate', 76, 'success'],
    ['Product Library Health', 88, 'primary']
  ],
  moduleCoverage: [
    ['Role Catalog', 320, 248, 226, 22, '78%'],
    ['Access Request', 260, 184, 166, 18, '71%'],
    ['Generic Upload', 140, 104, 92, 12, '74%'],
    ['SAP Validation', 180, 130, 118, 12, '72%'],
    ['Desktop Client', 90, 44, 38, 6, '49%'],
    ['Hybrid Flow', 110, 60, 52, 8, '55%']
  ],
  audit: [
    ['09:00 AM', 'User', 'Product created', 'Enterprise Access Automation', 'Success', 'Hybrid product configured for QA Regression.', '', ''],
    ['09:18 AM', 'User', 'Knowledge uploaded', 'User guides and specs', 'Success', '24 documents uploaded.', '', ''],
    ['09:30 AM', 'TestPilot Agent', 'Knowledge processed', 'Knowledge Base', 'Success', '214 business rules extracted.', '', ''],
    ['09:48 AM', 'User', 'Product library captured', 'Object Repository', 'Success', '546 objects captured across SAP, Web, Desktop.', '', ''],
    ['10:05 AM', 'TestPilot Agent', 'Object path changed', 'Role Name', 'Review', 'Release changed role locator.', '//input[@id="role"]', '//input[@placeholder="Role Name"]'],
    ['10:20 AM', 'User', 'Test case imported', 'TC-101', 'Success', 'Imported from Zephyr.', '', ''],
    ['10:42 AM', 'TestPilot Agent', 'Step mapping generated', 'TC-101', 'Review', '7 of 8 steps mapped.', '', ''],
    ['11:12 AM', 'User', 'Mapping approved', 'TC-101', 'Approved', 'Approved for script generation.', '', ''],
    ['11:14 AM', 'TestPilot Agent', 'Script generated', 'TC-101', 'Success', 'Hybrid Runner script generated.', '', ''],
    ['11:17 AM', 'TestPilot Agent', 'Test executed', 'TC-101', 'Success', 'Execution completed with evidence.', '', ''],
    ['11:18 AM', 'TestPilot Agent', 'Failure analyzed', 'TC-102', 'Review', 'Locator issue detected.', '', ''],
    ['11:19 AM', 'TestPilot Agent', 'Auto-heal suggestion created', 'Role Name', 'Review', 'Suggested stable locator.', '', ''],
    ['11:22 AM', 'User', 'Auto-heal approved', 'Role Name', 'Approved', 'Repository update approved.', '//input[@id="role"]', '//input[@placeholder="Role Name"]'],
    ['11:24 AM', 'TestPilot Agent', 'Zephyr updated', 'TC-101', 'Success', 'Result and evidence pushed.', '', '']
  ],
  settings: {
    model: 'GPT-4.1 Enterprise',
    vectorDb: 'Managed Vector Index',
    runner: 'Hybrid Runner Pool',
    retention: '365 days',
    toggles: {
      requireScriptApproval: true,
      requireHealApproval: true,
      allowAutoRun: false,
      storeEvidence: true,
      enableHybridRunner: true,
      enableDesktopAutomation: true
    }
  }
};
