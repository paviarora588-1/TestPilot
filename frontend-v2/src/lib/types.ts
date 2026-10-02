export type ApplicationType = 'WEB' | 'SAP_GUI' | 'HYBRID' | 'API' | 'DESKTOP' | 'MOBILE';
export type AutomationFramework = 'PLAYWRIGHT' | 'SELENIUM' | 'CYPRESS' | 'SAP_VBSCRIPT' | 'HYBRID';
export type ScanStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED';
export type LocatorType = 'ID' | 'DATA_TESTID' | 'ARIA_LABEL' | 'NAME' | 'CSS' | 'XPATH' | 'TEXT' | 'SAP_GUI_ID';
export type WorkingStatus = 'WORKING' | 'BROKEN' | 'UNKNOWN';

export interface Application {
  id: string;
  name: string;
  appType: ApplicationType;
  environment: string | null;
  entryUrl: string | null;
  entryTransactionCode: string | null;
  defaultFramework: AutomationFramework;
  owner: string | null;
  description: string | null;
  businessCriticality: string | null;
  automationRiskLevel: string | null;
  readinessScore: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ScanObject {
  id: string;
  label: string | null;
  objectType: string;
  xpath: string;
  cssSelector: string | null;
  buttonText: string | null;
  ariaLabel: string | null;
  nearbyLabelText: string | null;
  placeholder: string | null;
  recommendedLocator: string;
  recommendedLocatorType: LocatorType;
  backupLocators: string[] | null;
  confidenceScore: number;
  promoted: boolean;
}

export interface ScanPage {
  id: string;
  url: string;
  title: string | null;
  screenshotPath: string | null;
  htmlSnapshotPath: string | null;
  objects: ScanObject[];
}

export interface ScanSession {
  id: string;
  applicationId: string;
  targetUrl: string;
  status: ScanStatus;
  startedAt: string | null;
  finishedAt: string | null;
  pagesScanned: number;
  objectsFound: number;
  errorMessage: string | null;
  createdAt: string;
  pages?: ScanPage[];
  commonObjects?: ScanObject[];
}

export type RecordingStatus =
  | 'LAUNCHING'
  | 'RECORDING'
  | 'PAUSED'
  | 'STOPPED'
  | 'CONVERTED'
  | 'FAILED'
  | 'CANCELLED'
  | 'ABANDONED';

export type RecordedActionType =
  | 'NAVIGATE'
  | 'CLICK'
  | 'DOUBLE_CLICK'
  | 'RIGHT_CLICK'
  | 'ENTER_TEXT'
  | 'SELECT_OPTION'
  | 'CHECK'
  | 'UNCHECK'
  | 'UPLOAD_FILE'
  | 'NEW_TAB'
  | 'SWITCH_TAB'
  | 'CLOSE_TAB'
  | 'ALERT_ACCEPT'
  | 'ALERT_DISMISS';

export interface WebRecordingStep {
  id: string;
  sessionId: string;
  stepOrder: number;
  actionType: RecordedActionType;
  label: string | null;
  pageUrl: string | null;
  pageTitle: string | null;
  frameUrl: string | null;
  tabIndex: number;
  recommendedLocator: string | null;
  recommendedLocatorType: LocatorType | null;
  backupLocators: string[] | null;
  objectTypeHint: string | null;
  rawValue: string | null;
  isVariable: boolean;
  variableName: string | null;
  isSensitive: boolean;
  createdAt: string;
}

export interface WebRecordingSession {
  id: string;
  applicationId: string;
  targetUrl: string;
  framework: AutomationFramework;
  status: RecordingStatus;
  startedAt: string | null;
  endedAt: string | null;
  errorMessage: string | null;
  automationFlowId: string | null;
  createdAt: string;
  steps?: WebRecordingStep[];
}

export interface ObjectRepositoryItem {
  id: string;
  applicationId: string;
  moduleName: string | null;
  featureName: string | null;
  screenName: string | null;
  objectName: string;
  displayLabel: string | null;
  objectType: string;
  technicalPath: string;
  locatorStrategy: LocatorType;
  backupLocators: string[] | null;
  confidenceScore: number | null;
  verificationStatus: WorkingStatus;
  usageCount: number;
  screenshotPath: string | null;
  lastValidatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type TestCaseSource = 'MANUAL' | 'CSV' | 'EXCEL' | 'ZEPHYR_API' | 'JIRA_AI_GENERATED' | 'AI_GENERATED';
export type TestCasePriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type AutomationStatus = 'NOT_STARTED' | 'MAPPED' | 'SCRIPT_GENERATED' | 'AUTOMATED';
export type TestCaseType = 'POSITIVE' | 'NEGATIVE' | 'BOUNDARY' | 'UI' | 'INTEGRATION' | 'REGRESSION' | 'SMOKE';

export interface TestStep {
  id: string;
  testCaseId: string;
  stepOrder: number;
  instruction: string;
  expectedResult: string | null;
  requiredDataKey: string | null;
}

export interface TestCaseAnalysis {
  pageUsed: string | null;
  requiredObjects: string[];
  missingObjectMappings: string[];
  requiredTestData: string[];
  missingTestData: string[];
  validations: string[];
  gaps: string[];
  automatable: boolean;
  aiEnrichmentAvailable: boolean;
  ragContextUsed: boolean;
}

export interface DataRequirementField {
  objectId: string;
  objectName: string;
  screenName: string | null;
  fieldLabel: string;
  suggestedValue: string | null;
  sensitive: boolean;
  existingValue: string | null;
}

export interface DataRequirementGroup {
  screenName: string;
  fields: DataRequirementField[];
}

export interface DataRequirements {
  groups: DataRequirementGroup[];
}

export interface TestCase {
  id: string;
  applicationId: string;
  externalId: string | null;
  title: string;
  moduleName: string | null;
  featureName: string | null;
  source: TestCaseSource;
  priority: TestCasePriority;
  testType: TestCaseType | null;
  preconditions: string | null;
  expectedResult: string | null;
  readinessScore: number | null;
  automationStatus: AutomationStatus;
  automationRecommended: boolean | null;
  automationRecommendedReason: string | null;
  status: string;
  analysisResultJson: TestCaseAnalysis | null;
  createdAt: string;
  updatedAt: string;
  steps?: TestStep[];
}

export type TestDataImportSource = 'MANUAL' | 'EXCEL' | 'CSV' | 'JSON' | 'AI_GENERATED';

export interface TestDataSet {
  id: string;
  applicationId: string;
  name: string;
  environment: string | null;
  description: string | null;
  isReusable: boolean;
  createdAt: string;
  updatedAt: string;
  _count?: { items: number };
  items?: TestDataItem[];
}

export interface TestDataItem {
  id: string;
  testDataSetId: string;
  key: string;
  value: string;
  isSensitive: boolean;
  importedFrom: TestDataImportSource;
  createdAt: string;
  updatedAt: string;
}

export type FlowStatus = 'DRAFT' | 'VALID' | 'GENERATED' | 'PUBLISHED';
export type FlowStepType =
  | 'OPEN_URL'
  | 'CLICK'
  | 'ENTER_TEXT'
  | 'SELECT_DROPDOWN'
  | 'WAIT'
  | 'VERIFY_TEXT'
  | 'VERIFY_ELEMENT_VISIBLE'
  | 'UPLOAD_FILE'
  | 'DOWNLOAD_FILE'
  | 'SCROLL'
  | 'HOVER'
  | 'SWITCH_TAB'
  | 'ACCEPT_ALERT'
  | 'API_CALL'
  | 'DB_VALIDATION'
  | 'SAP_VALIDATION';

export interface PaletteItem {
  stepType: FlowStepType;
  label: string;
  category: 'Navigation' | 'Interaction' | 'Assertion' | 'Control' | 'Integration';
  requiresObject: boolean;
  requiresData: boolean;
  description: string;
}

export interface AutomationFlowStep {
  id: string;
  automationFlowId: string;
  nodeId: string;
  stepOrder: number;
  stepType: FlowStepType;
  objectId: string | null;
  object: ObjectRepositoryItem | null;
  testDataItemId: string | null;
  testDataItem: TestDataItem | null;
  inlineValue: string | null;
  config: Record<string, unknown> | null;
}

export interface AutomationFlow {
  id: string;
  applicationId: string;
  testCaseId: string | null;
  name: string;
  description: string | null;
  framework: AutomationFramework;
  graphJson: { nodes: unknown[]; edges: unknown[]; viewport?: unknown } | null;
  status: FlowStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
  steps?: AutomationFlowStep[];
}

export interface FlowBlockers {
  blocked: boolean;
  reasons: string[];
  nextActions: string[];
}

export type GeneratedFileRole = 'SPEC' | 'PAGE_OBJECT' | 'FIXTURE' | 'CONFIG';
export type ScriptStatus = 'DRAFT' | 'GENERATED' | 'REVIEWED' | 'APPROVED' | 'REJECTED';

export interface GeneratedScriptFile {
  id: string;
  role: GeneratedFileRole;
  fileName: string;
  filePath: string;
  code: string;
}

export interface ScriptReview {
  riskScore?: number;
  findings?: string[];
  approved?: boolean;
  // Test-scenario gaps the reviewer noticed — informational only, kept
  // separate from `findings` since those drive the execution-blocking risk
  // score and coverage gaps aren't an execution-safety concern.
  coverageSuggestions?: string[];
  aiReviewAvailable: boolean;
  reason?: string;
  ragContextUsed?: boolean;
}

export interface GeneratedScript {
  id: string;
  applicationId: string;
  automationFlowId: string | null;
  framework: AutomationFramework;
  command: string | null;
  reviewJson: ScriptReview | null;
  riskScore: number | null;
  status: ScriptStatus;
  createdAt: string;
  files: GeneratedScriptFile[];
}

export type ExecutionStatus = 'READY_TO_RUN' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'BLOCKED';
export type SuiteScope = 'SINGLE' | 'SELECTED' | 'MODULE' | 'FULL_REGRESSION';
export type StepResultStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'SKIPPED';
export type AutoHealStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface ExecutionStepResult {
  id: string;
  executionId: string;
  stepOrder: number;
  action: string;
  instruction: string | null;
  status: StepResultStatus;
  durationSeconds: number;
  message: string | null;
  screenshotPath: string | null;
  createdAt: string;
}

export type FailureCategory =
  | 'locator_not_found'
  | 'timeout'
  | 'assertion_failed'
  | 'navigation_failed'
  | 'unknown'
  | 'application_bug'
  | 'test_data_issue'
  | 'environment_issue'
  | 'requirement_mismatch'
  | 'automation_script_issue';

export interface FailureAnalysis {
  category: FailureCategory;
  failureMessage: string;
  likelyRootCause: string;
  suggestedFix: string;
  autoHealPossible: boolean;
  aiEnrichmentAvailable: boolean;
  aiRootCause?: string;
  aiSuggestedFix?: string;
  aiSuggestedCodeFix?: string | null;
}

export type BugSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type BugReportStatus = 'DRAFT' | 'SUBMITTED' | 'FAILED';

export interface BugReport {
  id: string;
  applicationId: string;
  executionId: string | null;
  title: string;
  stepsToReproduce: string[];
  actualResult: string;
  expectedResult: string | null;
  severity: BugSeverity;
  priority: TestCasePriority;
  environment: string | null;
  evidencePaths: string[] | null;
  logsSnapshot: string | null;
  status: BugReportStatus;
  externalIssueKey: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AutoHealSuggestion {
  id: string;
  applicationId: string;
  executionId: string | null;
  objectId: string | null;
  object?: { objectName: string } | null;
  oldPath: string | null;
  suggestedPath: string | null;
  reason: string | null;
  confidence: number | null;
  riskScore: number | null;
  status: AutoHealStatus;
  decidedAt: string | null;
  decidedById: string | null;
  decidedByName: string | null;
  // True when a live AI re-scan proposed this AND its confidence cleared the
  // stricter auto-apply bar — applied immediately, decidedById stays null.
  autoApproved: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ExecutionRun {
  id: string;
  applicationId: string;
  scriptId: string;
  suiteRunId: string | null;
  status: ExecutionStatus;
  runType: 'EXECUTION' | 'VALIDATION';
  attemptNumber: number;
  durationSeconds: number;
  logs: string[] | null;
  evidencePath: string | null;
  command: string | null;
  browser: string | null;
  environment: string | null;
  executedById: string | null;
  failureAnalysisJson: FailureAnalysis | null;
  createdAt: string;
  updatedAt: string;
  script?: { framework: AutomationFramework; automationFlow: { name: string } | null };
  stepResults?: ExecutionStepResult[];
  autoHealSuggestions?: AutoHealSuggestion[];
}

export interface ExecutionSuiteRun {
  id: string;
  applicationId: string;
  scope: SuiteScope;
  status: ExecutionStatus;
  totalCount: number;
  passCount: number;
  failCount: number;
  skipCount: number;
  errorCount: number;
  triggeredById: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  runs?: ExecutionRun[];
}

export interface ReportSummary {
  totalTestCases: number;
  automatedTestCases: number;
  manualTestCases: number;
  automationCoverage: number;
  totalObjects: number;
  objectHealth: { working: number; broken: number; unknown: number };
  totalScripts: number;
  totalFlows: number;
  totalDataSets: number;
  totalExecutions: number;
  passedExecutions: number;
  failedExecutions: number;
  blockedExecutions: number;
  passRate: number;
  latestExecutions: ExecutionRun[];
}

export interface ModuleCoverage {
  module: string;
  testCases: number;
  automated: number;
  coverage: number;
}

export interface FailureTrendPoint {
  date: string;
  passed: number;
  failed: number;
}

export interface QualityScoreComponent {
  label: string;
  value: number;
  weight: number;
}

export interface QualityScoreResult {
  score: number | null;
  components: QualityScoreComponent[];
  executionTrend: FailureTrendPoint[];
}

export interface FleetApplicationOverview {
  id: string;
  name: string;
  qualityScore: QualityScoreResult;
  automationCoverage: number;
  objectHealthPct: number | null;
  passRate: number;
  totalObjects: number;
  totalTestCases: number;
  lastScanAt: string | null;
}

export type KnowledgeFileType = 'PDF' | 'DOCX' | 'XLSX' | 'CSV' | 'TEXT' | 'MARKDOWN';
export type KnowledgeSourceStatus = 'PENDING' | 'PROCESSING' | 'PROCESSED' | 'FAILED';

export interface KnowledgeSummary {
  id: string;
  knowledgeSourceId: string;
  modules: string[] | null;
  validations: string[] | null;
  gaps: string[] | null;
  aiEnrichmentAvailable: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeChunk {
  id: string;
  chunkIndex: number;
  content: string;
  embeddingAvailable: boolean;
}

export interface KnowledgeSource {
  id: string;
  applicationId: string;
  fileName: string;
  fileType: KnowledgeFileType;
  status: KnowledgeSourceStatus;
  errorMessage: string | null;
  chunkCount: number;
  createdAt: string;
  updatedAt: string;
  summary?: KnowledgeSummary | null;
  chunks?: KnowledgeChunk[];
}

export type IntegrationType = 'ZEPHYR' | 'JIRA';
export type SyncStatus = 'RUNNING' | 'SUCCESS' | 'FAILED' | 'PARTIAL';

export interface IntegrationConfig {
  id: string;
  applicationId: string;
  type: IntegrationType;
  baseUrl: string;
  projectKey: string | null;
  keyVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface IntegrationSyncLog {
  id: string;
  integrationConfigId: string;
  direction: 'IMPORT' | 'EXPORT';
  status: SyncStatus;
  itemsProcessed: number;
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string | null;
}

// Internal, admin-only tooling — see JiraStoryImport's backend schema
// comment for why this is a separate, Codex-CLI-powered path, distinct
// from the customer-facing analyzeJiraStory() above.
export interface JiraStoryPrompt {
  id: string;
  jiraStoryImportId: string;
  stage: 'STORY_ANALYSIS' | 'TEST_CASE';
  label: string | null;
  systemPrompt: string;
  userPrompt: string;
  rawResponse: string | null;
  succeeded: boolean;
  createdAt: string;
}

export interface JiraStoryImport {
  id: string;
  applicationId: string;
  integrationConfigId: string;
  issueKey: string;
  storyUrl: string;
  rawContent: string;
  storyAnalysisJson: {
    acceptanceCriteria?: string[];
    impactedModules?: string[];
    riskAreas?: string[];
    changeType?: string;
    whatIsChanging?: string;
  } | null;
  status: 'FETCHED' | 'GENERATING' | 'COMPLETED' | 'FAILED';
  errorMessage: string | null;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
  prompts?: JiraStoryPrompt[];
}

// AI Engineering Organization (Phase 1) — bugs reported against TestPilot
// itself, not any application under test. Deliberately no applicationId.
export type AiTaskStatus =
  | 'PENDING'
  | 'PLANNING'
  | 'IN_PROGRESS'
  | 'WAITING_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'COMPLETED'
  | 'FAILED';

export type AiTaskArea = 'BACKEND' | 'FRONTEND' | 'NEEDS_HUMAN' | 'BOTH';

export type AiTaskSource = 'HUMAN_REPORT' | 'SCHEDULED_SCAN';

export interface AiTaskFileDiff {
  path: string;
  diff: string;
}

export interface AiTaskVerification {
  tsc: { passed: boolean; output: string };
  tests: { passed: boolean; output: string };
}

export interface AiEngineeringTask {
  id: string;
  title: string;
  description: string;
  reproSteps: string[] | null;
  severity: BugSeverity;
  status: AiTaskStatus;
  area: AiTaskArea | null;
  source: AiTaskSource;
  // One plain-English sentence for non-technical readers — null for tasks
  // created before this field existed; fall back to `title` in that case.
  friendlySummary: string | null;
  planSummary: string | null;
  specialistSummary: string | null;
  diffSummary: AiTaskFileDiff[] | null;
  verificationJson: AiTaskVerification | null;
  repairAttempts: number;
  touchesSchema: boolean;
  migrationSql: string | null;
  // Advisory only — a read-only AI pass over the full project checking for
  // impact elsewhere. Never blocks approval, shown alongside tsc/tests.
  aiReviewPassed: boolean | null;
  aiReviewSummary: string | null;
  // BOTH tasks only: the fields above are the BACKEND half, these are the
  // FRONTEND half.
  secondaryDiffSummary: AiTaskFileDiff[] | null;
  secondaryVerificationJson: AiTaskVerification | null;
  secondaryRepairAttempts: number;
  secondaryAiReviewPassed: boolean | null;
  secondaryAiReviewSummary: string | null;
  errorMessage: string | null;
  createdById: string | null;
  reviewedById: string | null;
  // True when Val's clean review + passing verification applied this change
  // with no human in the loop — reviewedById stays null in that case.
  autoApproved: boolean;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

// A lightweight Q&A channel with one AI Engineering persona — separate from
// the heavy Codex CLI pipeline above that actually authors/fixes task code.
export interface AiChatMessage {
  id: string;
  personaId: string;
  role: 'USER' | 'ASSISTANT';
  content: string;
  askedById: string | null;
  createdAt: string;
}

// The real, full jest (backend) or vitest (frontend) suite — run live on
// demand, not cached on a task row. Distinct from the Test Cycle, which only
// reflects AI Engineering pipeline verification runs.
export interface TestSuiteCaseResult {
  name: string;
  status: 'passed' | 'failed' | 'pending';
  durationMs: number | null;
}

export interface TestSuiteFileResult {
  file: string;
  status: 'passed' | 'failed';
  tests: TestSuiteCaseResult[];
}

export interface TestSuiteResult {
  ranAt: string;
  durationMs: number;
  numTotalTests: number;
  numPassedTests: number;
  numFailedTests: number;
  files: TestSuiteFileResult[];
}
