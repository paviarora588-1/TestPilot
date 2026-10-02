import axios from 'axios';
import type { AutoHealSuggestion, ExecutionRun, GeneratedScript, HistoryEvent, KnowledgeSource, KnowledgeSummary, MappingRow, Product, RepositoryObject, TestCase } from '../types';

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api',
  headers: import.meta.env.VITE_API_KEY ? { 'X-API-Key': import.meta.env.VITE_API_KEY } : undefined
});

export function errorMessage(error: unknown) {
  if (axios.isAxiosError(error)) {
    if (!error.response) {
      return 'Backend is not reachable. Please start FastAPI server.';
    }
    const detail = error.response?.data?.detail;
    if (typeof detail === 'string') {
      if (detail.toLowerCase().includes('quota') || detail.toLowerCase().includes('rate limit')) {
        return 'AI quota is temporarily exhausted. The saved review remains available; retry after the provider quota resets.';
      }
      return detail;
    }
    if (detail && typeof detail === 'object') {
      const payload = detail as { blocked?: boolean; reasons?: unknown; next_actions?: unknown };
      const reasons = Array.isArray(payload.reasons) ? payload.reasons.map(String) : [];
      const nextActions = Array.isArray(payload.next_actions) ? payload.next_actions.map(String) : [];
      if (payload.blocked || reasons.length) {
        return `${reasons.length ? `Blocked: ${reasons.join('; ')}` : 'Request blocked.'}${nextActions.length ? ` Next: ${nextActions.join('; ')}` : ''}`;
      }
      return 'The backend rejected this request. Review the selected item and try again.';
    }
    return error.message;
  }
  return error instanceof Error ? error.message : 'Unexpected error';
}

export async function healthCheck() {
  const response = await api.get('/health');
  return response.data;
}

export async function listProducts(): Promise<Product[]> {
  const response = await api.get('/products');
  return response.data;
}

export async function createProduct(payload: Partial<Product>) {
  const response = await api.post('/products', payload);
  return response.data;
}

export async function updateProduct(productId: number, payload: Partial<Product>) {
  const response = await api.put(`/products/${productId}`, payload);
  return response.data;
}

export async function deleteProduct(productId: number) {
  const response = await api.delete(`/products/${productId}`);
  return response.data;
}

export async function getGlobalSummary() {
  const response = await api.get('/reports/global-summary');
  return response.data;
}

export async function getProductReport(productId: number) {
  const response = await api.get(`/products/${productId}/reports/summary`);
  return response.data;
}

export async function getCoverage(productId: number) {
  const response = await api.get(`/products/${productId}/reports/coverage`);
  return response.data;
}

export async function getCoverageGaps(productId: number) {
  const response = await api.get(`/products/${productId}/coverage/gaps`);
  return response.data;
}

export async function getRegressionImpact(productId: number) {
  const response = await api.get(`/products/${productId}/regression/impact`);
  return response.data;
}

export async function listApprovals(productId: number) {
  const response = await api.get(`/products/${productId}/approvals`);
  return response.data;
}

export async function listKnowledgeSources(productId: number): Promise<KnowledgeSource[]> {
  const response = await api.get(`/products/${productId}/knowledge-sources`);
  return response.data;
}

export async function uploadKnowledgeSource(productId: number, file: File, sourceType = 'User Guide') {
  const form = new FormData();
  form.append('file', file);
  form.append('source_type', sourceType);
  const response = await api.post(`/products/${productId}/knowledge-sources/upload`, form);
  return response.data;
}

export async function createTextKnowledgeSource(productId: number, name: string, content: string, sourceType = 'User Guide') {
  const response = await api.post(`/products/${productId}/knowledge-sources`, { name, content, source_type: sourceType });
  return response.data;
}

export async function processKnowledge(sourceId: number): Promise<KnowledgeSummary> {
  const response = await api.post(`/knowledge/${sourceId}/process`);
  return response.data;
}

export async function getKnowledgeSummary(productId: number): Promise<KnowledgeSummary> {
  const response = await api.get(`/products/${productId}/knowledge-summary`);
  return response.data;
}

export async function listKnowledgeChunks(productId: number) {
  const response = await api.get(`/products/${productId}/knowledge-chunks`);
  return response.data;
}

