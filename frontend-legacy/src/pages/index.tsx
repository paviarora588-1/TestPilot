export { Landing } from './Landing';
import type { ChangeEvent, FormEvent, ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ApprovalModal } from '../components/ApprovalModal';
import { Badge, Confidence } from '../components/Badge';
import { CodeBlock } from '../components/CodeBlock';
import { DataTable } from '../components/DataTable';
import { KpiCard } from '../components/KpiCard';
import { PageHeader } from '../components/PageHeader';
import { ProgressBar } from '../components/ProgressBar';
import { InfinityEngine3D } from '../components/InfinityEngine3D';
import { ThemeToggle } from '../components/ThemeToggle';
import { useProductContext } from '../context/ProductContext';
import { useTheme } from '../context/ThemeContext';
import { downloadWebScannerScript, parseWebScannerOutput, webScannerItemToObjectPayload } from '../utils/webObjectScanner';
import type { AutoHealSuggestion, ExecutionRun, GeneratedScript, HistoryEvent, KnowledgeChunk, KnowledgeSource, KnowledgeSummary, MappingRow, Product, RepositoryObject, TestCase } from '../types';
import {
  analyzeFailure,
  analyzeTestCase,
  approveAutoHeal,
  approveMapping,
  createObject,
  createProduct,
  createTestCase,
  createTextKnowledgeSource,
  deleteProduct,
  deleteObject,
  deleteTestCase,
  downloadSapGuiCrawlerScript,
  downloadTestCaseImportTemplate,
  errorMessage,
  executeScript,
  decideScriptReview,
  exportProductZephyrResults,
  generateScript,
  generateTestCaseFromScreenshot,
  generateTestCaseSuite,
  getCoverage,
  getCoverageGaps,
  getGlobalSummary,
  getKnowledgeSummary,
  getProductReport,
  getRegressionImpact,
  getSapGuiDiscoveryPlan,
  getSettings,
  healthCheck,
  importSapGuiCrawlerOutput,
  importTestCases,
  importProductZephyr,
  listApprovals,
  listAutoHeal,
  listExecutions,
  listHistory,
  listKnowledgeChunks,
  listProductIntegrations,
  listKnowledgeSources,
  listMappings,
  listObjects,
  listScripts,
  listTestCaseQuality,
  listTestCases,
  mapTestSteps,
  processKnowledge,
  regenerateMapping,
  rejectAutoHeal,
  rejectMapping,
  reviewScript,
  runExecution,
  saveProductZephyrConfig,
  scriptDownloadUrl,
  suggestAutoHeal,
  updateObject,
  updateSettings,
  updateTestCase,
  uploadKnowledgeSource,
  verifyObject
} from '../services/api';

const primaryButton = 'btn btn-primary';
const secondaryButton = 'btn';
const dangerButton = 'btn btn-danger';
const successButton = 'btn btn-success';
const compactButton = 'btn min-h-9 px-3 py-1.5 text-xs';
const compactPrimaryButton = 'btn btn-primary min-h-9 px-3 py-1.5 text-xs';
const compactDangerButton = 'btn btn-danger min-h-9 px-3 py-1.5 text-xs';

const emptySummary: KnowledgeSummary = {
  product_id: 0,
  readiness: 0,
  modules: [],
  features: [],
  business_rules: [],
  validations: [],
  expected_messages: [],
  gaps: [],
  missing_gaps: [],
  what_ai_learned: [],
  what_ai_is_unsure_about: [],
  suggestions: [],
  documents_uploaded: 0,
  chunks_created: 0,
  modules_detected: 0,
  features_detected: 0,
  business_rules_extracted: 0
};

function useProducts() {
  const { products, selectedProductId, selectedProduct, setSelectedProductId, refreshProducts, loading, error } = useProductContext();
  return {
    products,
    productId: selectedProductId,
    product: selectedProduct,
    setProductId: setSelectedProductId,
    refreshProducts,
    loading,
    error
  };
}

