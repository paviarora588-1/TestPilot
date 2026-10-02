import { apiClient, API_BASE_URL } from './api-client';
import type {
  AiChatMessage,
  AiEngineeringTask,
  TestSuiteResult,
  Application,
  AutoHealSuggestion,
  AutomationFlow,
  AutomationFramework,
  BugReport,
  BugSeverity,
  DataRequirements,
  ExecutionRun,
  ExecutionSuiteRun,
  FailureTrendPoint,
  FleetApplicationOverview,
  QualityScoreResult,
  FlowBlockers,
  GeneratedScript,
  IntegrationConfig,
  IntegrationSyncLog,
  IntegrationType,
  JiraStoryImport,
  KnowledgeSource,
  ModuleCoverage,
  ObjectRepositoryItem,
  PaletteItem,
  ReportSummary,
  ScanSession,
  SuiteScope,
  TestCase,
  TestDataItem,
  TestDataSet,
  WebRecordingSession,
  WebRecordingStep,
} from './types';

export const ASSET_BASE_URL = API_BASE_URL.replace(/\/api$/, '');

export function assetUrl(path: string | null | undefined) {
  if (!path) return null;
  return `${ASSET_BASE_URL}${path}`;
}

// Applications
export const listApplications = async () => (await apiClient.get<Application[]>('/applications')).data;
export const getApplication = async (id: string) => (await apiClient.get<Application>(`/applications/${id}`)).data;
export const createApplication = async (data: Partial<Application>) =>
  (await apiClient.post<Application>('/applications', data)).data;
export const updateApplication = async (id: string, data: Partial<Application>) =>
  (await apiClient.put<Application>(`/applications/${id}`, data)).data;
export const deleteApplication = async (id: string) => (await apiClient.delete(`/applications/${id}`)).data;

// Scanner
export const startScan = async (
  applicationId: string,
  targetUrl: string,
  loginUsername?: string,
  loginPassword?: string,
) =>
  (
    await apiClient.post<ScanSession>(`/applications/${applicationId}/scans`, {
      targetUrl,
      loginUsername: loginUsername || undefined,
      loginPassword: loginPassword || undefined,
    })
  ).data;
export const startSapGuiScan = async (applicationId: string, connectionIndex?: number, sessionIndex?: number) =>
  (await apiClient.post<ScanSession>(`/applications/${applicationId}/sap-scans`, { connectionIndex, sessionIndex })).data;
export interface SapGuiOpenSession {
  connectionIndex: number;
  sessionIndex: number;
  connectionDescription: string;
  systemName: string;
  client: string;
  user: string;
  transaction: string;
  title: string;
}
export const listSapGuiSessions = async () => (await apiClient.get<SapGuiOpenSession[]>('/sap-sessions')).data;
export const startCurrentPageScan = async (applicationId: string, cdpUrl?: string, pageIndex?: number) =>
  (await apiClient.post<ScanSession>(`/applications/${applicationId}/current-page-scans`, { cdpUrl, pageIndex })).data;
export const launchCaptureBrowser = async (port?: number) =>
  (await apiClient.post<{ cdpUrl: string }>('/current-page-scans/launch-browser', { port })).data;
export interface OpenTab {
  index: number;
  url: string;
  title: string;
}
export const listOpenTabs = async (cdpUrl?: string) =>
  (await apiClient.get<OpenTab[]>('/current-page-scans/tabs', { params: { cdpUrl } })).data;
export const listScanSessions = async (applicationId: string) =>
  (await apiClient.get<ScanSession[]>(`/applications/${applicationId}/scans`)).data;
export const getScanSession = async (id: string) => (await apiClient.get<ScanSession>(`/scans/${id}`)).data;

// Custom words layered onto extractDrillTargets' own built-in safety
// denylist (see dom-walker.ts) — lets a human extend it for an app whose
// own dangerous-action vocabulary the built-in guess couldn't have known
// about in advance.
export interface ScanUnsafeClickWord {
  id: string;
  applicationId: string;
  word: string;
  createdById: string | null;
  createdAt: string;
}
export const listUnsafeClickWords = async (applicationId: string) =>
  (await apiClient.get<ScanUnsafeClickWord[]>(`/applications/${applicationId}/scan-unsafe-words`)).data;
