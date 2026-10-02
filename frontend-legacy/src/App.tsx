import { Navigate, Route, Routes } from 'react-router-dom';
import { RequireProduct } from './components/RequireProduct';
import { AppLayout } from './layouts/AppLayout';
import {
  AiMapping,
  AutoHeal,
  ApprovalQueue,
  CoverageGapAnalysis,
  Dashboard,
  ExecutionCenter,
  FailureIntelligence,
  History,
  Integrations,
  KnowledgeBase,
  KnowledgeGraph,
  KnowledgeResult,
  ObjectLibraryHealth,
  Landing,
  ProductFlow,
  ProductLibrary,
  ProductSetup,
  RegressionImpact,
  Reports,
  ScriptReview,
  ScriptGenerator,
  Settings,
  TestCaseQualityReview,
  TestCaseImport
} from './pages';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route element={<AppLayout />}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/setup" element={<ProductSetup />} />
        <Route path="/knowledge" element={<RequireProduct><KnowledgeBase /></RequireProduct>} />
        <Route path="/knowledge-result" element={<RequireProduct><KnowledgeResult /></RequireProduct>} />
        <Route path="/knowledge-graph" element={<RequireProduct><KnowledgeGraph /></RequireProduct>} />
        <Route path="/library" element={<RequireProduct><ProductLibrary /></RequireProduct>} />
        <Route path="/library-health" element={<RequireProduct><ObjectLibraryHealth /></RequireProduct>} />
        <Route path="/test-cases" element={<RequireProduct><TestCaseImport /></RequireProduct>} />
        <Route path="/quality" element={<RequireProduct><TestCaseQualityReview /></RequireProduct>} />
        <Route path="/mapping" element={<RequireProduct><AiMapping /></RequireProduct>} />
        <Route path="/scripts" element={<RequireProduct><ScriptGenerator /></RequireProduct>} />
        <Route path="/script-review" element={<RequireProduct><ScriptReview /></RequireProduct>} />
        <Route path="/execution" element={<RequireProduct><ExecutionCenter /></RequireProduct>} />
        <Route path="/failure-intelligence" element={<RequireProduct><FailureIntelligence /></RequireProduct>} />
        <Route path="/auto-heal" element={<RequireProduct><AutoHeal /></RequireProduct>} />
        <Route path="/coverage-gaps" element={<RequireProduct><CoverageGapAnalysis /></RequireProduct>} />
        <Route path="/regression-impact" element={<RequireProduct><RegressionImpact /></RequireProduct>} />
        <Route path="/integrations" element={<RequireProduct><Integrations /></RequireProduct>} />
        <Route path="/reports" element={<RequireProduct><Reports /></RequireProduct>} />
        <Route path="/history" element={<RequireProduct><History /></RequireProduct>} />
        <Route path="/approvals" element={<RequireProduct><ApprovalQueue /></RequireProduct>} />
        <Route path="/flow" element={<RequireProduct><ProductFlow /></RequireProduct>} />
        <Route path="/settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
