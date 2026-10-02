import type { ReactNode, CSSProperties } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useProductContext } from '../context/ProductContext';
import { AiAssistant } from '../components/AiAssistant';

function SvgIcon({ children, size = 15 }: { children: ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round"
      style={{ flexShrink: 0 }}>
      {children}
    </svg>
  );
}

function IDashboard()   { return <SvgIcon><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></SvgIcon>; }
function IProduct()     { return <SvgIcon><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></SvgIcon>; }
function IKnowledge()   { return <SvgIcon><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></SvgIcon>; }
function IKnowResult()  { return <SvgIcon><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></SvgIcon>; }
function IKnowGraph()   { return <SvgIcon><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></SvgIcon>; }
function ILibrary()     { return <SvgIcon><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></SvgIcon>; }
function ILibHealth()   { return <SvgIcon><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></SvgIcon>; }
function ITestCases()   { return <SvgIcon><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></SvgIcon>; }
function IQuality()     { return <SvgIcon><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></SvgIcon>; }
function IMapping()     { return <SvgIcon><rect x="2" y="3" width="6" height="6" rx="1"/><rect x="16" y="3" width="6" height="6" rx="1"/><rect x="9" y="15" width="6" height="6" rx="1"/><path d="M5 9v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9"/><line x1="12" y1="14" x2="12" y2="15"/></SvgIcon>; }
function IScripts()     { return <SvgIcon><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><polyline points="10 12 8 14 10 16"/><polyline points="14 12 16 14 14 16"/></SvgIcon>; }
function IScriptRev()   { return <SvgIcon><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></SvgIcon>; }
function IExecution()   { return <SvgIcon><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/></SvgIcon>; }
function IFailure()     { return <SvgIcon><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></SvgIcon>; }
function IAutoHeal()    { return <SvgIcon><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></SvgIcon>; }
function ICoverage()    { return <SvgIcon><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></SvgIcon>; }
function IRegression()  { return <SvgIcon><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></SvgIcon>; }
function IIntegration() { return <SvgIcon><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></SvgIcon>; }
function IReports()     { return <SvgIcon><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></SvgIcon>; }
function IHistory()     { return <SvgIcon><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></SvgIcon>; }
function IApprovals()   { return <SvgIcon><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></SvgIcon>; }
function IFlow()        { return <SvgIcon><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></SvgIcon>; }
function ISettings()    { return <SvgIcon><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></SvgIcon>; }
function ISearch()      { return <SvgIcon><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></SvgIcon>; }

type NavItem  = { label: string; to: string; Icon: () => JSX.Element };
type NavGroup = { group: string | null; items: NavItem[] };

const NAV_GROUPS: NavGroup[] = [
  { group: null, items: [{ label: 'Dashboard', to: '/dashboard', Icon: IDashboard }] },
  {
    group: 'Setup',
    items: [
      { label: 'Product Setup', to: '/setup',    Icon: IProduct  },
      { label: 'Settings',      to: '/settings', Icon: ISettings },
    ],
  },
  {
    group: 'Knowledge',
    items: [
      { label: 'Knowledge Base',   to: '/knowledge',        Icon: IKnowledge  },
      { label: 'Knowledge Result', to: '/knowledge-result', Icon: IKnowResult },
      { label: 'Knowledge Graph',  to: '/knowledge-graph',  Icon: IKnowGraph  },
    ],
  },
  {
    group: 'Library',
    items: [
      { label: 'Product Library', to: '/library',        Icon: ILibrary   },
      { label: 'Library Health',  to: '/library-health', Icon: ILibHealth },
    ],
  },
  {
    group: 'Testing',
    items: [
      { label: 'Test Cases',     to: '/test-cases', Icon: ITestCases },
      { label: 'Quality Review', to: '/quality',    Icon: IQuality   },
    ],
  },
  {
    group: 'Automation',
    items: [
      { label: 'AI Mapping',       to: '/mapping',       Icon: IMapping   },
      { label: 'Script Generator', to: '/scripts',       Icon: IScripts   },
      { label: 'Script Review',    to: '/script-review', Icon: IScriptRev },
    ],
  },
  {
    group: 'Execution',
    items: [
      { label: 'Execution',            to: '/execution',            Icon: IExecution },
      { label: 'Failure Intelligence', to: '/failure-intelligence', Icon: IFailure   },
      { label: 'Auto Heal',            to: '/auto-heal',            Icon: IAutoHeal  },
    ],
  },
  {
    group: 'Analytics',
    items: [
      { label: 'Coverage Gap',      to: '/coverage-gaps',     Icon: ICoverage   },
      { label: 'Regression Impact', to: '/regression-impact', Icon: IRegression },
      { label: 'Reports',           to: '/reports',            Icon: IReports    },
      { label: 'History',           to: '/history',            Icon: IHistory    },
    ],
  },
  {
    group: 'Integration',
    items: [
      { label: 'Zephyr / Jira', to: '/integrations', Icon: IIntegration },
      { label: 'Approvals',     to: '/approvals',     Icon: IApprovals   },
      { label: 'Flow',          to: '/flow',          Icon: IFlow        },
    ],
  },
];