export const addUnsafeClickWord = async (applicationId: string, word: string) =>
  (await apiClient.post<ScanUnsafeClickWord>(`/applications/${applicationId}/scan-unsafe-words`, { word })).data;
export const removeUnsafeClickWord = async (id: string) =>
  (await apiClient.delete(`/scan-unsafe-words/${id}`)).data;

// Web Action Recorder
export const startRecording = async (applicationId: string, targetUrl: string, framework?: AutomationFramework) =>
  (await apiClient.post<WebRecordingSession>(`/applications/${applicationId}/recording-sessions`, { targetUrl, framework })).data;
export const listRecordingSessions = async (applicationId: string) =>
  (await apiClient.get<WebRecordingSession[]>(`/applications/${applicationId}/recording-sessions`)).data;
export const getRecordingSession = async (id: string) =>
  (await apiClient.get<WebRecordingSession>(`/recording-sessions/${id}`)).data;
export const pauseRecording = async (id: string) =>
  (await apiClient.post<WebRecordingSession>(`/recording-sessions/${id}/pause`)).data;
export const resumeRecording = async (id: string) =>
  (await apiClient.post<WebRecordingSession>(`/recording-sessions/${id}/resume`)).data;
export const stopRecording = async (id: string) =>
  (await apiClient.post<WebRecordingSession>(`/recording-sessions/${id}/stop`)).data;
export const cancelRecording = async (id: string) =>
  (await apiClient.post<WebRecordingSession>(`/recording-sessions/${id}/cancel`)).data;
export const updateRecordingStep = async (
  sessionId: string,
  stepId: string,
  data: Partial<Pick<WebRecordingStep, 'label' | 'isVariable' | 'variableName' | 'isSensitive'>>,
) => (await apiClient.put<WebRecordingStep>(`/recording-sessions/${sessionId}/steps/${stepId}`, data)).data;
export const deleteRecordingStep = async (sessionId: string, stepId: string) =>
  (await apiClient.delete(`/recording-sessions/${sessionId}/steps/${stepId}`)).data;
export const reorderRecordingSteps = async (sessionId: string, orderedStepIds: string[]) =>
  (await apiClient.put(`/recording-sessions/${sessionId}/steps/reorder`, { orderedStepIds })).data;
export const convertRecording = async (sessionId: string, flowName?: string) =>
  (await apiClient.post<AutomationFlow>(`/recording-sessions/${sessionId}/convert`, { flowName })).data;
export const deleteRecordingSession = async (id: string) =>
  (await apiClient.delete(`/recording-sessions/${id}`)).data;
export const deleteScanSession = async (id: string) => (await apiClient.delete(`/scans/${id}`)).data;

// Object Library
export const listObjectLibrary = async (applicationId: string) =>
  (await apiClient.get<ObjectRepositoryItem[]>(`/applications/${applicationId}/object-library`)).data;
export const updateObject = async (id: string, data: Partial<ObjectRepositoryItem>) =>
  (await apiClient.put<ObjectRepositoryItem>(`/object-library/${id}`, data)).data;
export const deleteObject = async (id: string) => (await apiClient.delete(`/object-library/${id}`)).data;
export const promoteScanObject = async (
  scanObjectId: string,
  data: { objectName: string; moduleName?: string; featureName?: string; screenName?: string; displayLabel?: string },
) => (await apiClient.post<ObjectRepositoryItem>(`/scan-objects/${scanObjectId}/promote`, data)).data;
export const promoteAllScanObjects = async (scanPageId: string) =>
  (await apiClient.post<{ promoted: number; objects: ObjectRepositoryItem[] }>(`/scan-pages/${scanPageId}/promote-all`)).data;