export async function listObjects(productId: number): Promise<RepositoryObject[]> {
  const response = await api.get(`/products/${productId}/objects`);
  return response.data;
}

export async function downloadSapGuiCrawlerScript(productId: number, targetCode = '') {
  const response = await api.get(`/products/${productId}/sap-gui/crawler-script-v2`, {
    params: targetCode.trim() ? { target_code: targetCode.trim() } : {},
    responseType: 'blob'
  });
  const url = window.URL.createObjectURL(response.data);
  const link = document.createElement('a');
  link.href = url;
  const safeTarget = targetCode.trim().replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '');
  link.download = safeTarget ? `testpilot-sap-gui-advanced-crawler-${safeTarget}.vbs` : 'testpilot-sap-gui-advanced-crawler.vbs';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

export async function getSapGuiDiscoveryPlan(productId: number) {
  const response = await api.get(`/products/${productId}/sap-gui/discovery-plan`);
  return response.data;
}

export async function importSapGuiCrawlerOutput(productId: number, file: File) {
  const form = new FormData();
  form.append('file', file);
  const response = await api.post(`/products/${productId}/sap-gui/crawler-import`, form);
  return response.data;
}

export async function createObject(productId: number, payload: Record<string, unknown>) {
  const response = await api.post(`/products/${productId}/objects`, payload);
  return response.data;
}

export async function updateObject(objectId: number, payload: Record<string, unknown>) {
  const response = await api.put(`/objects/${objectId}`, payload);
  return response.data;
}

export async function deleteObject(objectId: number) {
  const response = await api.delete(`/objects/${objectId}`);
  return response.data;
}

export async function verifyObject(objectId: number) {
  const response = await api.post(`/objects/${objectId}/verify`);
  return response.data;
}

export async function listTestCases(productId: number): Promise<TestCase[]> {
  const response = await api.get(`/products/${productId}/test-cases`);
  return response.data;
}

export async function listTestCaseQuality(productId: number) {
  const response = await api.get(`/products/${productId}/quality/test-cases`);
  return response.data;
}

export async function getTestCaseQuality(testCaseId: number) {
  const response = await api.get(`/test-cases/${testCaseId}/quality`);
  return response.data;
}

export async function createTestCase(productId: number, payload: Omit<Partial<TestCase>, 'steps'> & { steps?: string | string[] }) {
  const response = await api.post(`/products/${productId}/test-cases`, payload);
  return response.data;
}

export async function updateTestCase(testCaseId: number, payload: Omit<Partial<TestCase>, 'steps'> & { steps?: string | string[] }) {
  const response = await api.put(`/test-cases/${testCaseId}`, payload);
  return response.data;
}

export async function deleteTestCase(testCaseId: number) {
  const response = await api.delete(`/test-cases/${testCaseId}`);
  return response.data;
}

export async function importTestCases(productId: number, file: File) {
  const form = new FormData();
  form.append('file', file);
  const response = await api.post(`/products/${productId}/test-cases/import`, form);
  return response.data;
}