function ProductPicker({ products, productId, setProductId }: { products: Product[]; productId: number; setProductId: (id: number) => void }) {
  if (!products.length) {
    return <Link className={primaryButton} to="/setup">Create Product First</Link>;
  }
  return (
    <label className="min-w-64 text-sm font-bold">
      Product
      <select className="input mt-2" value={productId || ''} onChange={(event) => setProductId(Number(event.target.value))}>
        {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
      </select>
    </label>
  );
}

function Notice({ message, error }: { message?: string; error?: string }) {
  if (!message && !error) return null;
  if (error) {
    return (
      <div className="mb-4 flex items-start gap-3 rounded-lg border border-red-500/[0.3] bg-red-500/[0.1] p-4 text-sm font-medium text-red-300">
        <svg className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        <span>{error}</span>
      </div>
    );
  }
  return (
    <div className="mb-4 flex items-start gap-3 rounded-lg border border-green-200 bg-green-50 p-4 text-sm font-medium text-green-800">
      <svg className="mt-0.5 h-4 w-4 flex-shrink-0 text-green-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
      <span>{message}</span>
    </div>
  );
}

function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-line bg-slate-500/10 p-8 text-center">
      <h3 className="text-lg font-extrabold">{title}</h3>
      <p className="mx-auto mt-2 max-w-2xl text-muted">{body}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

function formatDate(value?: string) {
  return value ? String(value).replace('T', ' ').slice(0, 19) : 'Not yet';
}

function formatBytes(value?: number) {
  const bytes = Number(value || 0);
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}

function objectName(object: RepositoryObject) {
  return object.object_name || object.objectName || '';
}

function objectType(object: RepositoryObject) {
  return object.object_type || object.objectType || '';
}

function locator(object: RepositoryObject) {
  return object.technical_path || object.locator || '';
}

function objectScope(object: RepositoryObject) {
  return String(object.scope || 'SCREEN').toUpperCase();
}

function areaOrTab(object: RepositoryObject) {
  return object.area_or_tab || object.areaOrTab || '';
}

function actions(object: RepositoryObject) {
  return object.supported_actions || object.supportedActions || [];
}

function isUsefulSapAreaName(value: string) {
  const text = value.trim();
  if (!text) return false;
  if (text.startsWith('/')) return false;
  if (/^[A-Z0-9_:/.-]+$/.test(text) && !/\s/.test(text)) return false;
  if (/^(wnd|usr|mbar|tbar|sbar|pane|btn|menu|shell|shellcont|cntl|tabp|tabs|\w+\[\d+\])/i.test(text)) return false;
  if (/^(Gui|SAPGUI\.|SAP\.|YX_|GCL_|SERVER|OVR|KANA)/i.test(text)) return false;
  return /[A-Za-z]{3,}/.test(text);
}

function sapArea(object: RepositoryObject, objects: RepositoryObject[]) {
  return sapHierarchy(object, objects).area;
}

function sapHierarchy(object: RepositoryObject, objects: RepositoryObject[]) {
  if (objectScope(object) === 'GLOBAL' || isCommonSapChrome(object)) {
    return { area: 'Global Controls', subArea: object.feature || 'Common Controls' };
  }
  if (String(object.platform || '').toUpperCase() !== 'SAP GUI') {
    return { area: object.module || object.screen || 'General', subArea: object.feature || 'Objects' };
  }
  const path = locator(object);
  const candidates = objects
    .filter((candidate) => candidate.id !== object.id && String(candidate.platform || '').toUpperCase() === 'SAP GUI')
    .map((candidate) => ({ candidate, path: locator(candidate), name: objectName(candidate), type: objectType(candidate).toLowerCase() }))
    .filter((candidate) => candidate.path && path.startsWith(candidate.path) && candidate.path !== path)
    .filter((candidate) => ['tab', 'menu', 'tree'].includes(candidate.type) && isUsefulSapAreaName(candidate.name))
    .sort((a, b) => b.path.length - a.path.length);
  const hierarchyNames = candidates
    .sort((a, b) => a.path.length - b.path.length)
    .map((candidate) => candidate.name)
    .filter((name, index, names) => names.indexOf(name) === index && !['Goto SE', 'System', 'Version'].includes(name));
  const productAreas = new Set(['Home', 'Conflict Repository', 'Monitoring', 'Misc.', 'Roles', 'User Assignment']);
  const area = areaOrTab(object) || hierarchyNames[0] || (isUsefulSapAreaName(object.module) ? object.module : '');
  const hierarchySubArea = [...hierarchyNames].reverse().find((name) => name !== area && !productAreas.has(name)) || '';
  const subArea = hierarchySubArea || (isUsefulSapAreaName(object.feature) && object.feature !== area ? object.feature : '') || hierarchyNames[1] || '';
  const name = objectName(object);
  return {
    area: area || (isUsefulSapAreaName(name) ? name : object.screen || 'General'),
    subArea: subArea || (isUsefulSapAreaName(name) && name !== area ? name : 'Objects')
  };
}

function sapLibraryTree(objects: RepositoryObject[]) {
  const tree = new Map<string, Map<string, RepositoryObject[]>>();
  objects.filter((object) => isDisplayableLibraryObject(object)).forEach((object) => {
    const { area, subArea } = sapHierarchy(object, objects);
    if (!tree.has(area)) tree.set(area, new Map());
    const children = tree.get(area)!;
    if (!children.has(subArea)) children.set(subArea, []);
    children.get(subArea)!.push(object);
  });
  return Array.from(tree.entries())
    .map(([area, subAreas]) => ({
      area,
      count: Array.from(subAreas.values()).reduce((sum, rows) => sum + rows.length, 0),
      subAreas: Array.from(subAreas.entries()).map(([subArea, rows]) => ({ subArea, rows })).sort((a, b) => b.rows.length - a.rows.length || a.subArea.localeCompare(b.subArea))
    }))
    .sort((a, b) => a.area.localeCompare(b.area));
}

function isDisplayableLibraryObject(object: RepositoryObject) {
  return objectScope(object) !== 'GLOBAL' && !isSapNavigationChrome(object) && !isSapLayoutContainer(object) && !isSapRootObject(object);
}

function isCommonSapChrome(object: RepositoryObject) {
  const path = locator(object);
  return String(object.platform || '').toUpperCase() === 'SAP GUI' && (/\/wnd\[\d+\]\/tbar\[\d+\](?:\/|$)/.test(path) || /\/wnd\[\d+\]\/sbar(?:\/|$)/.test(path) || /\/wnd\[\d+\]\/mbar$/.test(path));
}

function isSapNavigationChrome(object: RepositoryObject) {
  if (String(object.platform || '').toUpperCase() !== 'SAP GUI') return false;
  const path = locator(object);
  const type = objectType(object).toLowerCase();
  return (
    isCommonSapChrome(object) ||
    /\/wnd\[\d+\]\/mbar\/menu/.test(path) ||
    (type === 'tab' && /\/usr\/tabs[^/]+\/tabp[^/]+$/.test(path)) ||
    (type === 'tab' && /\/usr\/tabs[^/]+\/tabp[^/]+\/ssub[^/]+$/.test(path)) ||
    (type === 'tab' && /\/tabs[A-Z0-9_]+$/i.test(path))
  );
}

function isSapLayoutContainer(object: RepositoryObject) {
  if (String(object.platform || '').toUpperCase() !== 'SAP GUI') return false;
  const name = objectName(object);
  const path = locator(object);
  const isSubscreenContainer = /\/ssub/i.test(path) && !/\/ssub.+\/(?:lbl|ctxt|txt|cmb|btn|tbl|tabs|box|cntl|shellcont|shell)/i.test(path);
  return (
    /^\s*$/.test(name) ||
    /^(usr|mbar|tbar|sbar|shell|shellcont|cntl|pane)$/i.test(name) ||
    /^SAPGUI\./i.test(name) ||
    /BOX$/i.test(name) ||
    /\/box[^/]+$/i.test(path) ||
    isSubscreenContainer ||
    /\/cntl[A-Z0-9_]+(?:\/|$)/i.test(path) ||
    /\/shellcont(?:\/|$)/i.test(path) ||
    /\/shell$/i.test(path)
  );
}

function isSapRootObject(object: RepositoryObject) {
  if (String(object.platform || '').toUpperCase() !== 'SAP GUI') return false;
  const path = locator(object);
  return /\/wnd\[\d+\]$/.test(path) || /\/wnd\[\d+\]\/titl$/.test(path) || /\/wnd\[\d+\]\/usr$/.test(path);
}

function directSapHomeTabs(objects: RepositoryObject[]) {
  return objects
    .filter((object) => String(object.platform || '').toUpperCase() === 'SAP GUI')
    .filter((object) => objectType(object).toLowerCase() === 'tab')
    .filter((object) => /\/usr\/tabs[^/]+\/tabp[^/]+$/.test(locator(object)))
    .map((object) => objectName(object))
    .filter((name, index, names) => isUsefulSapAreaName(name) && names.indexOf(name) === index);
}

function productNavigationAreas(tree: ReturnType<typeof sapLibraryTree>, objects: RepositoryObject[]) {
  const actualHomeTabs = directSapHomeTabs(objects);
  if (actualHomeTabs.length) {
    return actualHomeTabs
      .map((area) => tree.find((node) => node.area === area) || { area, count: 0, subAreas: [] })
      .sort((a, b) => actualHomeTabs.indexOf(a.area) - actualHomeTabs.indexOf(b.area));
  }
  const blocked = new Set([
    'General',
    'Objects',
    'Back (F3)',
    'Cancel (F12)',
    'Close Command Field',
    'Close GUI Window',
    'Customize Local Layout (Alt+F12)',
    'Generates shortcut',
    'Goto SE',
    'Help',
    'Help (F1)',
    'List',
    'Log Off',
    'My Objects',
    'New GUI Window',
    'okcd',
    'Own Jobs',
    'Own Spool Requests',
    'Example App (Enter)',
    'Position',
    'SAP GUI Scripting: Script is running',
    'Services',
    'Services for Object',
    'Set Version...',
    'Short Message',
    'Status...',
    'System',
    'User Profile',
    'Utilities',
    'Version',
    'vm130bouvier'
  ]);
  return tree
    .filter((node) => !blocked.has(node.area) && isUsefulSapAreaName(node.area))
    .filter((node) => node.subAreas.length > 1 || node.count > 2)
    .sort((a, b) => a.area.localeCompare(b.area));
}

function testCaseExternalId(testCase: TestCase) {
  return testCase.external_id || testCase.externalId || '';
}

function expectedResult(testCase: TestCase) {
  return testCase.expected_result || testCase.expectedResult || '';
}

function mappingManual(mapping: MappingRow) {
  return mapping.manual_step || mapping.manualStep || '';
}

function mappingUnderstanding(mapping: MappingRow) {
  return mapping.ai_understanding || mapping.aiUnderstanding || '';
}

function mappingObject(mapping: MappingRow) {
  return mapping.mapped_object || mapping.mappedObject || 'Unmapped';
}

function mappingAction(mapping: MappingRow) {
  return mapping.automation_action || mapping.action || 'review';
}

// Landing is exported from ./Landing.tsx

export function Dashboard() {
  const { products, productId, setProductId, product, error: productError } = useProducts();
  const [global, setGlobal] = useState<Record<string, number>>({});
  const [report, setReport] = useState<Record<string, number>>({});
  const [objects, setObjects] = useState<RepositoryObject[]>([]);
  const [history, setHistoryRows] = useState<HistoryEvent[]>([]);
  const [error, setError] = useState('');

  async function refresh() {
    setError('');
    try {
      setGlobal(await getGlobalSummary());
      if (productId) {
        const [productReport, objectRows, events] = await Promise.all([getProductReport(productId), listObjects(productId), listHistory(productId)]);
        setReport(productReport);
        setObjects(objectRows);
        setHistoryRows(events);
      }
    } catch (error) {
      setError(errorMessage(error));
    }
  }

  useEffect(() => {
    void refresh();
  }, [productId]);

  const platformCounts = ['SAP GUI', 'Web', 'Desktop', 'Hybrid'].map((platform) => {
    const count = objects.filter((object) => object.platform === platform).length;
    return [platform, objects.length ? Math.round((count * 100) / objects.length) : 0] as [string, number];
  });

  return (
    <>
      <PageHeader title="Dashboard" subtitle="Live product readiness, platform coverage, automation status, and TestPilot Agent activity." actions={<><ProductPicker products={products} productId={productId} setProductId={setProductId} /><button className={secondaryButton} onClick={refresh}>Refresh</button><Link className={primaryButton} to="/setup">Create Product</Link></>} />
      <Notice error={productError || error} />
      {!products.length ? <EmptyState title="No products yet" body="Create a product to start the real knowledge-first automation flow." action={<Link className={primaryButton} to="/setup">Create Product</Link>} /> : null}
      <div className="grid gap-4 xl:grid-cols-4">
        <KpiCard label="Product Readiness" value={`${Math.round(product?.readiness || product?.readiness_score || 0)}%`} detail={product?.name || 'No product selected'} />
        <KpiCard label="Knowledge Readiness" value={`${Math.round(report.knowledge_readiness || 0)}%`} detail="Processed sources" />
        <KpiCard label="Library Readiness" value={`${Math.round(report.library_readiness || 0)}%`} detail="Object repository health" />
        <KpiCard label="Mapping Readiness" value={`${Math.round(report.mapping_readiness || 0)}%`} detail="Mapped and approved steps" />
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-4">
        {[
          ['Total Products', global.total_products || 0, 'Database records'],
          ['Knowledge Sources', report.knowledge_sources || 0, 'Current product'],
          ['Library Objects', report.library_objects || 0, 'Reusable objects'],
          ['Test Cases', report.test_cases || 0, 'Imported/manual'],
          ['Mapped Steps', report.mapped_steps || 0, 'Automation-ready'],
          ['Unmapped Steps', report.unmapped_steps || 0, 'Needs review'],
          ['Generated Scripts', report.generated_scripts || 0, 'Downloadable files'],
          ['Auto-Heal Suggestions', report.auto_heal_suggestions || 0, 'Approval-controlled']
        ].map(([label, value, detail]) => <KpiCard key={String(label)} label={String(label)} value={String(value)} detail={String(detail)} />)}
      </div>
      <section className="card mt-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-extrabold">Selected Product Snapshot</h3>
            <p className="text-sm text-muted">Showing data for selected product only.</p>
          </div>
          <Badge>{product?.name || 'No product selected'}</Badge>
        </div>
        <div className="grid gap-4 xl:grid-cols-5">
          <KpiCard label="Selected Product Knowledge Sources" value={String(report.knowledge_sources || 0)} detail="Filtered by product_id" />
          <KpiCard label="Selected Product Objects" value={String(report.library_objects || 0)} detail="Filtered by product_id" />
          <KpiCard label="Selected Product Test Cases" value={String(report.test_cases || 0)} detail="Filtered by product_id" />
          <KpiCard label="Selected Product Scripts" value={String(report.generated_scripts || 0)} detail="Filtered by product_id" />
          <KpiCard label="Selected Product History Events" value={String(history.length)} detail="Filtered by product_id" />
        </div>
      </section>
      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <section className="card"><h3 className="text-lg font-extrabold">Platform Coverage</h3><div className="mt-4 space-y-4">{platformCounts.map(([name, value]) => <div key={name}><div className="mb-1 flex justify-between text-sm font-bold"><span>{name}</span><span>{value}%</span></div><ProgressBar value={value} /></div>)}</div></section>
        <section className="card"><h3 className="text-lg font-extrabold">Automation Status</h3><div className="mt-4 space-y-3">{[['Ready', report.mapped_steps || 0], ['Need Review', report.unmapped_steps || 0], ['Scripts', report.generated_scripts || 0], ['Executions', report.executions || 0]].map(([label, value]) => <div key={String(label)} className="flex items-center justify-between rounded-xl bg-white/[0.06] border border-white/[0.07] p-3"><span className="font-bold">{label}</span><strong>{String(value)}</strong></div>)}</div></section>
        <section className="card"><h3 className="text-lg font-extrabold">Recent AI Activity</h3><div className="mt-4 space-y-3">{history.slice(0, 4).map((event) => <div key={event.id || `${event.time}-${event.action}`} className="rounded-xl border border-line p-3"><div className="flex justify-between gap-3"><strong>{event.action}</strong><Badge>{event.status}</Badge></div><p className="text-sm text-muted">{formatDate(String(event.time))} - {event.actor}</p></div>)}{!history.length ? <p className="text-muted">No history yet.</p> : null}</div></section>
      </div>
    </>
  );
}

export function ProductSetup() {
  const { products, productId, setProductId, refreshProducts } = useProducts();
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: '',
    product_type: 'SAP GUI',
    environment: 'QA',
    entry_point: '',
    app_path_or_url: '',
    default_framework: 'SAP_GUI_VBSCRIPT',
    owner: 'QA Manager',
    description: '',
    business_criticality: 'Medium',
    automation_risk_level: 'Medium'
  });

  async function submit(event: FormEvent) {
    event.preventDefault();
    setMessage('');
    setError('');
    setSaving(true);
    try {
      const created = await createProduct(form);
      setProductId(created.id);
      setMessage('Product created and selected successfully.');
      setForm({ ...form, name: '', entry_point: '', app_path_or_url: '', description: '' });
      await refreshProducts();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  async function removeProduct(id: number) {
    setMessage('');
    setError('');
    try {
      await deleteProduct(id);
      const rows = await refreshProducts();
      if (id === productId) {
        setProductId(rows[0]?.id || 0);
      }
      setMessage('Product deleted successfully.');
    } catch (error) {
      setError(errorMessage(error));
    }
  }

  return (
    <>
      <PageHeader title="Product Setup" subtitle="Configure any SAP GUI, Web, Desktop, or Hybrid product before knowledge onboarding." actions={<Link className={primaryButton} to="/knowledge">Continue to Knowledge</Link>} />
      <Notice message={message} error={error} />
      <div className="grid gap-4 xl:grid-cols-[1.5fr_.8fr]">
        <form className="card" onSubmit={submit}>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="text-sm font-bold">Product Name<input className="input mt-2" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required /></label>
            <label className="text-sm font-bold">Environment<input className="input mt-2" value={form.environment} onChange={(event) => setForm({ ...form, environment: event.target.value })} /></label>
            <label className="text-sm font-bold md:col-span-2">SAP Logon Path / Web URL / Desktop EXE Path<input className="input mt-2" value={form.app_path_or_url || form.entry_point} onChange={(event) => setForm({ ...form, entry_point: event.target.value, app_path_or_url: event.target.value })} placeholder="saplogon.exe, https://app, or C:\\Program Files\\app.exe" /></label>
            <label className="text-sm font-bold">Default Framework<select className="input mt-2" value={form.default_framework} onChange={(event) => setForm({ ...form, default_framework: event.target.value })}>{['SAP_GUI_VBSCRIPT', 'SELENIUM_JAVA', 'PLAYWRIGHT', 'CUCUMBER', 'DESKTOP', 'HYBRID'].map((item) => <option key={item}>{item}</option>)}</select></label>
            <label className="text-sm font-bold">Owner<input className="input mt-2" value={form.owner} onChange={(event) => setForm({ ...form, owner: event.target.value })} /></label>
            <label className="text-sm font-bold">Business Criticality<select className="input mt-2" value={form.business_criticality} onChange={(event) => setForm({ ...form, business_criticality: event.target.value })}>{['Low', 'Medium', 'High', 'Mission Critical'].map((item) => <option key={item}>{item}</option>)}</select></label>
            <label className="text-sm font-bold">Automation Risk Level<select className="input mt-2" value={form.automation_risk_level} onChange={(event) => setForm({ ...form, automation_risk_level: event.target.value })}>{['Low', 'Medium', 'High', 'Blocked'].map((item) => <option key={item}>{item}</option>)}</select></label>
            <label className="text-sm font-bold md:col-span-2">Description<textarea className="input mt-2 min-h-28" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
          </div>
          <div className="mt-5 flex gap-3"><button className={primaryButton} type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save Product'}</button><Link className={secondaryButton} to="/knowledge">Continue</Link></div>
        </form>
        <section className="card">
          <h3 className="text-lg font-extrabold">Product Type</h3>
          <div className="mt-4 grid gap-3">{['SAP GUI', 'Web', 'Desktop', 'Hybrid', 'API-ready', 'Mobile Future'].map((type) => <button type="button" key={type} onClick={() => setForm({ ...form, product_type: type })} className={`rounded-xl border p-4 text-left font-bold transition-all ${type === form.product_type ? 'border-primary bg-blue-500/[0.15] text-primary' : 'border-white/[0.08] bg-white/[0.04] text-white/70 hover:bg-white/[0.08] hover:text-white'}`}>{type}</button>)}</div>
        </section>
      </div>
      <section className="card mt-4">
        <h3 className="mb-3 text-lg font-extrabold">Saved Products</h3>
        <DataTable headers={['Product', 'Type', 'Environment', 'Framework', 'Owner', 'Readiness', 'Actions']} rows={products.map((product) => [product.name, product.product_type || product.type || '', product.environment, product.default_framework || product.framework || '', product.owner, <ProgressBar value={Math.round(product.readiness || product.readiness_score || 0)} />, <button className={dangerButton} onClick={() => removeProduct(product.id)}>Delete</button>])} />
      </section>
    </>
  );
}

export function KnowledgeBase() {
  const { products, productId, setProductId } = useProducts();
  const selectedProduct = products.find((product) => product.id === productId);
  const [sources, setSources] = useState<KnowledgeSource[]>([]);
  const [chunks, setChunks] = useState<KnowledgeChunk[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState<number>(0);
  const [summary, setSummary] = useState<KnowledgeSummary>(emptySummary);
  const [file, setFile] = useState<File | null>(null);
  const [textContent, setTextContent] = useState('Module: Account Management\nFeature: User Search\nRule: User must enter a valid business key.\nValidation: Invalid values show a blocking message.');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [processingId, setProcessingId] = useState<number | null>(null);

  async function refresh() {
    if (!productId) {
      setSources([]);
      setChunks([]);
      setSummary(emptySummary);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const [sourceRows, knowledge, chunkRows] = await Promise.all([listKnowledgeSources(productId), getKnowledgeSummary(productId), listKnowledgeChunks(productId)]);
      setSources(sourceRows);
      setSummary(knowledge);
      setChunks(chunkRows);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [productId]);

  async function uploadFile(event: FormEvent) {
    event.preventDefault();
    if (!productId) {
      setError('Please select a product before uploading knowledge resources.');
      return;
    }
    if (!file) {
      setError('Please choose a knowledge resource to upload.');
      return;
    }
    setMessage('');
    setError('');
    setUploading(true);
    try {
      await uploadKnowledgeSource(productId, file);
      setMessage('Knowledge resource uploaded successfully.');
      setFile(null);
      await refresh();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setUploading(false);
    }
  }

  async function addTextSource() {
    if (!productId) {
      setError('Please select a product before uploading knowledge resources.');
      return;
    }
    setMessage('');
    setError('');
    try {
      await createTextKnowledgeSource(productId, `manual-knowledge-${Date.now()}.txt`, textContent, 'Functional Spec');
      setMessage('Knowledge resource uploaded successfully.');
      await refresh();
    } catch (error) {
      setError(errorMessage(error));
    }
  }

  async function process(sourceId: number) {
    setMessage('');
    setError('');
    setProcessingId(sourceId);
    try {
      const result = await processKnowledge(sourceId);
      setSummary(result);
      setMessage('Knowledge processed successfully.');
      await refresh();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setProcessingId(null);
    }
  }

  const selectedChunks = selectedSourceId ? chunks.filter((chunk) => chunk.source_id === selectedSourceId) : chunks.slice(0, 8);
  const sourceName = (sourceId: number) => sources.find((source) => source.id === sourceId)?.original_filename || sources.find((source) => source.id === sourceId)?.name || `Source ${sourceId}`;
  const summaryBlocks = [
    ['Modules detected', summary.modules_detected_list || summary.modules],
    ['Features detected', summary.features_detected_list || summary.features],
    ['Business rules', summary.business_rules],
    ['Validations', summary.validations],
    ['Expected messages', summary.expected_messages],
    ['Missing gaps', summary.missing_gaps || summary.gaps],
    ['What AI learned', summary.what_ai_learned || []],
    ['What AI is unsure about', summary.what_ai_is_unsure_about || []]
  ] as Array<[string, string[]]>;

  return (
    <>
      <PageHeader title="Knowledge Base" subtitle="Upload and process product guides, PDFs, documents, and resources." actions={<><ProductPicker products={products} productId={productId} setProductId={setProductId} /><Link className={primaryButton} to="/knowledge-result">View Result</Link></>} />
      <Notice message={message} error={error} />
      {!products.length ? <EmptyState title="Select or create a product to start adding knowledge resources." body="Product knowledge is stored product-wise, so create a product first and then upload guides into that product." action={<Link className={primaryButton} to="/setup">Create Product</Link>} /> : null}
      {products.length && !selectedProduct ? <EmptyState title="Select or create a product to start adding knowledge resources." body="Choose a product from the selector before uploading any guide or resource." /> : null}
      {selectedProduct ? (
        <div className="grid gap-4">
          <section className="product-hero-card overflow-hidden">
            <div className="flex items-center gap-5">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-extrabold uppercase tracking-wide text-primary">Selected product</p>
                <h3 className="mt-1 text-2xl font-extrabold">{selectedProduct.name}</h3>
                <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold">
                  <span className="rounded-full bg-blue-500/10 px-2.5 py-1 text-primary">{selectedProduct.product_type || selectedProduct.type}</span>
                  <span className="rounded-full bg-teal-500/10 px-2.5 py-1 text-secondary">{selectedProduct.environment}</span>
                  <span className="rounded-full bg-slate-500/10 px-2.5 py-1 text-muted">{selectedProduct.default_framework || selectedProduct.framework}</span>
                </div>
                <div className="mt-5 max-w-md rounded-lg border border-line bg-card/70 p-4">
                  <div className="mb-1 flex justify-between text-sm font-bold"><span>Knowledge Readiness</span><span>{Math.round(summary.readiness || 0)}%</span></div>
                  <ProgressBar value={Math.round(summary.readiness || 0)} />
                </div>
              </div>
            </div>
          </section>

          <form className="upload-zone" onSubmit={uploadFile}>
            <div className="upload-orb">KB</div>
            <div className="min-w-0 text-left">
              <h3 className="text-xl font-extrabold">Upload knowledge resource</h3>
              <p className="mt-1 text-muted">PDF, DOCX, TXT, CSV, XLSX, PNG, JPG for {selectedProduct.name}.</p>
            </div>
            <input className="input min-w-0 flex-1" type="file" accept=".pdf,.docx,.txt,.csv,.xlsx,.png,.jpg,.jpeg" onChange={(event: ChangeEvent<HTMLInputElement>) => setFile(event.target.files?.[0] || null)} />
            <button className={primaryButton} disabled={!file || uploading}>{uploading ? 'Uploading...' : 'Upload Knowledge'}</button>
          </form>

          <section className="card">
            <h3 className="text-lg font-extrabold">Optional manual text resource</h3>
            <div className="mt-4 grid gap-4 md:grid-cols-[1fr_auto]">
              <textarea className="input min-h-32" value={textContent} onChange={(event) => setTextContent(event.target.value)} />
              <button className={secondaryButton} onClick={addTextSource}>Save Text Source</button>
            </div>
          </section>

          <section className="card">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-lg font-extrabold">Uploaded Resources</h3>
              <button className={secondaryButton} onClick={refresh} disabled={loading}>{loading ? 'Refreshing...' : 'Refresh'}</button>
            </div>
            <DataTable
              headers={['File Name', 'Type', 'Size', 'Status', 'Uploaded At', 'Processed At', 'Actions']}
              rows={sources.map((source) => {
                const status = String(source.status || '').toLowerCase();
                return [
                  <span><strong>{source.original_filename || source.name}</strong><span className="block text-xs text-muted">{source.filename}</span>{source.error_message ? <span className="block text-xs text-red-600">{source.error_message}</span> : null}</span>,
                  source.file_type || source.content_type || source.source_type,
                  formatBytes(source.file_size),
                  <Badge>{status || 'uploaded'}</Badge>,
                  formatDate(source.created_at),
                  formatDate(source.processed_at),
                  <div className="flex flex-wrap gap-2">
                    <button className={primaryButton} onClick={() => process(source.id)} disabled={processingId === source.id}>{processingId === source.id ? 'Processing...' : status === 'processed' ? 'Reprocess' : 'Process'}</button>
                    <button className={secondaryButton} onClick={() => setSelectedSourceId(source.id)}>View Chunks</button>
                  </div>
                ];
              })}
            />
            {!sources.length ? <EmptyState title="No knowledge uploaded" body={`Upload a guide, PDF, document, or resource for ${selectedProduct.name}. It will appear here after the backend saves it.`} /> : null}
          </section>

          <section className="card">
            <h3 className="text-lg font-extrabold">Processed Knowledge Summary</h3>
            <div className="mt-4 grid gap-4 md:grid-cols-5">
              {[
                ['Documents uploaded', summary.documents_uploaded],
                ['Chunks created', summary.chunks_created],
                ['Modules detected', summary.modules_detected],
                ['Features detected', summary.features_detected],
                ['Rules extracted', summary.business_rules_extracted]
              ].map(([label, value]) => <KpiCard key={String(label)} label={String(label)} value={String(value || 0)} detail="Database-backed" />)}
            </div>
            <div className="mt-5 grid gap-4 xl:grid-cols-2">
              {summaryBlocks.map(([title, values]) => (
                <div key={title} className="rounded-2xl border border-line p-4">
                  <h4 className="font-extrabold">{title}</h4>
                  <div className="mt-3 space-y-2">
                    {(values || []).map((value) => <div key={value} className="rounded-xl bg-white/[0.06] border border-white/[0.07] p-3 text-sm font-medium text-white">{value}</div>)}
                    {!(values || []).length ? <p className="text-sm text-muted">Nothing saved yet. Process a resource to populate this section.</p> : null}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="card">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-lg font-extrabold">Knowledge Chunks Preview</h3>
              <div className="flex gap-2">
                {selectedSourceId ? <button className={secondaryButton} onClick={() => setSelectedSourceId(0)}>Show All</button> : null}
                <Link className={secondaryButton} to="/history">Open History</Link>
              </div>
            </div>
            <DataTable
              headers={['Chunk', 'Source File', 'Preview']}
              rows={selectedChunks.map((chunk) => [
                chunk.chunk_index,
                sourceName(chunk.source_id),
                <span className="line-clamp-4 max-w-4xl">{(chunk.chunk_text || chunk.content || '').slice(0, 300)}</span>
              ])}
            />
            {!selectedChunks.length ? <EmptyState title="No chunks yet" body="Click Process on an uploaded resource. Chunks are saved in SQLite and will stay visible after refresh." /> : null}
          </section>
        </div>
      ) : null}
    </>
  );
}

export function KnowledgeResult() {
  const { products, productId, setProductId } = useProducts();
  const [summary, setSummary] = useState<KnowledgeSummary>(emptySummary);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!productId) return;
    getKnowledgeSummary(productId).then(setSummary).catch((error) => setError(errorMessage(error)));
  }, [productId]);

  return (
    <>
      <PageHeader title="Knowledge Processing Result" subtitle="Detected modules, features, rules, validations, expected messages, gaps, and suggestions." actions={<><ProductPicker products={products} productId={productId} setProductId={setProductId} /><Link className={primaryButton} to="/library">Build Library</Link></>} />
      <Notice error={error} />
      <div className="grid gap-4 xl:grid-cols-3">{[
        ['Detected Modules', summary.modules],
        ['Detected Features', summary.features],
        ['Expected Messages', summary.expected_messages]
      ].map(([title, values]) => <section key={String(title)} className="card"><h3 className="text-lg font-extrabold">{String(title)}</h3><div className="mt-3 space-y-2">{(values as string[]).map((x) => <div key={x} className="rounded-xl bg-white/[0.06] border border-white/[0.07] p-3 font-medium text-white">{x}</div>)}{!(values as string[]).length ? <p className="text-muted">Nothing detected yet.</p> : null}</div></section>)}</div>
      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <section className="card"><h3 className="font-extrabold">Business Rules and Validations</h3><DataTable headers={['Type', 'Value']} rows={[...summary.business_rules.map((rule) => ['Rule', rule]), ...summary.validations.map((rule) => ['Validation', rule])]} /></section>
        <section className="card"><h3 className="font-extrabold">Missing Knowledge Gaps</h3><DataTable headers={['Gap', 'Status']} rows={(summary.gaps.length ? summary.gaps : ['Process more product knowledge to detect gaps.']).map((gap) => [gap, <Badge>Need Review</Badge>])} /></section>
      </div>
    </>
  );
}

const LIBRARY_PLATFORMS = ['SAP GUI', 'Web', 'Desktop', 'Hybrid'] as const;
type LibraryPlatform = typeof LIBRARY_PLATFORMS[number];

const OBJECT_TYPES_BY_PLATFORM: Record<LibraryPlatform, string[]> = {
  'SAP GUI': ['input', 'button', 'dropdown', 'table', 'tree', 'grid', 'message', 'menu', 'tab', 'label', 'container'],
  Web: ['input', 'button', 'dropdown', 'checkbox', 'radio', 'link', 'label', 'container', 'table', 'message'],
  Desktop: ['input', 'button', 'dropdown', 'checkbox', 'radio', 'menu', 'tab', 'label', 'container', 'table'],
  Hybrid: ['input', 'button', 'dropdown', 'table', 'tree', 'grid', 'message', 'menu', 'tab', 'label', 'container', 'checkbox', 'radio', 'link']
};

function normalizeLibraryPlatform(value?: string): LibraryPlatform {
  return (LIBRARY_PLATFORMS as readonly string[]).includes(value || '') ? (value as LibraryPlatform) : 'Hybrid';
}

export function ProductLibrary() {
  const { products, productId, setProductId } = useProducts();
  const [objects, setObjects] = useState<RepositoryObject[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [crawlerFile, setCrawlerFile] = useState<File | null>(null);
  const [crawlerFileKey, setCrawlerFileKey] = useState(0);
  const [crawlerBusy, setCrawlerBusy] = useState<'plan' | 'download' | 'import' | null>(null);
  const [crawlerTargetCode, setCrawlerTargetCode] = useState('');
  const [discoveryPlan, setDiscoveryPlan] = useState<Record<string, any> | null>(null);
  const [webScannerFile, setWebScannerFile] = useState<File | null>(null);
  const [webScannerFileKey, setWebScannerFileKey] = useState(0);
  const [webScannerBusy, setWebScannerBusy] = useState(false);
  const [libraryPlatform, setLibraryPlatform] = useState<LibraryPlatform>('Hybrid');
  const [selectedArea, setSelectedArea] = useState('All');
  const [selectedSubArea, setSelectedSubArea] = useState('All');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    object_name: '',
    platform: 'Web',
    module: '',
    feature: '',
    screen: '',
    object_type: 'input',
    technical_path: '',
    supported_actions: 'enter_text, click, verify',
    aliases: '',
    confidence: 85,
    status: 'Active'
  });

  const selectedProduct = products.find((product) => product.id === productId);
  const platformObjects = useMemo(
    () => libraryPlatform === 'Hybrid' ? objects : objects.filter((object) => String(object.platform || '').toUpperCase() === libraryPlatform.toUpperCase()),
    [objects, libraryPlatform]
  );
  const libraryTree = useMemo(() => sapLibraryTree(platformObjects), [platformObjects]);
  const navigationAreas = useMemo(() => productNavigationAreas(libraryTree, platformObjects), [libraryTree, platformObjects]);
  const displayObjects = useMemo(() => libraryTree.flatMap((node) => node.subAreas.flatMap((subArea) => subArea.rows)), [libraryTree]);
  const selected = displayObjects.find((object) => object.id === selectedId) || displayObjects[0] || platformObjects[0];
  const homeCount = libraryTree.find((node) => node.area === 'Home')?.count || 0;
  const activeArea = selectedArea === 'All' ? 'Home' : selectedArea;
  const activeAreaNode = libraryTree.find((node) => node.area === activeArea);
  const activeSubArea = selectedSubArea === 'All' || !activeAreaNode?.subAreas.some((node) => node.subArea === selectedSubArea)
    ? activeAreaNode?.subAreas[0]?.subArea || 'All'
    : selectedSubArea;
  const isHomeView = activeArea === 'Home';
  const filteredObjects = isHomeView
    ? []
    : activeAreaNode
    ? activeAreaNode.subAreas.flatMap((node) => (activeSubArea === 'All' || node.subArea === activeSubArea ? node.rows : []))
    : platformObjects;

  async function refresh() {
    if (!productId) return;
    try {
      const rows = await listObjects(productId);
      setObjects(rows);
      setSelectedId((current) => rows.some((row) => row.id === current) ? current : rows[0]?.id || null);
      const nextTree = sapLibraryTree(rows);
      if (selectedArea !== 'All' && !nextTree.some((node) => node.area === selectedArea)) {
        setSelectedArea('All');
        setSelectedSubArea('All');
      }
    } catch (error) {
      setError(errorMessage(error));
    }
  }

  useEffect(() => {
    void refresh();
  }, [productId]);

  useEffect(() => {
    const nextPlatform = normalizeLibraryPlatform(selectedProduct?.product_type);
    setLibraryPlatform(nextPlatform);
    if (nextPlatform !== 'Hybrid') {
      setForm((current) => ({ ...current, platform: nextPlatform }));
    }
  }, [productId, selectedProduct?.product_type]);

  function selectLibraryPlatform(platform: LibraryPlatform) {
    setLibraryPlatform(platform);
    if (platform !== 'Hybrid' && !editingId) {
      setForm((current) => ({ ...current, platform, object_type: OBJECT_TYPES_BY_PLATFORM[platform].includes(current.object_type) ? current.object_type : OBJECT_TYPES_BY_PLATFORM[platform][0] }));
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!productId) return;
    try {
      setError('');
      if (editingId) {
        await updateObject(editingId, form);
        setMessage('Object updated in repository');
      } else {
        await createObject(productId, form);
        setMessage('Object saved to repository');
      }
      setEditingId(null);
      setForm({ ...form, object_name: '', technical_path: '', aliases: '' });
      await refresh();
    } catch (error) {
      setError(errorMessage(error));
    }
  }

  function edit(object: RepositoryObject) {
    setSelectedId(object.id);
    setEditingId(object.id);
    setForm({
      object_name: objectName(object),
      platform: String(object.platform || 'Web'),
      module: object.module,
      feature: object.feature,
      screen: object.screen,
      object_type: objectType(object),
      technical_path: locator(object),
      supported_actions: actions(object).join(', '),
      aliases: object.aliases?.join(', ') || '',
      confidence: Math.round(object.confidence || 80),
      status: object.status || 'Active'
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setForm({ ...form, object_name: '', technical_path: '', aliases: '' });
  }

  async function remove(id: number) {
    try {
      setError('');
      await deleteObject(id);
      setMessage('Object deleted');
      await refresh();
    } catch (error) {
      setError(errorMessage(error));
    }
  }

  async function verify(id: number) {
    try {
      setError('');
      await verifyObject(id);
      setMessage('Object verified');
      await refresh();
    } catch (error) {
      setError(errorMessage(error));
    }
  }

  async function downloadCrawler() {
    if (!productId) {
      setError('Select a product before downloading the SAP GUI crawler.');
      return;
    }
    try {
      setCrawlerBusy('download');
      setError('');
      setMessage('');
      await downloadSapGuiCrawlerScript(productId, crawlerTargetCode);
      setMessage(crawlerTargetCode.trim()
        ? `SAP GUI product library scanner downloaded for ${crawlerTargetCode.trim()}. Run it from a logged-in SAP GUI session, use watcher mode while you manually open in-T-code screens, then import the JSONL from your Desktop.`
        : 'SAP GUI product library scanner downloaded. It scans the current product area, selects tabs, expands trees, and can watch while you manually open in-T-code screens.');
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setCrawlerBusy(null);
    }
  }

  async function buildDiscoveryPlan() {
    if (!productId) {
      setError('Select a product before building a SAP GUI discovery plan.');
      return;
    }
    try {
      setCrawlerBusy('plan');
      setError('');
      setMessage('');
      const plan = await getSapGuiDiscoveryPlan(productId);
      setDiscoveryPlan(plan);
      setMessage('SAP GUI discovery plan created from processed product knowledge.');
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setCrawlerBusy(null);
    }
  }

  async function importCrawler(event: FormEvent) {
    event.preventDefault();
    if (!productId || !crawlerFile) {
      setError('Select a product and choose the crawler JSON output.');
      return;
    }
    try {
      setCrawlerBusy('import');
      setError('');
      setMessage('');
      const result = await importSapGuiCrawlerOutput(productId, crawlerFile);
      setCrawlerFile(null);
      setCrawlerFileKey((value) => value + 1);
      const summary = result.crawler_summary || {};
      const screenText = summary.screens ? ` across ${summary.screens} screen${summary.screens === 1 ? '' : 's'}` : '';
      const edgeText = summary.navigation_edges ? `, ${summary.navigation_edges} safe navigation edge${summary.navigation_edges === 1 ? '' : 's'} mapped` : '';
      setMessage(`SAP GUI product library import complete: ${result.imported || 0} added, ${result.updated || 0} maintained, ${result.duplicate_merges || 0} duplicates merged, ${result.skipped || 0} invalid rows skipped${screenText}${edgeText}.`);
      await refresh();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setCrawlerBusy(null);
    }
  }

  function downloadWebScanner() {
    if (!productId) {
      setError('Select a product before downloading the Web scanner.');
      return;
    }
    setError('');
    setMessage('');
    downloadWebScannerScript(selectedProduct?.name || 'TestPilot Product');
    setMessage('Web product library scanner downloaded. Paste it into the target web app’s DevTools console, then import the downloaded JSON file below.');
  }

  async function importWebScanner(event: FormEvent) {
    event.preventDefault();
    if (!productId || !webScannerFile) {
      setError('Select a product and choose the Web scanner JSON output.');
      return;
    }
    try {
      setWebScannerBusy(true);
      setError('');
      setMessage('');
      const raw = await webScannerFile.text();
      const items = parseWebScannerOutput(raw);
      if (!items.length) {
        setError('No valid objects found in the uploaded file.');
        return;
      }
      const existingByPath = new Map(
        objects.filter((object) => String(object.platform || '').toUpperCase() === 'WEB').map((object) => [locator(object), object])
      );
      let imported = 0;
      let updated = 0;
      let skipped = 0;
      for (const item of items) {
        const payload = webScannerItemToObjectPayload(item);
        const existing = existingByPath.get(item.technical_path);
        if (!payload.object_name || !payload.technical_path) {
          skipped += 1;
          continue;
        }
        if (existing) {
          const mergedAliases = Array.from(new Set([...(existing.aliases || []), ...String(payload.aliases || '').split(',').map((value) => value.trim()).filter(Boolean)]));
          const mergedActions = Array.from(new Set([...actions(existing), ...String(payload.supported_actions || '').split(',').map((value) => value.trim()).filter(Boolean)]));
          await updateObject(existing.id, { ...payload, aliases: mergedAliases.join(', '), supported_actions: mergedActions.join(', ') });
          updated += 1;
        } else {
          await createObject(productId, payload);
          imported += 1;
        }
      }
      setWebScannerFile(null);
      setWebScannerFileKey((value) => value + 1);
      setMessage(`Web product library import complete: ${imported} added, ${updated} updated, ${skipped} skipped.`);
      await refresh();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setWebScannerBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Product Library / Object Repository" subtitle="Reusable generic UI objects, paths, locators, desktop controls, actions, and confidence." actions={<><ProductPicker products={products} productId={productId} setProductId={setProductId} /><button className={secondaryButton} onClick={refresh}>Refresh</button></>} />
      <Notice message={message} error={error} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-sm font-extrabold text-muted">Platform</span>
        {LIBRARY_PLATFORMS.map((platform) => <button key={platform} type="button" className={`${libraryPlatform === platform ? primaryButton : secondaryButton} text-xs`} onClick={() => selectLibraryPlatform(platform)}>{platform}</button>)}
      </div>
      {libraryPlatform === 'SAP GUI' || libraryPlatform === 'Hybrid' ? <section className="card mb-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h3 className="font-extrabold">SAP GUI Product Library Scanner</h3>
            <p className="mt-1 text-sm text-muted">Build a discovery plan from processed knowledge, enter the exact SAP T-code, download the local scanner, login to SAP GUI, let it scan and safely explore the product area, then import the generated JSONL to maintain the automation object library.</p>
            <p className="mt-1 text-sm font-bold text-emerald-700">Strict scanner mode: it reads visible objects, selects tabs, expands trees, records button/report IDs without pressing buttons, and can watch while you manually open in-T-code screens for deeper capture.</p>
            <p className="mt-1 text-sm font-medium text-white/55">Credentials are entered only in SAP GUI or the local script prompt. TestPilot does not store SAP passwords.</p>
            <div className="mt-3 grid gap-2 text-sm md:grid-cols-4">
              {['1. Build the plan', '2. Open and login to SAP GUI', '3. Run the product scanner', '4. Import grouped JSONL'].map((step) => <div key={step} className="rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 font-medium text-white">{step}</div>)}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <input className="input w-56" value={crawlerTargetCode} onChange={(event) => setCrawlerTargetCode(event.target.value)} placeholder="Exact T-code, e.g. /nYOUR_TCODE" />
            <button type="button" className={secondaryButton} disabled={crawlerBusy !== null} onClick={buildDiscoveryPlan}>{crawlerBusy === 'plan' ? 'Building…' : 'Build Discovery Plan'}</button>
            <button type="button" className={secondaryButton} disabled={crawlerBusy !== null} onClick={downloadCrawler}>{crawlerBusy === 'download' ? 'Downloading…' : 'Download Product Scanner VBS'}</button>
          </div>
        </div>
        {discoveryPlan ? <div className="mt-4 rounded-xl bg-white/[0.06] border border-white/[0.07] p-4 text-white">
          <div className="flex flex-wrap gap-3 text-sm text-muted">
            <span>Knowledge readiness: <strong>{Math.round(Number(discoveryPlan.knowledge_readiness || 0))}%</strong></span>
            <span>SAP GUI objects: <strong>{discoveryPlan.sap_gui_objects || 0}</strong></span>
          </div>
          <DataTable headers={['Module', 'Features', 'Status', 'Next Action']} rows={(discoveryPlan.targets || []).map((target: any) => [target.module, (target.features || []).join(', ') || 'Use product guide/module transaction', <Badge>{target.status}</Badge>, target.next_action])} />
        </div> : null}
        <form className="mt-4 flex flex-wrap items-center gap-3" onSubmit={importCrawler}>
          <input key={crawlerFileKey} className="input max-w-md" type="file" accept=".json,.jsonl,application/json,application/x-ndjson" onChange={(event: ChangeEvent<HTMLInputElement>) => setCrawlerFile(event.target.files?.[0] || null)} />
          <button className={primaryButton} disabled={!crawlerFile || crawlerBusy !== null}>{crawlerBusy === 'import' ? 'Importing…' : 'Import Crawler JSON'}</button>
        </form>
      </section> : null}
      {libraryPlatform === 'Web' || libraryPlatform === 'Hybrid' ? <section className="card mb-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h3 className="font-extrabold">Web Product Library Scanner</h3>
            <p className="mt-1 text-sm text-muted">Download a scanner script, paste it into the target web app’s DevTools console, then import the downloaded JSON to fill the object repository with inputs, buttons, links, and dropdowns.</p>
            <p className="mt-1 text-sm font-medium text-white/55">The scanner runs entirely in your browser on the target site; nothing is sent anywhere except the JSON file it downloads locally.</p>
            <div className="mt-3 grid gap-2 text-sm md:grid-cols-3">
              {['1. Download scanner script', '2. Run it in DevTools console on the target page', '3. Import the downloaded JSON'].map((step) => <div key={step} className="rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 font-medium text-white">{step}</div>)}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={secondaryButton} onClick={downloadWebScanner}>Download Web Scanner Script</button>
          </div>
        </div>
        <form className="mt-4 flex flex-wrap items-center gap-3" onSubmit={importWebScanner}>
          <input key={webScannerFileKey} className="input max-w-md" type="file" accept=".json,application/json" onChange={(event: ChangeEvent<HTMLInputElement>) => setWebScannerFile(event.target.files?.[0] || null)} />
          <button className={primaryButton} disabled={!webScannerFile || webScannerBusy}>{webScannerBusy ? 'Importing…' : 'Import Web Scanner JSON'}</button>
        </form>
      </section> : null}
      {libraryPlatform === 'Desktop' ? <EmptyState title="Desktop scanner not available yet" body="Automated Desktop discovery isn't built yet. Add Desktop objects manually using the form below." /> : null}
      <form className="card mb-4 grid gap-4 md:grid-cols-4" onSubmit={submit}>
        {[
          ['object_name', 'Object Name'],
          ['module', 'Module'],
          ['feature', 'Feature'],
          ['screen', 'Screen'],
          ['technical_path', 'Technical Path / Locator'],
          ['aliases', 'Business Aliases'],
          ['supported_actions', 'Supported Actions']
        ].map(([key, label]) => <label key={key} className="text-sm font-bold">{label}<input className="input mt-2" value={String(form[key as keyof typeof form])} onChange={(event) => setForm({ ...form, [key]: event.target.value })} required={key === 'object_name'} /></label>)}
        {libraryPlatform === 'Hybrid'
          ? <label className="text-sm font-bold">Platform<select className="input mt-2" value={form.platform} onChange={(event) => setForm({ ...form, platform: event.target.value })}>{LIBRARY_PLATFORMS.filter((item) => item !== 'Hybrid').map((item) => <option key={item}>{item}</option>)}</select></label>
          : <label className="text-sm font-bold">Platform<input className="input mt-2 opacity-70" value={libraryPlatform} disabled /></label>}
        <label className="text-sm font-bold">Object Type<select className="input mt-2" value={form.object_type} onChange={(event) => setForm({ ...form, object_type: event.target.value })}>{OBJECT_TYPES_BY_PLATFORM[libraryPlatform].map((item) => <option key={item}>{item}</option>)}</select></label>
        <label className="text-sm font-bold">Confidence<input className="input mt-2" type="number" min="0" max="100" value={form.confidence} onChange={(event) => setForm({ ...form, confidence: Number(event.target.value) })} /></label>
        <div className="flex items-end gap-2"><button className={primaryButton}>{editingId ? 'Update Object' : 'Add Object'}</button>{editingId ? <button type="button" className={secondaryButton} onClick={cancelEdit}>Cancel</button> : null}</div>
      </form>
      <div className="grid gap-4 xl:grid-cols-[1.5fr_.8fr]">
        <section className="card">
          <div className="mb-4">
            <div className="mb-3 text-sm font-bold text-muted">
              {selectedProduct?.name || 'Product'} / {activeArea}{!isHomeView ? ` / ${activeSubArea}` : ''}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-extrabold text-muted">Product Areas</span>
              <button type="button" className={`${activeArea === 'Home' ? primaryButton : secondaryButton} text-xs`} onClick={() => { setSelectedArea('All'); setSelectedSubArea('All'); }}>Home ({homeCount})</button>
              {navigationAreas.filter((node) => node.area !== 'Home').map((node) => <button key={node.area} type="button" className={`${activeArea === node.area ? primaryButton : secondaryButton} text-xs`} onClick={() => { setSelectedArea(node.area); setSelectedSubArea('All'); }}>{node.area} ({node.count})</button>)}
            </div>
            {isHomeView ? <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {navigationAreas.filter((node) => node.area !== 'Home').map((node) => <button key={node.area} type="button" onClick={() => { setSelectedArea(node.area); setSelectedSubArea('All'); }} className="rounded-lg border border-white/[0.08] bg-white/[0.04] p-4 text-left text-white hover:border-primary hover:bg-white/[0.09] transition-all">
                <strong>{node.area}</strong>
                <p className="mt-1 text-sm text-muted">{node.subAreas.length} sub-areas, {node.count} captured paths</p>
              </button>)}
            </div> : null}
            {!isHomeView && activeAreaNode ? <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {activeAreaNode.subAreas.map((node) => <button key={node.subArea} type="button" onClick={() => setSelectedSubArea(node.subArea)} className={`rounded-lg border p-3 text-left text-white transition-all ${activeSubArea === node.subArea ? 'border-primary bg-blue-500/[0.15]' : 'border-white/[0.08] bg-white/[0.04] hover:bg-white/[0.09]'}`}>
                <strong>{node.subArea}</strong>
                <p className="mt-1 text-sm text-muted">{node.rows.length} paths, fields, buttons, menus, and messages</p>
              </button>)}
            </div> : null}
          </div>
          {isHomeView ? <EmptyState title="Home navigation" body="Choose a product area such as Conflict Repository, Monitoring, or Misc. to view its sub-tabs and captured paths." /> : null}
          {!isHomeView ? <DataTable headers={['Object Name', 'Area', 'Sub Area', 'Platform', 'Object Type', 'Technical Path / Locator', 'Actions', 'Status', 'Confidence']} rows={filteredObjects.map((object) => {
            const hierarchy = sapHierarchy(object, objects);
            return [<button className="font-extrabold text-primary" onClick={() => setSelectedId(object.id)}>{objectName(object)}</button>, <Badge>{hierarchy.area}</Badge>, <Badge>{hierarchy.subArea}</Badge>, <Badge>{object.platform}</Badge>, objectType(object), <code>{locator(object)}</code>, <div className="flex flex-wrap gap-2"><button className={secondaryButton} onClick={() => edit(object)}>Edit</button><button className={secondaryButton} onClick={() => verify(object.id)}>Verify</button><button className={dangerButton} onClick={() => remove(object.id)}>Delete</button></div>, <Badge>{object.status}</Badge>, <Confidence value={Math.round(object.confidence)} />];
          })} /> : null}
          {!platformObjects.length ? <EmptyState title="No repository objects" body={`Add ${libraryPlatform} UI objects before mapping and script generation.`} /> : null}
          {!isHomeView && platformObjects.length && !filteredObjects.length ? <EmptyState title="No paths in this sub-area yet" body="Run the knowledge-guided crawler on this area, then import the crawler JSON to fill this view." /> : null}
        </section>
        <section className="card">
          {selected ? <><h3 className="text-lg font-extrabold">{objectName(selected)}</h3><div className="mt-2 flex flex-wrap gap-2"><Badge>{sapHierarchy(selected, objects).area}</Badge><Badge>{sapHierarchy(selected, objects).subArea}</Badge><Badge>{objectType(selected)}</Badge></div><p className="mt-3 text-muted">{selected.aliases?.join(', ') || 'No aliases yet'}</p><p className="mt-3 break-all"><code>{locator(selected)}</code></p><div className="mt-3 flex flex-wrap gap-2">{actions(selected).map((x) => <Badge key={x}>{x}</Badge>)}</div><p className="mt-4 text-sm text-muted">Last verified: {selected.last_verified || selected.lastVerified || 'Not verified yet'}</p><Confidence value={Math.round(selected.confidence)} /><h4 className="mt-5 font-extrabold">Path change history</h4><div className="mt-2 space-y-2">{selected.path_history?.map((item, index) => <div key={index} className="rounded-xl bg-white/[0.06] border border-white/[0.07] p-3 text-sm text-white"><code>{item.before}</code><br /><code>{item.after}</code></div>)}{!selected.path_history?.length ? <p className="text-muted">No path changes yet.</p> : null}</div></> : <p className="text-muted">Select an object to view details.</p>}
        </section>
      </div>
    </>
  );
}

const emptyEditForm = { external_id: '', title: '', module: '', feature: '', priority: 'Medium', expected_result: '', steps: '' };

type ImportTab = 'AI Generate' | 'Zephyr' | 'Excel' | 'CSV' | 'Jira' | 'Manual paste';

export function TestCaseImport() {
  const { products, productId, setProductId } = useProducts();
  const [cases, setCases] = useState<TestCase[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<ImportTab>('AI Generate');
  const [form, setForm] = useState({ external_id: '', title: '', module: '', feature: '', source: 'Manual', priority: 'Medium', expected_result: '', steps: '' });
  const [editingCase, setEditingCase] = useState<TestCase | null>(null);
  const [deleteCase, setDeleteCase] = useState<TestCase | null>(null);
  const [editForm, setEditForm] = useState(emptyEditForm);
  const [aiCount, setAiCount] = useState(8);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiCoverageSummary, setAiCoverageSummary] = useState('');
  const [screenshotFile, setScreenshotFile] = useState<File | null>(null);
  const [screenshotFileKey, setScreenshotFileKey] = useState(0);
  const [screenshotPrompt, setScreenshotPrompt] = useState('');
  const [screenshotBusy, setScreenshotBusy] = useState(false);
  const [screenshotDetails, setScreenshotDetails] = useState<{ detected: string[]; assumptions: string[] } | null>(null);

  async function refresh() {
    if (!productId) return;
    try {
      setCases(await listTestCases(productId));
    } catch (error) {
      setError(errorMessage(error));
    }
  }

  useEffect(() => {
    void refresh();
  }, [productId]);

  async function submitManual(event: FormEvent) {
    event.preventDefault();
    if (!productId) return;
    try {
      setError('');
      await createTestCase(productId, form);
      setMessage('Manual test case saved');
      setForm({ ...form, external_id: '', title: '', steps: '', expected_result: '' });
      await refresh();
    } catch (error) {
      setError(errorMessage(error));
    }
  }

  async function uploadImport(event: FormEvent) {
    event.preventDefault();
    if (!productId || !file) return;
    try {
      setError('');
      const result = await importTestCases(productId, file);
      setMessage(`Imported ${result.imported} test cases`);
      setFile(null);
      await refresh();
    } catch (error) {
      setError(errorMessage(error));
    }
  }

  async function generateAiSuite() {
    if (!productId) return;
    try {
      setAiBusy(true);
      setError('');
      setMessage('');
      setAiCoverageSummary('');
      const result = await generateTestCaseSuite(productId, aiCount);
      setMessage(`AI generated ${result.generated} end-to-end test case${result.generated === 1 ? '' : 's'}${result.skipped ? `, skipped ${result.skipped}` : ''}.`);
      setAiCoverageSummary(result.coverage_summary || '');
      await refresh();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setAiBusy(false);
    }
  }

  async function generateFromScreenshot(event: FormEvent) {
    event.preventDefault();
    if (!productId || !screenshotFile || !screenshotPrompt.trim()) return;
    try {
      setScreenshotBusy(true);
      setError('');
      setMessage('');
      setScreenshotDetails(null);
      const result = await generateTestCaseFromScreenshot(productId, screenshotFile, screenshotPrompt.trim());
      setMessage(`Generated ${result.test_case?.external_id || 'a test case'} from the screenshot.`);
      setScreenshotDetails({ detected: result.detected_elements || [], assumptions: result.assumptions || [] });
      setScreenshotFile(null);
      setScreenshotFileKey((value) => value + 1);
      setScreenshotPrompt('');
      await refresh();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setScreenshotBusy(false);
    }
  }

  function openEdit(tc: TestCase) {
    setEditForm({
      external_id: testCaseExternalId(tc),
      title: tc.title || '',
      module: tc.module || '',
      feature: tc.feature || '',
      priority: tc.priority || 'Medium',
      expected_result: expectedResult(tc),
      steps: (tc.step_items || []).map((s) => s.instruction).join('\n'),
    });
    setEditingCase(tc);
    setError('');
  }

  async function submitEdit(event: FormEvent) {
    event.preventDefault();
    if (!editingCase) return;
    try {
      setError('');
      await updateTestCase(editingCase.id, editForm);
      setMessage('Test case updated');
      setEditingCase(null);
      await refresh();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function analyze(id: number) {
    try {
      setError('');
      await analyzeTestCase(id);
      setMessage('Test case analyzed');
      await refresh();
    } catch (error) {
      setError(errorMessage(error));
    }
  }

  async function map(id: number) {
    try {
      setError('');
      await mapTestSteps(id);
      setMessage('Step mapping generated');
      await refresh();
    } catch (error) {
      setError(errorMessage(error));
    }
  }

  async function confirmDeleteTestCase() {
    if (!deleteCase) return;
    const label = testCaseExternalId(deleteCase) || deleteCase.title || `test case ${deleteCase.id}`;
    try {
      await deleteTestCase(deleteCase.id);
      setMessage(`Deleted test case ${label}`);
      setError('');
      if (editingCase?.id === deleteCase.id) {
        setEditingCase(null);
      }
      setDeleteCase(null);
      await refresh();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const editFields: [keyof typeof emptyEditForm, string][] = [
    ['external_id', 'Test Case ID'],
    ['title', 'Title'],
    ['module', 'Module'],
    ['feature', 'Feature'],
    ['priority', 'Priority'],
    ['expected_result', 'Expected Result'],
  ];

  return (
    <>
      <PageHeader title="Test Case Import" subtitle="Import from Zephyr, Excel, CSV, Jira, or create manually." actions={<><ProductPicker products={products} productId={productId} setProductId={setProductId} /><Link className={primaryButton} to="/mapping">Start AI Mapping</Link></>} />
      <Notice message={message} error={error} />
      {/* Import source tabs */}
      <div className="mb-4 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        {(['AI Generate', 'Zephyr', 'Excel', 'CSV', 'Jira', 'Manual paste'] as ImportTab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => { setActiveTab(tab); setMessage(''); setError(''); }}
            className="card text-left font-extrabold transition-all"
            style={activeTab === tab ? {
              borderColor: 'var(--blue)',
              background: 'rgba(41,151,255,0.12)',
              color: '#fff',
              boxShadow: '0 0 0 1px rgba(41,151,255,0.35)',
            } : { color: 'rgba(255,255,255,0.5)' }}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[.9fr_1.2fr]">
        <section className="card">
          {/* AI Generate tab */}
          {activeTab === 'AI Generate' && <>
            <h3 className="font-extrabold">AI End-to-End Test Case Writer</h3>
            <p className="mt-1 text-sm text-muted">TestPilot Agent reads this product's processed knowledge and writes complete, ready-to-map end-to-end test cases — covering primary flows, validations, and expected messages — grounded only in what's documented.</p>
            <p className="mt-1 text-sm font-medium text-white/55">Requires product knowledge to be processed first (Knowledge Base page). Existing test case titles are skipped so re-running adds new coverage instead of duplicates.</p>
            <div className="mt-4 flex flex-col gap-3">
              <label className="text-sm font-bold">How many test cases<input className="input mt-2" type="number" min={1} max={15} value={aiCount} onChange={(event) => setAiCount(Number(event.target.value) || 1)} /></label>
              <button type="button" className={primaryButton} disabled={!productId || aiBusy} onClick={generateAiSuite}>{aiBusy ? 'Writing test cases…' : 'Generate End-to-End Test Cases'}</button>
              <Link className={secondaryButton} to="/knowledge">Open Knowledge Base</Link>
            </div>
            {aiCoverageSummary ? <div className="mt-4 rounded-xl bg-white/[0.06] border border-white/[0.07] p-4 text-sm text-white">{aiCoverageSummary}</div> : null}

            <hr className="my-5 border-white/[0.08]" />

            <h3 className="font-extrabold">Or Generate From a Screenshot</h3>
            <p className="mt-1 text-sm text-muted">Upload a screenshot of any screen and describe it in one line (e.g. "its a login screen") — the local vision model looks at the image and writes a complete end-to-end test case from what it sees.</p>
            <p className="mt-1 text-sm font-medium text-white/55">Runs on a local vision model — nothing leaves this machine. Requires a one-time setup: <code>scripts/setup-local-ai.ps1 -WithVision</code>.</p>
            <form className="mt-4 flex flex-col gap-3" onSubmit={generateFromScreenshot}>
              <input key={screenshotFileKey} className="input" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => setScreenshotFile(event.target.files?.[0] || null)} />
              <input className="input" value={screenshotPrompt} onChange={(event) => setScreenshotPrompt(event.target.value)} placeholder='Describe the screen, e.g. "its a login screen"' />
              <button className={primaryButton} disabled={!productId || !screenshotFile || !screenshotPrompt.trim() || screenshotBusy}>{screenshotBusy ? 'Analysing screenshot…' : 'Generate Test Case From Screenshot'}</button>
            </form>
            {screenshotDetails ? <div className="mt-4 rounded-xl bg-white/[0.06] border border-white/[0.07] p-4 text-sm text-white">
              {screenshotDetails.detected.length ? <p><strong>Detected elements:</strong> {screenshotDetails.detected.join(', ')}</p> : null}
              {screenshotDetails.assumptions.length ? <p className="mt-2"><strong>Assumptions:</strong> {screenshotDetails.assumptions.join(', ')}</p> : null}
            </div> : null}
          </>}

          {/* CSV / Excel tab */}
          {(activeTab === 'CSV' || activeTab === 'Excel') && <>
            <h3 className="font-extrabold">Import {activeTab === 'Excel' ? 'Excel (XLSX)' : 'CSV'}</h3>
            <p className="mt-1 text-sm text-muted">Upload a {activeTab === 'Excel' ? '.xlsx' : '.csv'} file with columns: Test Case ID, Title, Module, Feature, Steps, Expected Result, Priority, Source. Steps can be multiple lines within one cell — each line becomes one step.</p>
            <button type="button" className={`${secondaryButton} mt-3`} onClick={() => void downloadTestCaseImportTemplate()}>Download Excel Template</button>
            <form className="mt-4 flex flex-col gap-3" onSubmit={uploadImport}>
              <input className="input" type="file" accept={activeTab === 'Excel' ? '.xlsx,.xls' : '.csv'} onChange={(event) => setFile(event.target.files?.[0] || null)} />
              <button className={primaryButton} disabled={!file}>Import Test Cases</button>
            </form>
          </>}

          {/* Zephyr tab */}
          {activeTab === 'Zephyr' && <>
            <h3 className="font-extrabold">Import from Zephyr Scale</h3>
            <p className="mt-1 text-sm text-muted">Pulls all test cases from your configured Zephyr project. Make sure Zephyr credentials are set in Integrations first.</p>
            <div className="mt-4 flex flex-col gap-3">
              <button className={primaryButton} disabled={!productId} onClick={async () => {
                if (!productId) return;
                try { await importProductZephyr(productId); setMessage('Zephyr import started — refresh in a moment.'); await refresh(); }
                catch (err) { setError(errorMessage(err)); }
              }}>Pull from Zephyr</button>
              <Link className={secondaryButton} to="/integrations">Configure Zephyr Credentials</Link>
            </div>
          </>}

          {/* Jira tab */}
          {activeTab === 'Jira' && <>
            <h3 className="font-extrabold">Import from Jira</h3>
            <p className="mt-1 text-sm text-muted">Connect your Jira project to pull issues as test cases. Configure your Jira API token and project key in Integrations settings.</p>
            <div className="mt-4 flex flex-col gap-3">
              <Link className={primaryButton} to="/integrations">Go to Integrations</Link>
              <p className="text-xs text-muted">After configuring, return here and switch to CSV to import exported Jira tickets.</p>
            </div>
          </>}

          {/* Manual paste tab */}
          {activeTab === 'Manual paste' && <>
            <h3 className="font-extrabold">Manual Test Case</h3>
            <form className="mt-3 grid gap-3" onSubmit={submitManual}>
              {[
                ['external_id', 'Test Case ID'],
                ['title', 'Title'],
                ['module', 'Module'],
                ['feature', 'Feature'],
                ['expected_result', 'Expected Result']
              ].map(([key, label]) => <label key={key} className="text-sm font-bold">{label}<input className="input mt-2" value={form[key as keyof typeof form]} onChange={(event) => setForm({ ...form, [key]: event.target.value })} required={['external_id', 'title'].includes(key)} /></label>)}
              <label className="text-sm font-bold">Steps<textarea className="input mt-2 min-h-28" value={form.steps} onChange={(event) => setForm({ ...form, steps: event.target.value })} placeholder="One step per line" /></label>
              <button className={primaryButton}>Create Test Case</button>
            </form>
          </>}
        </section>
        <section className="card">
          <DataTable
            headers={['Test Case', 'Readiness', 'Actions']}
            rows={cases.map((testCase) => [
              <div className="min-w-56">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-extrabold uppercase text-muted">{testCaseExternalId(testCase)}</span>
                  <Badge>{testCase.status}</Badge>
                  <Badge>{testCase.source || 'Manual'}</Badge>
                </div>
                <p className="mt-1 max-w-sm font-extrabold text-ink">{testCase.title}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Badge>{testCase.module || 'No module'}</Badge>
                  <Badge>{testCase.feature || 'No feature'}</Badge>
                </div>
                <p className="mt-2 max-w-md text-sm text-muted">{expectedResult(testCase) || 'No expected result captured yet.'}</p>
              </div>,
              <div className="min-w-36">
                <p className="mb-2 text-xs font-extrabold text-muted">{testCase.steps || 0} steps</p>
                <ProgressBar value={Math.round(testCase.readiness || 0)} />
              </div>,
              <div className="grid min-w-36 grid-cols-2 gap-1.5">
                <button className={compactButton} onClick={() => openEdit(testCase)}>Edit</button>
                <button className={compactButton} onClick={() => analyze(testCase.id)}>Analyze</button>
                <button className={compactPrimaryButton} onClick={() => map(testCase.id)}>Map</button>
                <button className={compactDangerButton} onClick={() => setDeleteCase(testCase)}>Delete</button>
              </div>
            ])}
          />
          {!cases.length ? <EmptyState title="No test cases yet" body="Import CSV/XLSX or create a manual test case." /> : null}
        </section>
      </div>

      {editingCase && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-[rgba(28,28,30,0.98)] border border-white/[0.1] shadow-2xl text-white">
            <div className="flex items-center justify-between border-b border-line px-6 py-4">
              <h2 className="text-lg font-extrabold">Edit Test Case</h2>
              <button className={secondaryButton} onClick={() => setEditingCase(null)}>✕ Close</button>
            </div>
            <form className="grid gap-3 px-6 py-5" onSubmit={submitEdit}>
              {editFields.map(([key, label]) => (
                <label key={key} className="text-sm font-bold">
                  {label}
                  <input
                    className="input mt-1"
                    value={editForm[key]}
                    onChange={(e) => setEditForm({ ...editForm, [key]: e.target.value })}
                    required={['external_id', 'title'].includes(key)}
                  />
                </label>
              ))}
              <label className="text-sm font-bold">
                Steps
                <textarea
                  className="input mt-1 min-h-32"
                  value={editForm.steps}
                  onChange={(e) => setEditForm({ ...editForm, steps: e.target.value })}
                  placeholder="One step per line"
                />
              </label>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" className={secondaryButton} onClick={() => setEditingCase(null)}>Cancel</button>
                <button type="submit" className={primaryButton}>Save Changes</button>
              </div>
            </form>
          </div>
        </div>
      )}
      {deleteCase && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-md rounded-xl border border-red-500/[0.3] bg-[rgba(28,28,30,0.98)] shadow-2xl text-white">
            <div className="border-b border-red-500/[0.2] px-6 py-4">
              <p className="text-xs font-extrabold uppercase text-red-600">Delete test case</p>
              <h2 className="mt-1 text-lg font-extrabold text-ink">{testCaseExternalId(deleteCase)}</h2>
            </div>
            <div className="px-6 py-5">
              <p className="font-bold text-ink">{deleteCase.title}</p>
              <p className="mt-2 text-sm text-muted">This will remove the test case, its steps, and its mappings from the selected product.</p>
            </div>
            <div className="flex justify-end gap-3 border-t border-line px-6 py-4">
              <button className={secondaryButton} onClick={() => setDeleteCase(null)}>Cancel</button>
              <button className={dangerButton} onClick={confirmDeleteTestCase}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function AiMapping() {
  const { products, productId, setProductId } = useProducts();
  const [cases, setCases] = useState<TestCase[]>([]);
  const [selectedId, setSelectedId] = useState<number>(0);
  const [mappings, setMappings] = useState<MappingRow[]>([]);
  const [summary, setSummary] = useState<KnowledgeSummary>(emptySummary);
  const [objects, setObjects] = useState<RepositoryObject[]>([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const selected = cases.find((testCase) => testCase.id === selectedId) || cases[0];
  const mapped = mappings.filter((mapping) => ['mapped', 'approved'].includes(mapping.status)).length;
  const unmapped = mappings.filter((mapping) => mapping.status === 'unmapped').length;
  const overall = mappings.length ? Math.round(mappings.reduce((sum, row) => sum + row.confidence, 0) / mappings.length) : 0;

  async function refreshCases() {
    if (!productId) return;
    const [caseRows, knowledge, objectRows] = await Promise.all([listTestCases(productId), getKnowledgeSummary(productId), listObjects(productId)]);
    setCases(caseRows);
    setSummary(knowledge);
    setObjects(objectRows);
    setSelectedId((current) => caseRows.some((row) => row.id === current) ? current : caseRows[0]?.id || 0);
  }

  async function refreshMappings(id = selected?.id) {
    if (!id) return;
    setMappings(await listMappings(id));
  }

  useEffect(() => {
    refreshCases().catch((error) => setError(errorMessage(error)));
  }, [productId]);

  useEffect(() => {
    void refreshMappings(selected?.id);
  }, [selected?.id]);

  async function analyzeAndMap() {
    if (!selected) return;
    try {
      await analyzeTestCase(selected.id);
      const result = await mapTestSteps(selected.id);
      setMappings(result.mappings);
      setMessage('Analysis and mapping generated');
      await refreshCases();
    } catch (error) {
      setError(errorMessage(error));
    }
  }

  async function approveAll() {
    try {
      setError('');
      const results = await Promise.allSettled(mappings.map((mapping) => approveMapping(mapping.id)));
      const failed = results.filter((result) => result.status === 'rejected').length;
      setMessage(failed ? `Approved ${results.length - failed} mapping(s); ${failed} failed` : 'All mappings approved');
      await refreshMappings();
    } catch (error) {
      setError(errorMessage(error));
    }
  }

  async function regenerate(id: number) {
    try {
      setError('');
      await regenerateMapping(id);
      await refreshMappings();
    } catch (error) {
      setError(errorMessage(error));
    }
  }

  async function reject(id: number) {
    try {
      setError('');
      await rejectMapping(id);
      await refreshMappings();
    } catch (error) {
      setError(errorMessage(error));
    }
  }

  return (
    <>
      <PageHeader title="AI Automation Mapping" subtitle="Manual Step -> AI Understanding -> Mapped Object -> Automation Action -> Confidence -> Status." actions={<><ProductPicker products={products} productId={productId} setProductId={setProductId} /><button className={secondaryButton} onClick={analyzeAndMap}>Analyze + Map</button><button className={primaryButton} onClick={approveAll} disabled={!mappings.length}>Approve Mapping</button><Link className={secondaryButton} to="/scripts">Send to Script Generator</Link></>} />
      <Notice message={message} error={error} />
      {(summary.readiness < 60 || !objects.length) ? <ApprovalModal title="Readiness Warning" body="Script generation is blocked until at least one knowledge source is processed, repository objects exist, and mappings are approved or high confidence." /> : null}
      <section className="card mt-4">
        <div className="mb-4 grid gap-4 md:grid-cols-4">
          <label className="text-sm font-bold md:col-span-2">Test Case<select className="input mt-2" value={selected?.id || ''} onChange={(event) => setSelectedId(Number(event.target.value))}>{cases.map((testCase) => <option key={testCase.id} value={testCase.id}>{testCaseExternalId(testCase)} - {testCase.title}</option>)}</select></label>
          <KpiCard label="Overall Confidence" value={`${overall}%`} detail="Average step mapping" />
          <KpiCard label="Mapped / Unmapped" value={`${mapped}/${unmapped}`} detail={`${mappings.length} total steps`} />
        </div>
        <DataTable headers={['Manual Step', 'AI Understanding', 'Mapped Object', 'Automation Action', 'Confidence', 'Status', 'Actions']} rows={mappings.map((row) => [mappingManual(row), mappingUnderstanding(row), mappingObject(row), <code>{mappingAction(row)}</code>, <Confidence value={Math.round(row.confidence)} />, <Badge>{row.status}</Badge>, <div className="flex flex-wrap gap-2"><button className={primaryButton} onClick={() => approveMapping(row.id).then(() => refreshMappings()).catch((error) => setError(errorMessage(error)))}>Approve</button><button className={secondaryButton} onClick={() => regenerate(row.id)}>Regenerate</button><button className={dangerButton} onClick={() => reject(row.id)}>Reject</button></div>])} />
        {!mappings.length ? <EmptyState title="No mappings yet" body="Select a test case and run Analyze + Map." /> : null}
      </section>
    </>
  );
}

export function ScriptGenerator() {
  const { products, productId, setProductId } = useProducts();
  const navigate = useNavigate();
  const [cases, setCases] = useState<TestCase[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState(0);
  const [scripts, setScripts] = useState<GeneratedScript[]>([]);
  const [selectedScriptId, setSelectedScriptId] = useState(0);
  const [framework, setFramework] = useState('SAP_GUI_VBSCRIPT');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [riskAccepted, setRiskAccepted] = useState(false);
  const selectedScript = scripts.find((script) => script.id === selectedScriptId) || scripts[0];

  async function refreshCases() {
    if (!productId) return;
    const rows = await listTestCases(productId);
    setCases(rows);
    setSelectedCaseId((current) => rows.some((row) => row.id === current) ? current : rows[0]?.id || 0);
    if (!rows.length) {
      setScripts([]);
      setSelectedScriptId(0);
    }
  }

  async function refreshScripts(id = selectedCaseId) {
    if (!id) {
      setScripts([]);
      setSelectedScriptId(0);
      return;
    }
    const rows = await listScripts(id);
    setScripts(rows);
    setSelectedScriptId((current) => rows.some((row) => row.id === current) ? current : rows[0]?.id || 0);
  }

  useEffect(() => {
    refreshCases().catch((error) => setError(errorMessage(error)));
  }, [productId]);

  useEffect(() => {
    void refreshScripts(selectedCaseId);
  }, [selectedCaseId]);

  async function generate() {
    try {
      setError('');
      const script = await generateScript(selectedCaseId, framework);
      if ('blocked' in script) {
        setError(`Script generation blocked: ${(script.reasons || []).join('; ')}. Next: ${(script.next_actions || []).join('; ')}`);
        return;
      }
      setMessage(`Generated ${script.file_name || script.fileName}`);
      setSelectedScriptId(script.id);
      await refreshScripts(selectedCaseId);
    } catch (error) {
      setError(errorMessage(error));
    }
  }

  async function review() {
    if (!selectedScript) return;
    try {
      setError('');
      await reviewScript(selectedScript.id);
      setMessage('Script reviewed by TestPilot Agent');
      await refreshScripts(selectedCaseId);
    } catch (error) {
      setError(errorMessage(error));
    }
  }

  async function approveCurrentScript() {
    if (!selectedScript || !riskAccepted) return;
    try {
      await decideScriptReview(selectedScript.id, 'approve_current');
      setRiskAccepted(false);
      setMessage('Current script approved by the user. The AI findings remain recorded in history.');
      setError('');
      await refreshScripts(selectedCaseId);
    } catch (error) {
      setError(errorMessage(error));
    }
  }

  async function run() {
    if (!selectedScript) return;
    try {
      const run = await executeScript(selectedScript.id);
      const executionMessage = run.status === 'READY_TO_RUN'
        ? 'Execution request created. Local runner is disabled in safe mode, so TestPilot queued the command and evidence placeholders for review.'
        : `Execution created with status ${run.status}.`;
      navigate('/execution', { state: { executionMessage } });
    } catch (error) {
      setError(errorMessage(error));
    }
  }

  const reviewRecommendation = String(selectedScript?.review_json?.approval_recommendation || '').toLowerCase();
  const canRun = Boolean(selectedScript && (selectedScript.review_status === 'USER_APPROVED' || ((selectedScript.review_status === 'AI_REVIEWED') && ['approve', 'approved', 'pass', 'passed', 'ready', 'ready_to_run'].includes(reviewRecommendation.replaceAll(' ', '_')))));
  const reviewIssues = selectedScript ? [
    ...(Array.isArray(selectedScript.review_json?.issues) ? selectedScript.review_json.issues : []),
    ...(Array.isArray(selectedScript.review_json?.risk_warnings) ? selectedScript.review_json.risk_warnings : []),
    ...(Array.isArray(selectedScript.review_json?.testpilot_validation_issues) ? selectedScript.review_json.testpilot_validation_issues : [])
  ].map(String) : [];

  return (
    <>
      <PageHeader title="Script Generator" subtitle="Generate and review framework-specific scripts after mapping approval." actions={<><ProductPicker products={products} productId={productId} setProductId={setProductId} /><button className={primaryButton} onClick={generate} disabled={!selectedCaseId}>Generate Script</button><button className={secondaryButton} onClick={review} disabled={!selectedScript}>Review with AI</button><button className={secondaryButton} onClick={run} disabled={!canRun} title={canRun ? 'Run this approved script' : 'AI review must approve the script before execution'}>Run Test</button>{selectedScript ? <a className={secondaryButton} href={scriptDownloadUrl(selectedScript.id)}>Download Script</a> : null}</>} />
      <Notice message={message} error={error} />
      <div className="mb-4 grid gap-4 xl:grid-cols-3">{['SAP_GUI_VBSCRIPT', 'SELENIUM_JAVA', 'PLAYWRIGHT', 'CUCUMBER', 'DESKTOP', 'HYBRID'].map((item) => <button key={item} onClick={() => setFramework(item)} className={`card text-left transition-all ${framework === item ? 'border-primary bg-blue-500/[0.15]' : 'hover:border-white/[0.18]'}`}><h3 className="font-extrabold">{item.replaceAll('_', ' ')}</h3><p className="text-sm text-muted">Backend script template available.</p></button>)}</div>
      <section className="card">
        <div className="mb-3 grid gap-3 md:grid-cols-2">
          <label className="text-sm font-bold">Test Case<select className="input mt-2" value={selectedCaseId || ''} onChange={(event) => setSelectedCaseId(Number(event.target.value))}>{cases.map((testCase) => <option key={testCase.id} value={testCase.id}>{testCaseExternalId(testCase)} - {testCase.title}</option>)}</select></label>
          <label className="text-sm font-bold">Generated Script<select className="input mt-2" value={selectedScript?.id || ''} onChange={(event) => setSelectedScriptId(Number(event.target.value))}>{scripts.map((script) => <option key={script.id} value={script.id}>{script.file_name || script.fileName}</option>)}</select></label>
        </div>
        {selectedScript ? <><p className="mb-3 text-sm text-muted">Command: <code>{selectedScript.command}</code> | Review: <Badge>{selectedScript.review_status || 'Draft'}</Badge> | Execution: <Badge>{canRun ? 'READY' : 'BLOCKED'}</Badge></p>{!canRun ? <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"><p className="font-extrabold">AI review is advisory. You decide what happens next.</p><p className="mt-1">Review the findings, ask AI to review again, or explicitly approve the current script unchanged. Objective locator and test-data validation failures cannot be overridden.</p>{reviewIssues.length ? <ul className="mt-3 list-disc space-y-1 pl-5">{reviewIssues.slice(0, 6).map((issue, index) => <li key={`${issue}-${index}`}>{issue}</li>)}</ul> : null}<label className="mt-4 flex items-start gap-2 font-semibold"><input className="mt-1" type="checkbox" checked={riskAccepted} onChange={(event) => setRiskAccepted(event.target.checked)} /><span>I reviewed the AI findings and accept responsibility for using the current script without AI changes.</span></label><div className="mt-3 flex flex-wrap gap-2"><button type="button" className={primaryButton} disabled={!riskAccepted} onClick={approveCurrentScript}>Approve Current Script</button><button type="button" className={secondaryButton} onClick={review}>Review Again with AI</button><button type="button" className={secondaryButton} onClick={generate}>Regenerate from Approved Mappings</button></div></div> : null}<CodeBlock code={selectedScript.code} /></> : <EmptyState title="No generated scripts" body="Generate a script after knowledge, library, mapping, and approval gates are ready." />}
      </section>
    </>
  );
}

export function ExecutionCenter() {
  const { products, productId, setProductId } = useProducts();
  const location = useLocation();
  const [executions, setExecutions] = useState<ExecutionRun[]>([]);
  const [analysis, setAnalysis] = useState<Record<string, unknown> | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [runningId, setRunningId] = useState<number | null>(null);
  const [selectedExecutionId, setSelectedExecutionId] = useState<number | null>(null);

  useEffect(() => {
    const nextMessage = (location.state as { executionMessage?: string } | null)?.executionMessage || '';
    setMessage(nextMessage);
  }, [location.state]);

  async function refresh() {
    if (!productId) return;
    try {
      const rows = await listExecutions(productId);
      setExecutions(rows);
      setSelectedExecutionId((current) => (current && rows.some((run) => run.id === current) ? current : rows[0]?.id ?? null));
    } catch (error) {
      setError(errorMessage(error));
    }
  }

  useEffect(() => {
    void refresh();
  }, [productId]);

  async function analyze(id: number) {
    try {
      setAnalysis(await analyzeFailure(id));
    } catch (error) {
      setError(errorMessage(error));
    }
  }

  async function runReady(id: number) {
    setRunningId(id);
    setError('');
    try {
      const result = await runExecution(id);
      setMessage(`Execution ${id} finished with status ${result.status}.`);
      await refresh();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setRunningId(null);
    }
  }

  const selectedExecution = executions.find((run) => run.id === selectedExecutionId) || executions[0];

  return (
    <>
      <PageHeader title="Execution Center" subtitle="Execution summary, live runs, step-level progress, logs, evidence, and failure analysis." actions={<><ProductPicker products={products} productId={productId} setProductId={setProductId} /><button className={secondaryButton} onClick={refresh}>Refresh</button></>} />
      <Notice message={message} error={error} />
      <div className="grid gap-4 xl:grid-cols-5">{[['Executions', executions.length, 'Requests'], ['Ready', executions.filter((run) => run.status === 'READY_TO_RUN').length, 'Awaiting Run Now'], ['Completed', executions.filter((run) => run.status === 'COMPLETED').length, 'Local runner'], ['Failed', executions.filter((run) => run.status === 'FAILED').length, 'Needs analysis'], ['Blocked', executions.filter((run) => run.status === 'BLOCKED').length, 'Safety gate']].map(([a, b, c]) => <KpiCard key={String(a)} label={String(a)} value={String(b)} detail={String(c)} />)}</div>
      <div className="mt-4 grid gap-4 xl:grid-cols-[1.4fr_.8fr]">
        <section className="card overflow-hidden p-0">
          {!executions.length
            ? <div className="p-6"><EmptyState title="No executions" body="Generate a script and click Run Test to create a safe execution request." /></div>
            : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/[0.08] bg-white/[0.05] text-[11px] font-bold uppercase tracking-wide text-white/40">
                    <th className="px-4 py-3 text-left">Execution</th>
                    <th className="px-4 py-3 text-left">Script</th>
                    <th className="px-4 py-3 text-left">Status</th>
                    <th className="px-4 py-3 text-left">Command</th>
                    <th className="px-4 py-3 text-left">Evidence</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.06]">
                  {executions.map((run) => (
                    <tr
                      key={run.id}
                      className={`cursor-pointer hover:bg-white/[0.05] ${selectedExecutionId === run.id ? 'bg-blue-500/[0.12]' : ''}`}
                      onClick={() => setSelectedExecutionId(run.id)}
                    >
                      <td className="px-4 py-2.5 font-semibold text-white">{run.id}</td>
                      <td className="px-4 py-2.5 text-white/65">{run.script_id}</td>
                      <td className="px-4 py-2.5"><Badge>{run.status}</Badge></td>
                      <td className="px-4 py-2.5 max-w-[160px]"><code className="block truncate text-xs" title={run.command}>{run.command}</code></td>
                      <td className="px-4 py-2.5 max-w-[200px]"><span className="block truncate text-xs text-white/40" title={run.evidence_path || ''}>{run.evidence_path || 'pending'}</span></td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-end gap-2" onClick={(event) => event.stopPropagation()}>
                          {(run.status === 'READY_TO_RUN' || run.status === 'FAILED') && (
                            <button className="btn btn-primary whitespace-nowrap text-xs px-3 py-1.5" disabled={runningId === run.id} onClick={() => runReady(run.id)}>
                              {runningId === run.id ? 'Running…' : 'Run Now'}
                            </button>
                          )}
                          <button className="btn whitespace-nowrap text-xs px-3 py-1.5" onClick={() => { setSelectedExecutionId(run.id); void analyze(run.id); }}>Analyze</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          }
        </section>
        <section className="card">
          <h3 className="font-extrabold">Logs and Failure Analysis</h3>
          <p className="mt-1 text-xs font-bold uppercase tracking-wide text-white/40">{selectedExecution ? `Execution ${selectedExecution.id} — Script ${selectedExecution.script_id} — ${selectedExecution.status}` : 'Select an execution row to view its logs'}</p>
          {selectedExecution?.step_results?.length ? (
            <div className="mt-3 space-y-1.5">
              {selectedExecution.step_results.map((step) => {
                const icon = step.status === 'COMPLETED' ? '✅' : step.status === 'FAILED' ? '❌' : '⏭️';
                const tone = step.status === 'COMPLETED' ? 'border-emerald-500/25 bg-emerald-500/[0.06]' : step.status === 'FAILED' ? 'border-red-500/25 bg-red-500/[0.06]' : 'border-white/[0.07] bg-white/[0.03]';
                return (
                  <div key={step.order} className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${tone}`}>
                    <span className="text-base leading-none">{icon}</span>
                    <div className="flex-1">
                      <span className="font-bold text-white">Step {step.order}:</span>
                      <span className="ml-1.5 text-white">{step.instruction || step.action}</span>
                      <span className="ml-2 rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white/40">{step.action}</span>
                      {step.message ? <p className="mt-0.5 text-xs text-white/45">{step.message}</p> : null}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
          <CodeBlock code={(selectedExecution?.logs || ['No logs yet.']).join('\n')} />
          {analysis ? <div className="mt-4 rounded-xl bg-white/[0.06] border border-white/[0.07] p-3 text-sm text-white"><strong>AI Failure Analysis</strong><pre className="mt-2 whitespace-pre-wrap">{JSON.stringify(analysis, null, 2)}</pre></div> : null}
        </section>
      </div>
    </>
  );
}

export function AutoHeal() {
  const { products, productId, setProductId } = useProducts();
  const [objects, setObjects] = useState<RepositoryObject[]>([]);
  const [suggestions, setSuggestions] = useState<AutoHealSuggestion[]>([]);
  const [selectedObjectId, setSelectedObjectId] = useState(0);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function refresh() {
    if (!productId) return;
    const [objectRows, suggestionRows] = await Promise.all([listObjects(productId), listAutoHeal(productId)]);
    setObjects(objectRows);
    setSuggestions(suggestionRows);
    setSelectedObjectId((current) => objectRows.some((row) => row.id === current) ? current : objectRows[0]?.id || 0);
  }

  useEffect(() => {
    refresh().catch((error) => setError(errorMessage(error)));
  }, [productId]);

  async function suggest() {
    if (!productId) return;
    try {
      setError('');
      await suggestAutoHeal(productId, { object_id: selectedObjectId || undefined });
      setMessage('Auto-heal suggestion created');
      await refresh();
    } catch (error) {
      setError(errorMessage(error));
    }
  }

  async function approve(id: number) {
    try {
      setError('');
      await approveAutoHeal(id);
      setMessage('Auto-heal approved and object path updated');
      await refresh();
    } catch (error) {
      setError(errorMessage(error));
    }
  }

  async function reject(id: number) {
    try {
      setError('');
      await rejectAutoHeal(id);
      setMessage('Auto-heal rejected');
      await refresh();
    } catch (error) {
      setError(errorMessage(error));
    }
  }

  function pathTail(path: string, chars = 42): string {
    if (!path) return '—';
    return path.length > chars ? '…' + path.slice(-chars) : path;
  }

  return (
    <>
      <PageHeader
        title="Auto Heal Center"
        subtitle="Review AI-suggested fixes before updating the object repository."
        actions={
          <>
            <ProductPicker products={products} productId={productId} setProductId={setProductId} />
            <select className="input w-56" value={selectedObjectId || ''} onChange={(e) => setSelectedObjectId(Number(e.target.value))}>
              {objects.map((o) => <option key={o.id} value={o.id}>{objectName(o)}</option>)}
            </select>
            <button className={primaryButton} onClick={suggest}>Suggest Heal</button>
          </>
        }
      />
      <Notice message={message} error={error} />

      {!suggestions.length
        ? <section className="card"><EmptyState title="No auto-heal suggestions" body="Request a suggestion from a failed or unstable object path." /></section>
        : (
          <section className="card overflow-hidden p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.08] bg-white/[0.05] text-[11px] font-bold uppercase tracking-wide text-white/40">
                  <th className="px-4 py-3 text-left">Object</th>
                  <th className="px-4 py-3 text-left">Platform</th>
                  <th className="px-4 py-3 text-left">Path Change</th>
                  <th className="px-4 py-3 text-left">Reason</th>
                  <th className="px-4 py-3 text-center">Conf.</th>
                  <th className="px-4 py-3 text-center">Status</th>
                  <th className="px-4 py-3 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06]">
                {suggestions.map((row) => (
                  <tr key={row.id} className="hover:bg-white/[0.05]">
                    <td className="px-4 py-2.5 font-semibold text-white whitespace-nowrap text-white">{row.object}</td>
                    <td className="px-4 py-2.5"><Badge>{row.platform}</Badge></td>
                    <td className="px-4 py-2.5 max-w-xs">
                      <div className="flex flex-col gap-1">
                        <code title={row.old_path} className="block rounded bg-red-500/[0.12] px-2 py-0.5 text-[11px] text-red-400 leading-tight truncate">
                          {pathTail(row.old_path)}
                        </code>
                        <code title={row.suggested_path} className="block rounded bg-green-50 px-2 py-0.5 text-[11px] text-green-700 leading-tight truncate">
                          {pathTail(row.suggested_path)}
                        </code>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 max-w-[220px]">
                      <span title={row.reason} className="block truncate text-white/55 text-xs">{row.reason}</span>
                    </td>
                    <td className="px-4 py-2.5 text-center"><Confidence value={Math.round(row.confidence)} /></td>
                    <td className="px-4 py-2.5 text-center"><Badge>{row.status}</Badge></td>
                    <td className="px-4 py-2.5">
                      <div className="flex gap-2 justify-center">
                        <button className={successButton} onClick={() => approve(row.id)}>Approve</button>
                        <button className={dangerButton} onClick={() => reject(row.id)}>Reject</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )
      }
    </>
  );
}

export function Integrations() {
  const { productId } = useProducts();
  const [integrations, setIntegrations] = useState<Array<Record<string, unknown>>>([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [form, setForm] = useState({ jira_base_url: '', project_key: '', zephyr_token: '', cycle_name: '', folder: '', environment: 'QA' });

  async function refresh() {
    if (!productId) return;
    setIntegrations(await listProductIntegrations(productId));
  }

  useEffect(() => {
    refresh().catch((error) => setError(errorMessage(error)));
  }, [productId]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!productId) return;
    try {
      await saveProductZephyrConfig(productId, form);
      setMessage('Integration config saved');
      await refresh();
    } catch (error) {
      setError(errorMessage(error));
    }
  }

  return (
    <>
      <PageHeader title="Zephyr / Jira Integration" subtitle="Configure sync, import tests, export results, attach logs, and create defects." actions={<><button className={secondaryButton} onClick={() => productId && importProductZephyr(productId).then(() => setMessage('Zephyr import queued')).catch((error) => setError(errorMessage(error)))}>Import Test Cases</button><button className={secondaryButton} onClick={() => productId && exportProductZephyrResults(productId).then(() => setMessage('Execution export queued')).catch((error) => setError(errorMessage(error)))}>Export Results</button></>} />
      <Notice message={message} error={error} />
      <div className="grid gap-4 xl:grid-cols-[1.3fr_.8fr]">
        <form className="card grid gap-4 md:grid-cols-2" onSubmit={save}>{Object.entries({ jira_base_url: 'Jira Base URL', project_key: 'Project Key', zephyr_token: 'Zephyr Token placeholder', cycle_name: 'Cycle Name', folder: 'Folder', environment: 'Environment' }).map(([key, label]) => <label key={key} className="text-sm font-bold">{label}<input className="input mt-2" type={key.includes('token') ? 'password' : 'text'} value={form[key as keyof typeof form]} onChange={(event) => setForm({ ...form, [key]: event.target.value })} /></label>)}<button className={primaryButton}>Save Integration</button></form>
        <section className="card">{['Import Test Cases', 'Export Execution Results', 'Attach Screenshots', 'Attach Logs', 'Create Defect on Failure'].map((x) => <label key={x} className="mb-3 flex items-center gap-3 font-bold"><input type="checkbox" defaultChecked />{x}</label>)}<h3 className="mt-5 font-extrabold">Saved Configs</h3><pre className="mt-2 whitespace-pre-wrap rounded-xl bg-white/[0.06] border border-white/[0.07] p-3 text-xs text-white">{JSON.stringify(integrations, null, 2)}</pre></section>
      </div>
    </>
  );
}

export function Reports() {
  const { products, productId, setProductId } = useProducts();
  const [report, setReport] = useState<Record<string, number>>({});
  const [coverage, setCoverage] = useState<Array<Record<string, number | string>>>([]);
  const [error, setError] = useState('');

  async function refresh() {
    if (productId) {
      const [productReport, coverageRows] = await Promise.all([getProductReport(productId), getCoverage(productId)]);
      setReport(productReport);
      setCoverage(coverageRows);
    }
  }

  useEffect(() => {
    refresh().catch((error) => setError(errorMessage(error)));
  }, [productId]);

  return (
    <>
      <PageHeader title="Reports" subtitle="Live database reports for coverage, scripts, executions, auto-heal, and library health." actions={<><ProductPicker products={products} productId={productId} setProductId={setProductId} /><button className={secondaryButton} onClick={refresh}>Refresh</button></>} />
      <Notice error={error} />
      <div className="grid gap-4 xl:grid-cols-3">{[
        ['Automation Coverage', report.mapping_readiness || 0],
        ['Knowledge Readiness', report.knowledge_readiness || 0],
        ['Product Library Health', report.library_readiness || 0],
        ['Execution Count', report.executions || 0],
        ['Auto-Heal Suggestions', report.auto_heal_suggestions || 0],
        ['Generated Scripts', report.generated_scripts || 0]
      ].map(([x, value]) => <section key={String(x)} className="card"><h3 className="font-extrabold">{String(x)}</h3><div className="mt-3">{typeof value === 'number' && Number(value) <= 100 ? <ProgressBar value={Math.round(Number(value))} /> : <strong className="text-4xl">{String(value)}</strong>}</div></section>)}</div>
      <section className="card mt-4"><DataTable headers={['Module', 'Test Cases', 'Mapped Steps', 'Coverage']} rows={coverage.map((row) => [String(row.module), String(row.test_cases), String(row.mapped_steps), <ProgressBar value={Number(row.coverage || 0)} />])} />{!coverage.length ? <EmptyState title="No coverage data" body="Import test cases and map steps to calculate module coverage." /> : null}</section>
    </>
  );
}

export function History() {
  const { products, productId, setProductId } = useProducts();
  const [events, setEvents] = useState<HistoryEvent[]>([]);
  const [error, setError] = useState('');

  async function refresh() {
    if (!productId) return;
    setEvents(await listHistory(productId));
  }

  useEffect(() => {
    refresh().catch((error) => setError(errorMessage(error)));
  }, [productId]);

  return (
    <>
      <PageHeader title="History / Audit Timeline" subtitle="Full traceability for every user and TestPilot Agent action." actions={<><ProductPicker products={products} productId={productId} setProductId={setProductId} /><button className={secondaryButton} onClick={refresh}>Refresh</button></>} />
      <Notice error={error} />
      <div className="space-y-4">{events.map((event) => <section key={event.id || `${event.time}-${event.action}`} className="card"><div className="flex flex-wrap justify-between gap-3"><div><strong>{formatDate(String(event.time))} - {event.action}</strong><p className="text-sm text-muted">{event.actor} | {event.entity_type || event.entity} #{event.entity_id} | {event.details}</p></div><Badge>{event.status}</Badge></div>{event.before || event.after ? <div className="mt-3 grid gap-3 md:grid-cols-2"><code className="rounded-xl bg-slate-100 p-3">Before: {event.before}</code><code className="rounded-xl bg-slate-100 p-3">After: {event.after}</code></div> : null}</section>)}{!events.length ? <EmptyState title="No history yet" body="Create a product or process knowledge to start the audit timeline." /> : null}</div>
    </>
  );
}

export function KnowledgeGraph() {
  const { products, productId, setProductId, product } = useProducts();
  const [summary, setSummary] = useState<KnowledgeSummary>(emptySummary);
  const [objects, setObjects] = useState<RepositoryObject[]>([]);
  const [cases, setCases] = useState<TestCase[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!productId) return;
    Promise.all([getKnowledgeSummary(productId), listObjects(productId), listTestCases(productId)])
      .then(([knowledge, objectRows, caseRows]) => {
        setSummary(knowledge);
        setObjects(objectRows);
        setCases(caseRows);
      })
      .catch((error) => setError(errorMessage(error)));
  }, [productId]);

  const modules = summary.modules.length ? summary.modules : ['No processed modules'];
  return (
    <>
      <PageHeader title="Product Knowledge Graph" subtitle="Product -> Module -> Feature -> Object -> Test Case relationships from the database." actions={<ProductPicker products={products} productId={productId} setProductId={setProductId} />} />
      <Notice error={error} />
      <div className="grid gap-4 xl:grid-cols-5">
        <section className="card"><h3 className="font-extrabold">Product</h3><p className="mt-2 text-muted">{product?.name || 'Select product'}</p></section>
        <section className="card"><h3 className="font-extrabold">Modules</h3>{modules.map((item) => <Badge key={item}>{item}</Badge>)}</section>
        <section className="card"><h3 className="font-extrabold">Features</h3><div className="flex flex-wrap gap-2">{summary.features.map((item) => <Badge key={item}>{item}</Badge>)}</div></section>
        <section className="card"><h3 className="font-extrabold">Objects</h3><strong className="text-4xl">{objects.length}</strong><p className="text-muted">repository items</p></section>
        <section className="card"><h3 className="font-extrabold">Test Cases</h3><strong className="text-4xl">{cases.length}</strong><p className="text-muted">manual/imported</p></section>
      </div>
      <section className="card mt-4"><DataTable headers={['Module', 'Feature', 'Objects', 'Test Cases']} rows={modules.map((module) => [module, summary.features.filter((feature) => cases.some((testCase) => testCase.feature === feature) || objects.some((object) => object.feature === feature)).join(', ') || 'Review', objects.filter((object) => object.module === module).length, cases.filter((testCase) => testCase.module === module).length])} /></section>
    </>
  );
}

export function ObjectLibraryHealth() {
  const { products, productId, setProductId } = useProducts();
  const [objects, setObjects] = useState<RepositoryObject[]>([]);
  const [heals, setHeals] = useState<AutoHealSuggestion[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!productId) return;
    Promise.all([listObjects(productId), listAutoHeal(productId)])
      .then(([objectRows, healRows]) => {
        setObjects(objectRows);
        setHeals(healRows);
      })
      .catch((error) => setError(errorMessage(error)));
  }, [productId]);

  const lowConfidence = objects.filter((object) => object.confidence < 80);
  const unverified = objects.filter((object) => !(object.last_verified || object.lastVerified));
  const aliasCounts = new Map<string, number>();
  objects.forEach((object) => object.aliases?.forEach((alias) => aliasCounts.set(alias.toLowerCase(), (aliasCounts.get(alias.toLowerCase()) || 0) + 1)));
  const duplicateAliases = [...aliasCounts.entries()].filter(([, count]) => count > 1);

  return (
    <>
      <PageHeader title="Object Library Health" subtitle="Database-calculated object confidence, verification, aliases, and heal history." actions={<ProductPicker products={products} productId={productId} setProductId={setProductId} />} />
      <Notice error={error} />
      <div className="grid gap-4 xl:grid-cols-5">
        <KpiCard label="Total Objects" value={String(objects.length)} detail="Repository size" />
        <KpiCard label="Low Confidence" value={String(lowConfidence.length)} detail="Below 80%" />
        <KpiCard label="Unverified" value={String(unverified.length)} detail="No verification timestamp" />
        <KpiCard label="Duplicate Aliases" value={String(duplicateAliases.length)} detail="Alias collisions" />
        <KpiCard label="Auto-Heal History" value={String(heals.length)} detail="Suggestions" />
      </div>
      <section className="card mt-4"><DataTable headers={['Object', 'Platform', 'Confidence', 'Status', 'Aliases']} rows={objects.map((object) => [objectName(object), <Badge>{object.platform}</Badge>, <Confidence value={Math.round(object.confidence)} />, <Badge>{object.status}</Badge>, object.aliases?.join(', ') || ''])} /></section>
    </>
  );
}

export function TestCaseQualityReview() {
  const { products, productId, setProductId } = useProducts();
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!productId) return;
    listTestCaseQuality(productId).then(setRows).catch((error) => setError(errorMessage(error)));
  }, [productId]);

  return (
    <>
      <PageHeader title="Test Case Quality Review" subtitle="Database-calculated quality scoring and duplicate/weakness detection." actions={<ProductPicker products={products} productId={productId} setProductId={setProductId} />} />
      <Notice error={error} />
      <section className="card"><DataTable headers={['Test Case', 'Title', 'Quality', 'Risk', 'Issues']} rows={rows.map((row) => [String(row.external_id || row.externalId || ''), String(row.title || ''), <ProgressBar value={Number(row.quality_score || row.qualityScore || 0)} />, String(row.risk_score || row.riskScore || 0), (row.issues as string[] | undefined)?.join(', ') || 'No issues detected'])} /></section>
    </>
  );
}

export function ScriptReview() {
  const { products, productId, setProductId } = useProducts();
  const [cases, setCases] = useState<TestCase[]>([]);
  const [caseId, setCaseId] = useState(0);
  const [scripts, setScripts] = useState<GeneratedScript[]>([]);
  const [scriptId, setScriptId] = useState(0);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const selected = scripts.find((script) => script.id === scriptId) || scripts[0];
  const savedReview = selected?.review_json || {};
  const recommendation = String(savedReview.approval_recommendation || selected?.review_status || 'Not reviewed');
  const reviewSections = [
    ['Issues', savedReview.issues],
    ['Risk warnings', savedReview.risk_warnings],
    ['Missing waits', savedReview.missing_waits],
    ['Missing assertions', savedReview.missing_assertions],
    ['Recommended improvements', savedReview.recommended_improvements],
  ] as Array<[string, unknown]>;

  useEffect(() => {
    if (!productId) return;
    listTestCases(productId).then((rows) => {
      setCases(rows);
      setCaseId((current) => rows.some((row) => row.id === current) ? current : rows[0]?.id || 0);
      if (!rows.length) {
        setScripts([]);
        setScriptId(0);
      }
    }).catch((error) => setError(errorMessage(error)));
  }, [productId]);

  useEffect(() => {
    if (!caseId) {
      setScripts([]);
      setScriptId(0);
      return;
    }
    listScripts(caseId).then((rows) => {
      setScripts(rows);
      setScriptId((current) => rows.some((row) => row.id === current) ? current : rows[0]?.id || 0);
    }).catch((error) => setError(errorMessage(error)));
  }, [caseId]);

  async function runReview() {
    if (!selected) return;
    setReviewing(true);
    setError('');
    try {
      const reviewed = await reviewScript(selected.id);
      setMessage('Saved AI review updated.');
      setScripts((current) => current.map((script) => script.id === selected.id ? reviewed : script));
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setReviewing(false);
    }
  }

  return (
    <>
      <PageHeader title="Script Review" subtitle="AI review notes, risk warnings, missing waits/assertions, hardcoded values, and download." actions={<><ProductPicker products={products} productId={productId} setProductId={setProductId} /><button className={primaryButton} onClick={runReview} disabled={!selected || reviewing}>{reviewing ? 'Reviewing...' : 'Re-run AI Review'}</button>{selected ? <a className={secondaryButton} href={scriptDownloadUrl(selected.id)}>Download</a> : null}</>} />
      <Notice message={message} error={error} />
      <section className="card">
        <div className="mb-3 grid gap-3 md:grid-cols-2">
          <select className="input" value={caseId || ''} onChange={(event) => setCaseId(Number(event.target.value))}>{cases.map((testCase) => <option key={testCase.id} value={testCase.id}>{testCaseExternalId(testCase)} - {testCase.title}</option>)}</select>
          <select className="input" value={scriptId || ''} onChange={(event) => setScriptId(Number(event.target.value))}>{scripts.map((script) => <option key={script.id} value={script.id}>{script.file_name || script.fileName}</option>)}</select>
        </div>
        {selected ? <div className="grid min-w-0 gap-4 xl:grid-cols-[1.2fr_.8fr]"><div className="min-w-0"><CodeBlock code={selected.code} /></div><div className="min-w-0 space-y-3"><div className="rounded-xl border border-line bg-slate-50 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><strong>Review decision</strong><Badge>{recommendation}</Badge></div><p className="mt-2 text-sm text-muted">Risk score: {String(selected.risk_score ?? savedReview.risk_score ?? 0)}</p></div>{reviewSections.map(([title, value]) => { const items = Array.isArray(value) ? value.map(String) : []; return <section key={title} className="rounded-xl border border-line p-4"><h3 className="font-extrabold">{title}</h3>{items.length ? <ul className="mt-2 list-disc space-y-2 pl-5 text-sm text-slate-700">{items.map((item, index) => <li key={`${title}-${index}`}>{item}</li>)}</ul> : <p className="mt-2 text-sm text-muted">None reported.</p>}</section>; })}</div></div> : <EmptyState title="No script selected" body="Generate a script first, then review it here." />}
      </section>
    </>
  );
}

export function FailureIntelligence() {
  const { products, productId, setProductId } = useProducts();
  const [executions, setExecutions] = useState<ExecutionRun[]>([]);
  const [analysis, setAnalysis] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!productId) return;
    listExecutions(productId).then(setExecutions).catch((error) => setError(errorMessage(error)));
  }, [productId]);

  async function analyze(id: number) {
    try {
      setAnalysis(await analyzeFailure(id));
    } catch (error) {
      setError(errorMessage(error));
    }
  }

  return (
    <>
      <PageHeader title="Failure Intelligence" subtitle="Real AI root cause, category, suggested fix, auto-heal eligibility, and bug draft." actions={<ProductPicker products={products} productId={productId} setProductId={setProductId} />} />
      <Notice error={error} />
      <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <section className="card"><DataTable headers={['Execution', 'Status', 'Command', 'Actions']} rows={executions.map((run) => [run.id, <Badge>{run.status}</Badge>, <code>{run.command}</code>, <button className={primaryButton} onClick={() => analyze(run.id)}>Analyze with AI</button>])} /></section>
        <section className="card"><h3 className="font-extrabold">AI Failure Analysis</h3><pre className="mt-3 whitespace-pre-wrap rounded-xl bg-white/[0.06] border border-white/[0.07] p-4 text-white text-xs">{JSON.stringify(analysis || executions[0]?.failure_analysis_json || {}, null, 2)}</pre></section>
      </div>
    </>
  );
}

export function CoverageGapAnalysis() {
  const { products, productId, setProductId } = useProducts();
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!productId) return;
    getCoverageGaps(productId).then(setData).catch((error) => setError(errorMessage(error)));
  }, [productId]);

  const dbGaps = (data?.database_gaps || {}) as Record<string, string[]>;
  const aiGaps = (data?.ai_gaps || {}) as Record<string, string[]>;
  return (
    <>
      <PageHeader title="Coverage Gap Analysis" subtitle="Missing feature/object/negative coverage from database plus local AI recommendations." actions={<ProductPicker products={products} productId={productId} setProductId={setProductId} />} />
      <Notice error={error} />
      <div className="grid gap-4 xl:grid-cols-2">
        <section className="card"><h3 className="font-extrabold">Database Gaps</h3><pre className="mt-3 whitespace-pre-wrap rounded-xl bg-white/[0.06] border border-white/[0.07] p-4 text-white text-xs">{JSON.stringify(dbGaps, null, 2)}</pre></section>
        <section className="card"><h3 className="font-extrabold">AI Recommendations</h3><pre className="mt-3 whitespace-pre-wrap rounded-xl bg-white/[0.06] border border-white/[0.07] p-4 text-white text-xs">{JSON.stringify(aiGaps, null, 2)}</pre></section>
      </div>
    </>
  );
}

export function RegressionImpact() {
  const { products, productId, setProductId } = useProducts();
  const [impact, setImpact] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!productId) return;
    getRegressionImpact(productId).then(setImpact).catch((error) => setError(errorMessage(error)));
  }, [productId]);

  return (
    <>
      <PageHeader title="Regression Impact" subtitle="Impacted test cases, mappings, scripts, executions, and auto-heal suggestions after object changes." actions={<ProductPicker products={products} productId={productId} setProductId={setProductId} />} />
      <Notice error={error} />
      <section className="card"><pre className="whitespace-pre-wrap rounded-xl bg-white/[0.06] border border-white/[0.07] p-4 text-white text-xs">{JSON.stringify(impact || {}, null, 2)}</pre></section>
    </>
  );
}

export function ApprovalQueue() {
  const { products, productId, setProductId } = useProducts();
  const [queue, setQueue] = useState<Record<string, any>>({});
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function refresh() {
    if (!productId) return;
    setQueue(await listApprovals(productId));
  }

  useEffect(() => {
    refresh().catch((error) => setError(errorMessage(error)));
  }, [productId]);

  async function approveMap(id: number) {
    try {
      setError('');
      await approveMapping(id);
      setMessage('Mapping approved');
      await refresh();
    } catch (error) {
      setError(errorMessage(error));
    }
  }

  async function approveHeal(id: number) {
    try {
      setError('');
      await approveAutoHeal(id);
      setMessage('Auto-heal approved');
      await refresh();
    } catch (error) {
      setError(errorMessage(error));
    }
  }

  return (
    <>
      <PageHeader title="Approval Queue" subtitle="Pending mapping approvals, auto-heal approvals, and blocked script generation gates." actions={<ProductPicker products={products} productId={productId} setProductId={setProductId} />} />
      <Notice message={message} error={error} />
      <div className="grid gap-4 xl:grid-cols-2">
        <section className="card"><h3 className="font-extrabold">Mapping Approvals</h3><DataTable headers={['Step', 'Object', 'Confidence', 'Risk', 'Action']} rows={(queue.mappings || []).map((row: MappingRow) => [mappingManual(row), mappingObject(row), <Confidence value={Math.round(row.confidence)} />, String(row.risk_score || row.riskScore || 0), <button className={primaryButton} onClick={() => approveMap(row.id)}>Approve</button>])} /></section>
        <section className="card"><h3 className="font-extrabold">Auto-Heal Approvals</h3><DataTable headers={['Object', 'Suggested Path', 'Confidence', 'Action']} rows={(queue.auto_heal || []).map((row: AutoHealSuggestion) => [row.object, <code>{row.suggested_path}</code>, <Confidence value={Math.round(row.confidence)} />, <button className={successButton} onClick={() => approveHeal(row.id)}>Approve</button>])} /></section>
      </div>
      <section className="card mt-4"><h3 className="font-extrabold">Blocked Script Candidates</h3><pre className="mt-3 whitespace-pre-wrap rounded-xl bg-white/[0.06] border border-white/[0.07] p-4 text-white text-xs">{JSON.stringify(queue.blocked_scripts || [], null, 2)}</pre></section>
    </>
  );
}

export function ProductFlow() {
  const { productId } = useProducts();
  const [summary, setSummary] = useState<Record<string, number>>({});
  const [health, setHealth] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    if (!productId) return;
    Promise.all([getProductReport(productId), healthCheck()]).then(([report, status]) => {
      setSummary(report);
      setHealth(status);
    });
  }, [productId]);

  const flow = ['Product Setup', 'Knowledge Base', 'Product Library', 'Test Case Import', 'AI Mapping', 'Script Generation', 'Execution', 'Auto Heal if Failed', 'Reports', 'Zephyr/Jira Update'];
  return (
    <>
      <PageHeader title="Product Flow" subtitle="Knowledge-first lifecycle used by TestPilot Agent." />
      <ApprovalModal title="No Knowledge + No Library = No Reliable Automation" body="TestPilot Agent does not generate scripts without sufficient knowledge, library, mapping confidence, and approvals." />
      <div className="mt-4 grid gap-4 xl:grid-cols-5">{flow.map((step, index) => <section key={step} className="card"><span className="grid h-9 w-9 place-items-center rounded-xl bg-purple-500/[0.18] border border-purple-500/[0.3] font-extrabold text-purple-300">{index + 1}</span><h3 className="mt-3 font-extrabold">{step}</h3></section>)}</div>
      <section className="card mt-4"><h3 className="font-extrabold">Live Selected Product State</h3><p className="mt-2 text-muted">Backend: {health ? String(health.status) : 'checking'} | Knowledge Sources: {summary.knowledge_sources || 0} | Objects: {summary.library_objects || 0} | Test Cases: {summary.test_cases || 0} | Scripts: {summary.generated_scripts || 0}</p><p className="mt-3 text-muted">TestPilot Agent is the single standard AI agent for the product. It uses product knowledge, product library, and test case context to generate reliable automation. It does not generate scripts without sufficient knowledge and library confidence.</p></section>
    </>
  );
}

export function Settings() {
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    getSettings().then(setSettings).catch((error) => setError(errorMessage(error)));
  }, []);

  function setToggle(key: string, value: boolean) {
    setSettings({ ...settings, [key]: value });
  }

  async function save() {
    try {
      const updated = await updateSettings(settings);
      setSettings(updated);
      setMessage('Settings saved');
    } catch (error) {
      setError(errorMessage(error));
    }
  }

  const toggles = [
    ['require_approval_before_script_generation', 'Require approval before script generation'],
    ['require_approval_before_auto_heal_update', 'Require approval before auto-heal update'],
    ['allow_auto_run_after_script_generation', 'Allow auto-run after script generation'],
    ['store_execution_evidence', 'Store execution evidence'],
    ['enable_hybrid_runner', 'Enable hybrid runner'],
    ['enable_desktop_automation', 'Enable desktop automation']
  ];

  return (
    <>
      <PageHeader title="Settings" subtitle="Model, agent, RAG, framework, runner, approval, history, integration, and security settings." actions={<button className={primaryButton} onClick={save}>Save Settings</button>} />
      <Notice message={message} error={error} />
      <div className="grid gap-4 xl:grid-cols-2">
        <section className="card"><h3 className="font-extrabold">Appearance</h3><p className="mt-2 text-sm text-muted">Theme is saved on this browser and does not change backend automation settings.</p><div className="mt-4 grid grid-cols-2 gap-2 rounded-lg border border-line bg-slate-500/10 p-1"><button type="button" className={`btn ${theme === 'light' ? 'btn-primary' : ''}`} onClick={() => setTheme('light')}>Light</button><button type="button" className={`btn ${theme === 'dark' ? 'btn-primary' : ''}`} onClick={() => setTheme('dark')}>Dark</button></div><h3 className="mt-6 font-extrabold">AI Model Settings</h3><input className="input mt-3" value={String(settings.model_name || '')} onChange={(event) => setSettings({ ...settings, model_name: event.target.value })} /><h3 className="mt-5 font-extrabold">RAG / Vector DB Settings</h3><input className="input mt-3" value={String(settings.vector_db_type || '')} onChange={(event) => setSettings({ ...settings, vector_db_type: event.target.value })} /><h3 className="mt-5 font-extrabold">Framework Defaults</h3><select className="input mt-3" value={String(settings.default_framework || 'SAP_GUI_VBSCRIPT')} onChange={(event) => setSettings({ ...settings, default_framework: event.target.value })}>{['SAP_GUI_VBSCRIPT', 'SELENIUM_JAVA', 'PLAYWRIGHT', 'CUCUMBER', 'DESKTOP', 'HYBRID'].map((item) => <option key={item}>{item}</option>)}</select></section>
        <section className="card"><h3 className="font-extrabold">Agent and Approval Rules</h3><p className="text-muted">TestPilot Agent is the single standard AI agent for this product. It uses product knowledge, product library, and test case context before automation.</p>{toggles.map(([key, label]) => <label key={key} className="mt-3 flex items-center gap-3 font-bold"><input type="checkbox" checked={Boolean(settings[key])} onChange={(event) => setToggle(key, event.target.checked)} />{label}</label>)}<h3 className="mt-5 font-extrabold">Runner Settings</h3><select className="input mt-3" value={String(settings.runner_mode || 'safe')} onChange={(event) => setSettings({ ...settings, runner_mode: event.target.value })}>{['safe', 'local-controlled', 'remote-runner'].map((item) => <option key={item}>{item}</option>)}</select><h3 className="mt-5 font-extrabold">History Retention</h3><input className="input mt-3" type="number" value={Number(settings.history_retention_days || 365)} onChange={(event) => setSettings({ ...settings, history_retention_days: Number(event.target.value) })} /><h3 className="mt-5 font-extrabold">Zephyr/Jira Settings</h3><p className="text-sm text-muted">Integration credentials are configured on the Zephyr / Jira page and token fields are masked in API responses.</p><h3 className="mt-5 font-extrabold">Security Settings</h3><p className="text-sm text-muted">Uploaded files stay under the product upload directory. Local automation execution remains disabled unless explicitly enabled.</p></section>
      </div>
    </>
  );
}