// For the Scanner page's synthetic "Common (shared across pages)" tab,
// which has no real scan page id to promote-all against.
export const promoteManyScanObjects = async (scanObjectIds: string[]) =>
  (await apiClient.post<{ promoted: number; objects: ObjectRepositoryItem[] }>(`/scan-objects/promote-many`, { scanObjectIds })).data;
export const createObject = async (
  applicationId: string,
  data: {
    objectName: string;
    moduleName?: string;
    featureName?: string;
    screenName?: string;
    objectType: string;
    technicalPath: string;
    locatorStrategy: string;
  },
) => (await apiClient.post<ObjectRepositoryItem>(`/applications/${applicationId}/object-library`, data)).data;

// Test Cases
export const listTestCases = async (applicationId: string) =>
  (await apiClient.get<TestCase[]>(`/applications/${applicationId}/test-cases`)).data;
export const getTestCase = async (id: string) => (await apiClient.get<TestCase>(`/test-cases/${id}`)).data;
export const createTestCase = async (
  applicationId: string,
  data: {
    title: string;
    moduleName?: string;
    featureName?: string;
    priority?: string;
    expectedResult?: string;
    steps?: { instruction: string; expectedResult?: string }[];
  },
) => (await apiClient.post<TestCase>(`/applications/${applicationId}/test-cases`, data)).data;
export const updateTestCase = async (
  id: string,
  data: {
    title?: string;
    moduleName?: string;
    featureName?: string;
    priority?: string;
    expectedResult?: string;
    steps?: { instruction: string; expectedResult?: string }[];
  },
) => (await apiClient.put<TestCase>(`/test-cases/${id}`, data)).data;
export const importTestCases = async (applicationId: string, file: File) => {
  const form = new FormData();
  form.append('file', file);
  return (await apiClient.post(`/applications/${applicationId}/test-cases/import`, form)).data;
};
export const analyzeTestCase = async (id: string) => (await apiClient.post<TestCase>(`/test-cases/${id}/analyze`)).data;
export const getDataRequirements = async (id: string) =>
  (await apiClient.get<DataRequirements>(`/test-cases/${id}/data-requirements`)).data;
export const saveDataRequirements = async (id: string, values: { objectId: string; value: string }[]) =>
  (await apiClient.post<{ saved: number; testDataSetId: string }>(`/test-cases/${id}/data-requirements`, { values })).data;
export const getRegressionRecommendation = async (id: string) =>
  (
    await apiClient.get<{
      testCaseId: string;
      recommended: {
        testCaseId: string;
        title: string;
        moduleName: string | null;
        priority: string;
        sharedObjects: number;
        riskLevel: string;
        reason: string;
      }[];
    }>(`/test-cases/${id}/regression-recommendation`)
  ).data;
export const deleteTestCase = async (id: string) => (await apiClient.delete(`/test-cases/${id}`)).data;
export const generateTestCasesWithAi = async (
  applicationId: string,
  data: { count?: number; focus?: string; autoGenerateFlows?: boolean },
) =>
  (
    await apiClient.post<{ created: number; testCases: (TestCase & { flowGenerated?: boolean; flowError?: string })[] }>(
      `/applications/${applicationId}/test-cases/generate-with-ai`,
      data,
    )
  ).data;

export interface TestCaseGenerationJob {
  id: string;
  applicationId: string;
  status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  totalCount: number;
  completedCount: number;
  currentStep: string | null;
  errorMessage: string | null;
  resultJson:
    | { created: number; testCases: (TestCase & { flowGenerated?: boolean; flowError?: string })[] }
    | { created: number; testCaseIds: string[]; titles: string[]; automationSummary: AutoAutomateResult | null }
    | null;
}

export const startTestCaseGenerationJob = async (
  applicationId: string,
  data: { count?: number; focus?: string; autoGenerateFlows?: boolean },
) =>
  (
    await apiClient.post<TestCaseGenerationJob>(`/applications/${applicationId}/test-cases/generate-with-ai-job`, data)
  ).data;

export const getTestCaseGenerationJob = async (jobId: string) =>
  (await apiClient.get<TestCaseGenerationJob>(`/test-case-generation-jobs/${jobId}`)).data;