const NAV_FLAT = NAV_GROUPS.flatMap(({ items }) => items.map(({ label, to }) => [label, to] as const));

/* Apple design tokens */
const SIDEBAR_BG   = 'rgba(10,10,12,0.98)';
const SIDEBAR_BDR  = 'rgba(255,255,255,0.07)';
const APPLE_BLUE   = '#2997FF';
const GROUP_COLOR  = 'rgba(255,255,255,0.22)';
const GROUP_LINE   = 'rgba(255,255,255,0.06)';
const SYS_FONT: CSSProperties = { fontFamily: '-apple-system, "SF Pro Text", Inter, ui-sans-serif, sans-serif' };

export function AppLayout() {
  const { products, selectedProduct, selectedProductId, setSelectedProductId, loading } = useProductContext();
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <div className="app-shell min-h-screen" style={{ color: '#fff', ...SYS_FONT }}>

      {/* ── Sidebar ─────────────────────────────────────────── */}
      <aside
        className="fixed inset-y-0 left-0 hidden w-64 flex-col lg:flex"
        style={{ background: SIDEBAR_BG, borderRight: `1px solid ${SIDEBAR_BDR}`, zIndex: 50 }}
      >

        {/* Logo */}
        <NavLink
          to="/"
          style={{
            display: 'flex', alignItems: 'center', gap: '.72rem',
            padding: '1.1rem 1.15rem',
            borderBottom: `1px solid ${SIDEBAR_BDR}`,
            textDecoration: 'none',
          }}
        >
          <span style={{
            display: 'grid', placeItems: 'center',
            width: 36, height: 36, flexShrink: 0, borderRadius: 9,
            background: APPLE_BLUE,
            color: '#fff', fontSize: '.72rem', fontWeight: 800,
            boxShadow: `0 4px 16px rgba(41,151,255,0.4)`,
            letterSpacing: '.02em',
          }}>
            TP
          </span>
          <span>
            <strong style={{ display: 'block', fontSize: '.83rem', fontWeight: 700, letterSpacing: '-.01em', color: '#fff', lineHeight: 1.2 }}>
              TestPilot
            </strong>
            <span style={{ fontSize: '.63rem', color: 'rgba(255,255,255,0.36)', fontWeight: 400, letterSpacing: '.02em' }}>
              AI Automation
            </span>
          </span>
        </NavLink>

        {/* Product selector */}
        <div style={{ borderBottom: `1px solid ${SIDEBAR_BDR}`, padding: '.8rem 1rem' }}>
          <p style={{ marginBottom: '.5rem', fontSize: '.6rem', fontWeight: 600, letterSpacing: '.08em', color: GROUP_COLOR, textTransform: 'uppercase' }}>
            Active Product
          </p>

          {loading ? (
            <p style={{ fontSize: '.75rem', color: 'rgba(255,255,255,0.35)' }}>Loading…</p>
          ) : products.length ? (
            <>
              <select
                style={{
                  width: '100%', padding: '.42rem .65rem',
                  background: 'rgba(44,44,46,0.8)',
                  border: '1px solid rgba(255,255,255,0.12)',
                  borderRadius: 8, color: '#fff',
                  fontSize: '.75rem', fontWeight: 500, outline: 'none',
                  cursor: 'pointer', transition: 'border-color .18s',
                }}
                value={selectedProductId || ''}
                onChange={(e) => setSelectedProductId(Number(e.target.value))}
              >
                <option value="" style={{ background: '#1c1c1e' }}>Select product…</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id} style={{ background: '#1c1c1e' }}>{p.name}</option>
                ))}
              </select>

              {selectedProduct && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.32rem', marginTop: '.48rem' }}>
                  <span style={{
                    padding: '.15rem .48rem', fontSize: '.64rem', fontWeight: 600, borderRadius: 5,
                    background: 'rgba(41,151,255,0.12)', border: '1px solid rgba(41,151,255,0.22)',
                    color: APPLE_BLUE,
                  }}>
                    {selectedProduct.product_type || selectedProduct.type}
                  </span>
                  <span style={{
                    padding: '.15rem .48rem', fontSize: '.64rem', fontWeight: 600, borderRadius: 5,
                    background: 'rgba(52,199,89,0.1)', border: '1px solid rgba(52,199,89,0.2)',
                    color: '#34C759',
                  }}>
                    {selectedProduct.environment}
                  </span>
                </div>
              )}
            </>
          ) : (
            <NavLink to="/setup" style={{ fontSize: '.75rem', fontWeight: 600, color: APPLE_BLUE, textDecoration: 'none' }}>
              + Create first product
            </NavLink>
          )}
        </div>

        {/* Nav groups */}
        <nav style={{
          flex: 1, overflowY: 'auto', padding: '.65rem .42rem',
          display: 'flex', flexDirection: 'column', gap: '.5rem',
        }}>
          {NAV_GROUPS.map(({ group, items }) => (
            <div key={group ?? '__top'}>
              {group && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem', padding: '.15rem .65rem .2rem', marginBottom: '.1rem' }}>
                  <span style={{ fontSize: '.58rem', fontWeight: 700, letterSpacing: '.1em', color: GROUP_COLOR, textTransform: 'uppercase' }}>
                    {group}
                  </span>
                  <span style={{ flex: 1, height: 1, background: GROUP_LINE }} />
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {items.map(({ label, to, Icon }) => (
                  <NavLink
                    key={to}
                    to={to}
                    className={({ isActive }) => isActive ? 'cy-nav-active' : 'cy-nav-item'}
                  >
                    {({ isActive }) => (
                      <>
                        <span style={{
                          flexShrink: 0,
                          color: isActive ? APPLE_BLUE : 'rgba(255,255,255,0.35)',
                          transition: 'color .16s',
                        }}>
                          <Icon />
                        </span>
                        <span style={{ flex: 1 }}>{label}</span>
                        {isActive && (
                          <span style={{
                            width: 5, height: 5, borderRadius: '50%', flexShrink: 0,
                            background: APPLE_BLUE,
                            boxShadow: `0 0 8px ${APPLE_BLUE}`,
                          }} />
                        )}
                      </>
                    )}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        {/* System status */}
        <div style={{ borderTop: `1px solid ${SIDEBAR_BDR}`, padding: '.75rem' }}>
          <div style={{
            borderRadius: 12, padding: '.85rem',
            border: '1px solid rgba(255,255,255,0.08)',
            background: 'rgba(28,28,30,0.8)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '.45rem', marginBottom: '.45rem' }}>
              <span style={{
                width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                background: '#34C759', boxShadow: '0 0 8px #34C759',
              }} />
              <span style={{ fontSize: '.62rem', fontWeight: 600, letterSpacing: '.08em', color: '#34C759', textTransform: 'uppercase' }}>
                System Online
              </span>
            </div>
            <strong style={{ display: 'block', fontSize: '.8rem', fontWeight: 700, color: '#fff', letterSpacing: '-.01em' }}>
              TestPilot Agent
            </strong>
            <p style={{ margin: '.3rem 0 0', fontSize: '.66rem', lineHeight: 1.55, color: 'rgba(255,255,255,0.3)' }}>
              Knowledge · Mapping · Execution · Self-Heal
            </p>
          </div>
        </div>
      </aside>

      {/* ── Main ────────────────────────────────────────────── */}
      <main className="lg:pl-64">

        {/* Topbar */}
        <header className="topbar sticky top-0 z-10 px-5 py-3">
          <div className="flex items-center justify-between gap-4">

            {/* Mobile logo */}
            <div className="flex items-center gap-3 lg:hidden">
              <NavLink to="/" style={{ display: 'flex', alignItems: 'center', gap: '.5rem', textDecoration: 'none' }}>
                <span style={{
                  display: 'grid', placeItems: 'center',
                  width: 32, height: 32, borderRadius: 8,
                  background: APPLE_BLUE,
                  color: '#fff', fontSize: '.66rem', fontWeight: 800,
                  boxShadow: `0 4px 12px rgba(41,151,255,0.4)`,
                }}>TP</span>
                <strong style={{ fontSize: '.8rem', color: '#fff', fontWeight: 700 }}>TestPilot</strong>
              </NavLink>
            </div>

            {/* Desktop tagline */}
            <p className="hidden lg:block" style={{
              fontSize: '.65rem', fontWeight: 600, letterSpacing: '.08em',
              color: 'rgba(255,255,255,0.28)', textTransform: 'uppercase',
            }}>
              AI-Native Test Automation
            </p>

            {/* Right actions */}
            <div className="ml-auto flex items-center gap-3">

              {/* Mobile nav select */}
              <select
                className="input h-9 w-44 py-1 text-xs lg:hidden"
                value={NAV_FLAT.some(([, to]) => to === location.pathname) ? location.pathname : '/dashboard'}
                onChange={(e) => navigate(e.target.value)}
              >
                {NAV_FLAT.map(([label, to]) => (
                  <option key={to} value={to}>{label}</option>
                ))}
              </select>

              {/* Search */}
              <div className="relative hidden sm:block">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
                  style={{ color: 'rgba(255,255,255,0.28)' }}>
                  <ISearch />
                </span>
                <input className="input h-9 w-52 pl-9 text-sm xl:w-64" placeholder="Search products, objects…" />
              </div>

              {/* Live AI badge */}
              <span className="status-pill hidden lg:inline-flex">Live AI</span>

              {/* Avatar */}
              <div style={{
                display: 'grid', placeItems: 'center',
                width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                background: APPLE_BLUE,
                color: '#fff', fontSize: '.66rem', fontWeight: 700,
                boxShadow: `0 4px 12px rgba(41,151,255,0.4)`,
              }}>
                QM
              </div>
            </div>
          </div>
        </header>

        {/* Content */}
        <section className="mx-auto max-w-[1680px] p-5 xl:p-8">
          <Outlet />
        </section>
      </main>

      <AiAssistant />
    </div>
  );
}