export async function downloadTestCaseImportTemplate() {
  const response = await api.get('/test-cases/import-template', { responseType: 'blob' });
  const url = window.URL.createObjectURL(response.data);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'testpilot-test-case-import-template.xlsx';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

export async function generateTestCaseSuite(productId: number, count = 8) {
  const response = await api.post(`/products/${productId}/test-cases/ai-generate`, { count });
  return response.data;
}

export async function generateTestCaseFromScreenshot(productId: number, image: File, prompt: string) {
  const form = new FormData();
  form.append('image', image);
  form.append('prompt', prompt);
  const response = await api.post(`/products/${productId}/test-cases/from-screenshot`, form);
  return response.data;
}

export async function analyzeTestCase(testCaseId: number) {
  const response = await api.post(`/test-cases/${testCaseId}/analyze`);
  return response.data;
}

export async function mapTestSteps(testCaseId: number) {
  const response = await api.post(`/test-cases/${testCaseId}/map-steps`);
  return response.data;
}

export async function listMappings(testCaseId: number): Promise<MappingRow[]> {
  const response = await api.get(`/test-cases/${testCaseId}/mappings`);
  return response.data;
}

export async function approveMapping(mappingId: number) {
  const response = await api.post(`/mappings/${mappingId}/approve`);
  return response.data;
}

export async function rejectMapping(mappingId: number) {
  const response = await api.post(`/mappings/${mappingId}/reject`);
  return response.data;
}

export async function regenerateMapping(mappingId: number) {
  const response = await api.post(`/mappings/${mappingId}/regenerate`);
  return response.data;
}

export async function generateScript(testCaseId: number, framework: string): Promise<GeneratedScript | { blocked: boolean; reasons: string[]; next_actions: string[] }> {
  const response = await api.post(`/test-cases/${testCaseId}/generate-script`, { framework });
  return response.data;
}

export async function listScripts(testCaseId: number): Promise<GeneratedScript[]> {
  const response = await api.get(`/test-cases/${testCaseId}/scripts`);
  return response.data;
}

export async function reviewScript(scriptId: number) {
  const response = await api.post(`/scripts/${scriptId}/review`);
  return response.data;
}

export async function decideScriptReview(scriptId: number, decision: 'approve_current' | 'keep_blocked'): Promise<GeneratedScript> {
  const response = await api.post(`/scripts/${scriptId}/user-decision`, { decision });
  return response.data;
}

export async function executeScript(scriptId: number): Promise<ExecutionRun> {
  const response = await api.post(`/scripts/${scriptId}/execute`);
  return response.data;
}

export function scriptDownloadUrl(scriptId: number) {
  return `${api.defaults.baseURL}/scripts/${scriptId}/download`;
}

export async function listExecutions(productId: number): Promise<ExecutionRun[]> {
  const response = await api.get(`/products/${productId}/executions`);
  return response.data;
}

export async function runExecution(executionId: number): Promise<ExecutionRun> {
  const response = await api.post(`/executions/${executionId}/run`);
  return response.data;
}

export async function analyzeFailure(executionId: number) {
  const response = await api.post(`/executions/${executionId}/analyze-failure`);
  return response.data;
}

export async function listAutoHeal(productId: number): Promise<AutoHealSuggestion[]> {
  const response = await api.get(`/products/${productId}/auto-heal`);
  return response.data;
}

export async function suggestAutoHeal(productId: number, payload: Record<string, unknown> = {}) {
  const response = await api.post(`/products/${productId}/auto-heal/suggest`, payload);
  return response.data;
}

export async function approveAutoHeal(id: number) {
  const response = await api.post(`/auto-heal/${id}/approve`);
  return response.data;
}

export async function rejectAutoHeal(id: number) {
  const response = await api.post(`/auto-heal/${id}/reject`);
  return response.data;
}

export async function listIntegrations() {
  const response = await api.get('/integrations');
  return response.data;
}

export async function listProductIntegrations(productId: number) {
  const response = await api.get(`/products/${productId}/integrations`);
  return response.data;
}

export async function saveZephyrConfig(payload: Record<string, string>) {
  const response = await api.post('/integrations/zephyr/config', payload);
  return response.data;
}

export async function saveProductZephyrConfig(productId: number, payload: Record<string, string>) {
  const response = await api.post(`/products/${productId}/integrations/zephyr/config`, payload);
  return response.data;
}

export async function importZephyr() {
  const response = await api.post('/integrations/zephyr/import');
  return response.data;
}

export async function importProductZephyr(productId: number) {
  const response = await api.post(`/products/${productId}/integrations/zephyr/import`);
  return response.data;
}

export async function exportZephyrResults() {
  const response = await api.post('/integrations/zephyr/export-results');
  return response.data;
}

export async function exportProductZephyrResults(productId: number) {
  const response = await api.post(`/products/${productId}/integrations/zephyr/export-results`);
  return response.data;
}

export async function listHistory(productId: number): Promise<HistoryEvent[]> {
  const response = await api.get(`/products/${productId}/history`);
  return response.data;
}

export async function chatWithAssistant(
  productId: number,
  message: string,
  history: { role: 'user' | 'assistant'; content: string }[] = [],
  framework = 'SAP_GUI_VBSCRIPT'
) {
  const response = await api.post(`/products/${productId}/assistant/chat`, { message, history, framework });
  return response.data;
}

export async function getSettings() {
  const response = await api.get('/settings');
  return response.data;
}

export async function updateSettings(settings: Record<string, unknown>) {
  const response = await api.put('/settings', { settings });
  return response.data;
}