export const cancelTestCaseGenerationJob = async (jobId: string) =>
  (await apiClient.post<TestCaseGenerationJob>(`/test-case-generation-jobs/${jobId}/cancel`)).data;

// Internal/admin-only Codex-powered generation — every source below is
// independently optional; the backend requires at least one of them (or
// userPrompt) to actually resolve to something.
export interface GenerateWithCodexRequest {
  count?: number;
  userPrompt?: string;
  jiraStoryImportId?: string;
  includeKnowledgeBase?: boolean;
  includeZephyr?: boolean;
  chainAutomation?: boolean;
}

export const startCodexTestCaseGenerationJob = async (applicationId: string, data: GenerateWithCodexRequest) =>
  (
    await apiClient.post<TestCaseGenerationJob>(`/applications/${applicationId}/test-cases/generate-with-codex-job`, data)
  ).data;

export interface CodexGenerationPrompt {
  id: string;
  testCaseGenerationJobId: string;
  stage: string;
  label: string | null;
  systemPrompt: string;
  userPrompt: string;
  rawResponse: string | null;
  succeeded: boolean;
  createdAt: string;
}

export const getCodexGenerationPrompts = async (jobId: string) =>
  (await apiClient.get<CodexGenerationPrompt[]>(`/test-case-generation-jobs/${jobId}/codex-prompts`)).data;

// Test Data
export const listTestDataSets = async (applicationId: string) =>
  (await apiClient.get<TestDataSet[]>(`/applications/${applicationId}/test-data-sets`)).data;
export const getTestDataSet = async (id: string) => (await apiClient.get<TestDataSet>(`/test-data-sets/${id}`)).data;
export const createTestDataSet = async (
  applicationId: string,
  data: { name: string; environment?: string; description?: string },
) => (await apiClient.post<TestDataSet>(`/applications/${applicationId}/test-data-sets`, data)).data;
export const deleteTestDataSet = async (id: string) => (await apiClient.delete(`/test-data-sets/${id}`)).data;
export const generateTestDataSetWithAi = async (
  applicationId: string,
  data: { name?: string; testCaseId?: string; environment?: string; focus?: string; count?: number },
) => (await apiClient.post<TestDataSet>(`/applications/${applicationId}/test-data-sets/generate-with-ai`, data)).data;
export const generateTestDataSetWithCodex = async (
  applicationId: string,
  data: { name?: string; testCaseId?: string; environment?: string; focus?: string; count?: number },
) => (await apiClient.post<TestDataSet>(`/applications/${applicationId}/test-data-sets/generate-with-codex`, data)).data;
export const createTestDataItem = async (
  setId: string,
  data: { key: string; value: string; isSensitive?: boolean },
) => (await apiClient.post<TestDataItem>(`/test-data-sets/${setId}/items`, data)).data;
export const updateTestDataItem = async (id: string, data: Partial<TestDataItem>) =>
  (await apiClient.put<TestDataItem>(`/test-data-items/${id}`, data)).data;
export const deleteTestDataItem = async (id: string) => (await apiClient.delete(`/test-data-items/${id}`)).data;
export const resolveTestDataItem = async (id: string) =>
  (await apiClient.get<TestDataItem & { resolvedValue: string }>(`/test-data-items/${id}/resolve`)).data;
export const importTestDataItems = async (setId: string, file: File) => {
  const form = new FormData();
  form.append('file', file);
  return (await apiClient.post(`/test-data-sets/${setId}/items/import`, form)).data;
};
export const getSupportedPlaceholders = async () =>
  (await apiClient.get<string[]>('/placeholder-tokens')).data;

// Automation Builder
export const getPalette = async () => (await apiClient.get<PaletteItem[]>('/automation-builder/palette')).data;
export const listAutomationFlows = async (applicationId: string) =>
  (await apiClient.get<AutomationFlow[]>(`/applications/${applicationId}/automation-flows`)).data;
export const getAutomationFlow = async (id: string) =>
  (await apiClient.get<AutomationFlow>(`/automation-flows/${id}`)).data;
