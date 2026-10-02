import {
  Home,
  LayoutDashboard,
  AppWindow,
  ScanSearch,
  Video,
  Library,
  ListChecks,
  Database,
  Workflow,
  FileCode2,
  PlayCircle,
  BarChart3,
  BookOpen,
  Plug,
  Settings,
  Bot,
  Building2,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  // Only consumed by TopIconNav to place cluster dividers.
  group?: 'manage' | 'build' | 'run' | 'config';
}

// Ordered to match the actual QA workflow, not alphabetically or by when
// each page was built: register the app -> ground it in what's already known
// (Knowledge Base) -> discover its UI (Scanner) -> curate locators (Object
// Library) -> define what to test (Test Cases) -> the data to test with
// (Test Data) -> build (Automation Builder) -> compile (Script Generator) ->
// run (Executions) -> analyze (Reports) -> file/sync findings (Zephyr/Jira)
// -> Settings last.
export const NAV_ITEMS: NavItem[] = [
  { label: 'Home', href: '/home', icon: Home },
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  // Not per-application on purpose, like Home/Dashboard above — a portfolio
  // view across every application, not one app's workflow.
  { label: 'Fleet', href: '/fleet', icon: Building2 },
  { label: 'Applications', href: '/applications', icon: AppWindow, group: 'manage' },
  { label: 'Knowledge Base', href: '/knowledge-base', icon: BookOpen, group: 'manage' },
  { label: 'Scanner', href: '/scanner', icon: ScanSearch, group: 'manage' },
  { label: 'Web Recorder', href: '/web-recorder', icon: Video, group: 'manage' },
  { label: 'Object Library', href: '/object-library', icon: Library, group: 'manage' },
  { label: 'Test Cases', href: '/test-cases', icon: ListChecks, group: 'build' },
  { label: 'Test Data', href: '/test-data', icon: Database, group: 'build' },
  { label: 'Automation Builder', href: '/automation-builder', icon: Workflow, group: 'build' },
  { label: 'Script Generator', href: '/script-generator', icon: FileCode2, group: 'build' },
  { label: 'Executions', href: '/executions', icon: PlayCircle, group: 'run' },
  { label: 'Reports', href: '/reports', icon: BarChart3, group: 'run' },
  { label: 'Zephyr / Jira', href: '/integrations', icon: Plug, group: 'config' },
  // Not per-application on purpose — this is about TestPilot itself, not
  // any one customer application under test.
  { label: 'AI Engineering', href: '/ai-engineering', icon: Bot, group: 'config' },
  { label: 'Settings', href: '/settings', icon: Settings, group: 'config' },
];