export const createAutomationFlow = async (
  applicationId: string,
  data: { name: string; description?: string; testCaseId?: string; framework?: AutomationFramework },
) => (await apiClient.post<AutomationFlow>(`/applications/${applicationId}/automation-flows`, data)).data;
// unmatchedReferences: quoted UI labels found in the test case's own text
// that didn't match anything in the Object Library — most often because the
// screen they're on was never reached by a scan, surfaced here instead of
// silently leaving the corresponding step unbound.
export type AutomationFlowWithGaps = AutomationFlow & { unmatchedReferences?: string[] };

export const generateFlowFromTestCase = async (applicationId: string, testCaseId: string) =>
  (await apiClient.post<AutomationFlowWithGaps>(`/applications/${applicationId}/automation-flows/generate-from-test-case`, { testCaseId }))
    .data;
export const generateFlowFromTestCaseWithCodex = async (applicationId: string, testCaseId: string) =>
  (
    await apiClient.post<AutomationFlowWithGaps>(
      `/applications/${applicationId}/automation-flows/generate-from-test-case-with-codex`,
      { testCaseId },
    )
  ).data;
export const updateFlowGraph = async (id: string, graphJson: Record<string, unknown>) =>
  (await apiClient.put<AutomationFlow>(`/automation-flows/${id}/graph`, { graphJson })).data;
export const validateFlow = async (id: string) =>
  (await apiClient.get<FlowBlockers>(`/automation-flows/${id}/validate`)).data;
export const deleteAutomationFlow = async (id: string) => (await apiClient.delete(`/automation-flows/${id}`)).data;

// Script Generator
export const generateScript = async (flowId: string) =>
  (await apiClient.post<GeneratedScript>(`/automation-flows/${flowId}/generate-script`)).data;
export const generateScriptWithCodex = async (flowId: string) =>
  (await apiClient.post<GeneratedScript>(`/automation-flows/${flowId}/generate-script-with-codex`)).data;
export const listScriptsForFlow = async (flowId: string) =>
  (await apiClient.get<GeneratedScript[]>(`/automation-flows/${flowId}/scripts`)).data;
export const getScript = async (id: string) => (await apiClient.get<GeneratedScript>(`/scripts/${id}`)).data;
export const reviewScript = async (id: string) => (await apiClient.post<GeneratedScript>(`/scripts/${id}/review`)).data;

// Execution
export const executeScript = async (scriptId: string) =>
  (await apiClient.post<ExecutionRun>(`/scripts/${scriptId}/execute`)).data;
export const validateScript = async (scriptId: string) =>
  (await apiClient.post<ExecutionRun>(`/scripts/${scriptId}/validate`)).data;
export const retryExecution = async (id: string) => (await apiClient.post<ExecutionRun>(`/executions/${id}/run`)).data;
export const getExecution = async (id: string) => (await apiClient.get<ExecutionRun>(`/executions/${id}`)).data;
export const deleteExecution = async (id: string) => (await apiClient.delete(`/executions/${id}`)).data;
export const listExecutions = async (applicationId: string) =>
  (await apiClient.get<ExecutionRun[]>(`/applications/${applicationId}/executions`)).data;
export const runSuite = async (applicationId: string, scope: SuiteScope, scriptIds: string[]) =>
  (await apiClient.post<ExecutionSuiteRun>(`/applications/${applicationId}/execution-suites`, { scope, scriptIds })).data;
export const listSuites = async (applicationId: string) =>
  (await apiClient.get<ExecutionSuiteRun[]>(`/applications/${applicationId}/execution-suites`)).data;
export const getSuite = async (id: string) => (await apiClient.get<ExecutionSuiteRun>(`/execution-suites/${id}`)).data;
export const listAutoHealSuggestions = async (applicationId: string) =>
  (await apiClient.get<AutoHealSuggestion[]>(`/applications/${applicationId}/auto-heal`)).data;
export const approveAutoHeal = async (id: string) =>
  (await apiClient.post<AutoHealSuggestion>(`/auto-heal/${id}/approve`)).data;

// Pipeline — chains flow generation, script generation, and execution for a
// batch of test cases in one call (Test Cases page "Automate Selected").
export interface AutoAutomateResult {
  results: {
    testCaseId: string;
    testCaseTitle: string;
    status: 'EXECUTED' | 'SCRIPT_GENERATED' | 'FLOW_GENERATED' | 'BLOCKED';
    reasons: string[];
    flowId?: string;
    scriptId?: string;
  }[];
  suiteRunId: string | null;
  summary: { total: number; executing: number; blocked: number };
}
export const autoAutomate = async (applicationId: string, testCaseIds: string[], engine?: 'LOCAL' | 'CODEX') =>
  (await apiClient.post<AutoAutomateResult>(`/applications/${applicationId}/auto-automate`, { testCaseIds, engine })).data;

export interface AutoAutomateJob {
  id: string;
  applicationId: string;
  status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  totalCount: number;
  completedCount: number;
  currentStep: string | null;
  errorMessage: string | null;
  resultJson: AutoAutomateResult | null;
}

// Job-based version — returns immediately and keeps running server-side
// regardless of whether the page that started it is still open; poll via
// getAutoAutomateJob(jobId) instead of awaiting one long request.
export const startAutoAutomateJob = async (applicationId: string, testCaseIds: string[], engine?: 'LOCAL' | 'CODEX') =>
  (
    await apiClient.post<AutoAutomateJob>(`/applications/${applicationId}/auto-automate-job`, { testCaseIds, engine })
  ).data;

export const getAutoAutomateJob = async (jobId: string) =>
  (await apiClient.get<AutoAutomateJob>(`/auto-automate-jobs/${jobId}`)).data;

// Bug Reports
export const listBugReports = async (applicationId: string) =>
  (await apiClient.get<BugReport[]>(`/applications/${applicationId}/bug-reports`)).data;
export const getBugReport = async (id: string) => (await apiClient.get<BugReport>(`/bug-reports/${id}`)).data;
export const generateBugReport = async (executionId: string) =>
  (await apiClient.post<BugReport>(`/executions/${executionId}/generate-bug-report`)).data;
export const updateBugReport = async (
  id: string,
  data: Partial<Pick<BugReport, 'title' | 'stepsToReproduce' | 'actualResult' | 'expectedResult' | 'severity' | 'priority' | 'environment'>>,
) => (await apiClient.put<BugReport>(`/bug-reports/${id}`, data)).data;
export const submitBugReport = async (id: string) => (await apiClient.post<BugReport>(`/bug-reports/${id}/submit`)).data;
export const deleteBugReport = async (id: string) => (await apiClient.delete(`/bug-reports/${id}`)).data;
export const rejectAutoHeal = async (id: string) =>
  (await apiClient.post<AutoHealSuggestion>(`/auto-heal/${id}/reject`)).data;

// Reporting
export const getReportSummary = async (applicationId: string) =>
  (await apiClient.get<ReportSummary>(`/applications/${applicationId}/reports/summary`)).data;
export const getModuleCoverage = async (applicationId: string) =>
  (await apiClient.get<ModuleCoverage[]>(`/applications/${applicationId}/reports/coverage`)).data;
export const getFailureTrends = async (applicationId: string) =>
  (await apiClient.get<FailureTrendPoint[]>(`/applications/${applicationId}/reports/trends`)).data;

export interface FailureBreakdown {
  firstAttemptTotal: number;
  firstAttemptPassed: number;
  firstAttemptPassRate: number;
  byCategory: { category: string; firstAttempt: number; retried: number; total: number }[];
}
export const getFailureBreakdown = async (applicationId: string) =>
  (await apiClient.get<FailureBreakdown>(`/applications/${applicationId}/reports/failure-breakdown`)).data;
export const getQualityScore = async (applicationId: string) =>
  (await apiClient.get<QualityScoreResult>(`/applications/${applicationId}/reports/quality-score`)).data;

// Fleet — portfolio view across every application, not scoped to one.
export const listFleetOverview = async () =>
  (await apiClient.get<FleetApplicationOverview[]>('/applications/fleet-overview')).data;

export async function downloadFleetCsv() {
  const res = await apiClient.get('/applications/fleet-overview/export.csv', { responseType: 'blob' });
  const blob = new Blob([res.data], { type: 'text/csv' });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'testpilot-fleet-report.csv';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

const EXPORT_MIME: Record<'csv' | 'xlsx' | 'pdf', string> = {
  csv: 'text/csv',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
};

// The export routes require the JWT auth header, so a plain <a href> download
// won't work — fetch as a blob (auth attached by the apiClient interceptor)
// and trigger the save client-side instead.
export async function downloadReport(applicationId: string, format: 'csv' | 'xlsx' | 'pdf') {
  const res = await apiClient.get(`/applications/${applicationId}/reports/export.${format}`, {
    responseType: 'blob',
  });
  const blob = new Blob([res.data], { type: EXPORT_MIME[format] });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `testpilot-report.${format}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

// Knowledge Base
export const listKnowledgeSources = async (applicationId: string) =>
  (await apiClient.get<KnowledgeSource[]>(`/applications/${applicationId}/knowledge-sources`)).data;
export const getKnowledgeSource = async (id: string) =>
  (await apiClient.get<KnowledgeSource>(`/knowledge-sources/${id}`)).data;
export const uploadKnowledgeSource = async (applicationId: string, file: File) => {
  const form = new FormData();
  form.append('file', file);
  return (await apiClient.post<KnowledgeSource>(`/applications/${applicationId}/knowledge-sources`, form)).data;
};
export const deleteKnowledgeSource = async (id: string) => (await apiClient.delete(`/knowledge-sources/${id}`)).data;

// Integrations
export const listIntegrations = async (applicationId: string) =>
  (await apiClient.get<IntegrationConfig[]>(`/applications/${applicationId}/integrations`)).data;
export const createIntegration = async (
  applicationId: string,
  data: { type: IntegrationType; baseUrl: string; projectKey?: string; apiToken: string; email?: string },
) => (await apiClient.post<IntegrationConfig>(`/applications/${applicationId}/integrations`, data)).data;
export const deleteIntegration = async (id: string) => (await apiClient.delete(`/integrations/${id}`)).data;
export const syncIntegration = async (id: string) =>
  (await apiClient.post<IntegrationSyncLog>(`/integrations/${id}/sync`)).data;
export const listIntegrationSyncLogs = async (id: string) =>
  (await apiClient.get<IntegrationSyncLog[]>(`/integrations/${id}/sync-logs`)).data;
export const analyzeJiraStory = async (configId: string, data: { issueKey: string; count?: number }) =>
  (
    await apiClient.post<{
      issue: {
        key: string;
        summary: string;
        description: string;
        acceptanceCriteria: string | null;
        labels: string[];
        components: string[];
        priority: string | null;
        status: string | null;
        epicKey: string | null;
        linkedIssues: { key: string; relationship: string; summary?: string }[];
      };
      storyAnalysis: {
        acceptanceCriteria?: string[];
        impactedModules?: string[];
        riskAreas?: string[];
        changeType?: 'NEW_FEATURE' | 'ENHANCEMENT' | 'DEFECT_FIX' | 'CONFIGURATION';
        whatIsChanging?: string;
      };
      contextGathered: { commentsAnalyzed: number; attachmentsAnalyzed: number };
      created: number;
      testCases: TestCase[];
    }>(`/integrations/${configId}/analyze-story`, data)
  ).data;

// Jira Codex Import — internal, admin-only tooling (see JiraStoryImport's
// backend schema comment). Kept as its own section, not folded into the
// Integrations functions above, for the same reason it's a separate backend
// module: this is the Codex-CLI-powered path, deliberately distinct from
// the customer-facing analyzeJiraStory() above.
export const listJiraStoryImports = async (applicationId: string) =>
  (await apiClient.get<JiraStoryImport[]>(`/applications/${applicationId}/jira-story-imports`)).data;
export const getJiraStoryImport = async (id: string) =>
  (await apiClient.get<JiraStoryImport>(`/jira-story-imports/${id}`)).data;
export const createJiraStoryImport = async (applicationId: string, data: { integrationConfigId: string; storyUrlOrKey: string }) =>
  (await apiClient.post<JiraStoryImport>(`/applications/${applicationId}/jira-story-imports`, data)).data;
export const generateJiraStoryTestCases = async (id: string) =>
  (await apiClient.post<JiraStoryImport>(`/jira-story-imports/${id}/generate-test-cases`)).data;

export interface AutomationPolicy {
  id: string | null;
  applicationId: string | null;
  minimumMappingConfidence: number;
  maximumAllowedRiskScore: number;
  requireAiReviewPass: boolean;
  requireKnowledgeProcessed: boolean;
  requireObjectVerification: boolean;
  qualityWatchEnabled: boolean;
  qualityWatchLastRunAt: string | null;
  qualityWatchMaxObjectsPerRun: number;
}

export const getAutomationPolicy = async (applicationId: string) =>
  (await apiClient.get<AutomationPolicy>(`/applications/${applicationId}/automation-policy`)).data;

export const updateAutomationPolicy = async (applicationId: string, patch: Partial<AutomationPolicy>) =>
  (await apiClient.put<AutomationPolicy>(`/applications/${applicationId}/automation-policy`, patch)).data;

// On-demand quality watch — same live re-verification as the nightly
// schedule, run right now instead of waiting for it.
export const runQualityWatchNow = async (applicationId: string) =>
  (await apiClient.post<{ checked: number }>(`/applications/${applicationId}/quality-watch/run-now`)).data;

// AI Engineering Organization — not per-application, this is about
// TestPilot itself.
export const createAiTask = async (data: {
  title: string;
  description: string;
  reproSteps?: string[];
  severity?: BugSeverity;
}) => (await apiClient.post<AiEngineeringTask>('/ai-engineering/tasks', data)).data;
export const listAiTasks = async () => (await apiClient.get<AiEngineeringTask[]>('/ai-engineering/tasks')).data;
export const getAiTask = async (id: string) => (await apiClient.get<AiEngineeringTask>(`/ai-engineering/tasks/${id}`)).data;
export const approveAiTask = async (id: string) =>
  (await apiClient.post<{ appliedFiles: string[]; skippedFiles: string[] }>(`/ai-engineering/tasks/${id}/approve`)).data;
export const rejectAiTask = async (id: string) =>
  (await apiClient.post<{ success: boolean }>(`/ai-engineering/tasks/${id}/reject`)).data;
export const retryAiTask = async (id: string) =>
  (await apiClient.post<AiEngineeringTask>(`/ai-engineering/tasks/${id}/retry`)).data;

// Chat with the team — a lightweight Q&A channel, separate from the task
// pipeline above.
export const listChatMessages = async (personaId: string) =>
  (await apiClient.get<AiChatMessage[]>(`/ai-engineering/chat/${personaId}`)).data;
export const sendChatMessage = async (personaId: string, content: string) =>
  (await apiClient.post<AiChatMessage>(`/ai-engineering/chat/${personaId}`, { content })).data;

// Runs the real, full jest/vitest suite live (not cached) — distinct from
// the Test Cycle, which only reflects AI Engineering pipeline task runs.
export const getBackendTestSuite = async () =>
  (await apiClient.get<TestSuiteResult>('/ai-engineering/test-suite')).data;
export const getFrontendTestSuite = async () =>
  (await apiClient.get<TestSuiteResult>('/ai-engineering/test-suite/frontend')).data;
// Real browser E2E — genuinely takes minutes (real AI calls, real browser
// automation), not seconds. No client-side timeout override needed: axios
// has none configured by default in this app.
export const getE2ETestSuite = async () =>
  (await apiClient.get<TestSuiteResult>('/ai-engineering/test-suite/e2e')).data;
