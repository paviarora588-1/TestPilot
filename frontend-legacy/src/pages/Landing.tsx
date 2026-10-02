import { useMemo } from 'react';
import { Link } from 'react-router-dom';

/* ── Agents ─────────────────────────────────────────────────── */
const AGENTS = [
  { name: 'Orchestrator',     abbr: 'OR', color: '#5E5CE6', bg: 'rgba(94,92,230,0.18)',  angle:   0 },
  { name: 'Self-Healing',     abbr: 'SH', color: '#2997FF', bg: 'rgba(41,151,255,0.18)', angle:  36 },
  { name: 'Bug Analysis',     abbr: 'BA', color: '#FF9F0A', bg: 'rgba(255,159,10,0.18)', angle:  72 },
  { name: 'Automation',       abbr: 'AU', color: '#34C759', bg: 'rgba(52,199,89,0.18)',  angle: 108 },
  { name: 'Reporting',        abbr: 'RP', color: '#FF375F', bg: 'rgba(255,55,95,0.18)',  angle: 144 },
  { name: 'Execution',        abbr: 'EX', color: '#2997FF', bg: 'rgba(41,151,255,0.18)', angle: 180 },
  { name: 'Test Case',        abbr: 'TC', color: '#BF5AF2', bg: 'rgba(191,90,242,0.18)', angle: 216 },
  { name: 'SAP Intelligence', abbr: 'SI', color: '#5AC8FA', bg: 'rgba(90,200,250,0.18)', angle: 252 },
  { name: 'Knowledge',        abbr: 'KN', color: '#34C759', bg: 'rgba(52,199,89,0.18)',  angle: 288 },
  { name: 'Requirements',     abbr: 'RQ', color: '#FF9F0A', bg: 'rgba(255,159,10,0.18)', angle: 324 },
];

const PROCESS_STEPS = [
  { n: '01', title: 'Onboard & Understand', desc: 'Upload documentation, SAP GUI recordings, or connect your system. TESTpilot AI ingests and understands your entire application landscape in minutes.' },
  { n: '02', title: 'Map & Generate',       desc: 'AI agents automatically map test steps to your object library, generating maintainable automation scripts with full bidirectional traceability.' },
  { n: '03', title: 'Execute & Self-Heal',  desc: 'Run thousands of tests at scale. When UI changes break automations, the Self-Healing agent detects, diagnoses, and repairs them autonomously.' },
  { n: '04', title: 'Analyze & Evolve',     desc: 'Deep AI-generated reports, coverage matrices, and regression impact analysis help your team continuously improve quality velocity.' },
];

const STATS = [
  { value: '2.4M+', label: 'Tests Executed',  sub: 'Across all platforms'    },
  { value: '1.2M+', label: 'Bugs Detected',   sub: 'Before production'       },
  { value: '76%',   label: 'Time Saved',       sub: 'vs. manual testing'     },
  { value: '100%',  label: 'Local AI',         sub: 'Your data stays yours'  },
  { value: '10x',   label: 'ROI',              sub: 'Average enterprise return' },
];

const ENT_FEATURES = [
  { title: 'Local AI as Default',   desc: 'All AI models run fully on-premises. Your test data, code, and business logic never touch a third-party server.', icon: 'lock'   },
  { title: 'Explainable Decisions', desc: 'Every agent action is logged and auditable. Understand precisely why each automation was generated or modified.',   icon: 'eye'    },
  { title: 'Self-Healing Engine',   desc: 'Continuously monitors your UI for object changes. Broken tests are repaired before they block your pipeline.',       icon: 'heal'   },
  { title: 'Enterprise Security',   desc: 'RBAC, comprehensive audit logs, encryption at rest and in transit. SOC 2 and ISO 27001 compliant by design.',       icon: 'shield' },
  { title: 'Universal Coverage',    desc: 'One platform for SAP GUI, Web, Desktop, Mobile, and API — unified knowledge base, unified execution engine.',        icon: 'globe'  },
];

const PLATFORM_FEATURES = [
  'Knowledge-First AI Test Generation',
  'Multi-Agent Orchestration Engine',
  'Self-Healing Object Repository',
  'Zero-Code Automation Builder',
  'Real-Time Traceability Matrix',
  'Intelligent Regression Analysis',
];

const TRUST_LOGOS = ['SIEMENS', 'BOSCH', 'KPMG', 'DELOITTE', 'SAP', 'T-SYSTEMS', 'CAPGEMINI'];

/* ── Icons ──────────────────────────────────────────────────── */
function Ico({ d, ...p }: { d: string; [k: string]: string | number }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">{d.split('|').map((c, i) => <path key={i} d={c}/>)}</svg>;
}
function IcoCheck() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>; }
function IcoArrow() { return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>; }

const ICON_PATHS: Record<string, string> = {
  lock:   'M3 11h18v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z|M7 11V7a5 5 0 0 1 10 0v4',
  eye:    'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z|M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  heal:   'M22 12h-4l-3 9L9 3l-3 9H2',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z|m9 12 2 2 4-4',
  globe:  'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z|M2 12h20|M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z',
  lock_s: 'M3 11h18v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z|M7 11V7a5 5 0 0 1 10 0v4',
  cpu:    'M4 4h16v16H4z|M9 9h6v6H9z',
};

function EntIcon({ type }: { type: string }) {
  const d = ICON_PATHS[type] ?? ICON_PATHS.shield;
  return <Ico d={d} />;
}

const HERO_BADGES = [
  { icon: 'lock',   title: '100% Local AI',      sub: 'Your data stays yours'        },
  { icon: 'cpu',    title: 'No-Code Automation', sub: 'Natural language → scripts'   },
  { icon: 'shield', title: 'Enterprise Ready',   sub: 'Secure, scalable & compliant' },
  { icon: 'eye',    title: 'Explainable AI',     sub: 'Every decision is auditable'  },
];

/* ── Star field ─────────────────────────────────────────────── */
function StarField() {
  const stars = useMemo(() => {
    let s = 42;
    const rng = () => { s = (s * 16807) % 2147483647; return (s % 10000) / 10000; };
    return Array.from({ length: 180 }, () => ({
      cx: rng() * 100, cy: rng() * 100,
      r: rng() * 1.1 + 0.2,
      o: rng() * 0.35 + 0.06,
      d: (rng() * 5 + 2.5).toFixed(1),
      dl: -(rng() * 6).toFixed(1),
    }));
  }, []);
  return (
    <svg aria-hidden="true" style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', zIndex: 0, pointerEvents: 'none' }}>
      {stars.map((st, i) => (
        <circle key={i} cx={`${st.cx}%`} cy={`${st.cy}%`} r={st.r} fill="white" opacity={st.o}
          className="lp-star"
          style={{ animationDuration: `${st.d}s`, animationDelay: `${st.dl}s`, ['--star-o' as string]: st.o }}
        />
      ))}
    </svg>
  );
}

/* ── Orbit ring ─────────────────────────────────────────────── */
const ORBIT_R = 185;
const ORB_SIZE = 58;

function AgentOrb({ agent }: { agent: typeof AGENTS[0] }) {
  return (
    <div className="lp-orb-inner">
      <div className="lp-orb-glow" style={{ background: `radial-gradient(circle, ${agent.bg} 0%, transparent 70%)` }} />
      <div className="lp-orb-face" style={{ background: agent.bg }}>
        <span className="lp-orb-abbr" style={{ color: agent.color }}>{agent.abbr}</span>
      </div>
      <div className="lp-orb-name">{agent.name}</div>
    </div>
  );
}

function OrbitRing() {
  return (
    <div className="lp-orbit-root">
      <div className="lp-ring lp-ring-outer" />
      <div className="lp-ring lp-ring-mid" />

      <svg className="lp-orbit-svg" viewBox="0 0 500 500" fill="none">
        <defs>
          <linearGradient id="ringG" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%"   stopColor="#2997FF" stopOpacity="0.7" />
            <stop offset="50%"  stopColor="#5E5CE6" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#BF5AF2" stopOpacity="0.7" />
          </linearGradient>
        </defs>
        <circle cx="250" cy="250" r={ORBIT_R} stroke="url(#ringG)" strokeWidth="1" />
        <circle cx="250" cy="250" r={ORBIT_R} stroke="rgba(255,255,255,0.04)" strokeWidth="12" />
        {AGENTS.map((ag) => {
          const rad = ((ag.angle - 90) * Math.PI) / 180;
          return (
            <line key={ag.name} x1="250" y1="250"
              x2={250 + ORBIT_R * Math.cos(rad)} y2={250 + ORBIT_R * Math.sin(rad)}
              stroke={`${ag.color}18`} strokeWidth="1" strokeDasharray="3 9"
            />
          );
        })}
        <circle cx="250" cy="250" r="72" stroke="rgba(255,255,255,0.05)" strokeWidth="1" strokeDasharray="3 8" />
      </svg>

      <div className="lp-orbit-spinner">
        {AGENTS.map((ag) => {
          const rad = ((ag.angle - 90) * Math.PI) / 180;
          const x = 250 + ORBIT_R * Math.cos(rad) - ORB_SIZE / 2;
          const y = 250 + ORBIT_R * Math.sin(rad) - ORB_SIZE / 2;
          return (
            <div key={ag.name} className="lp-orbit-node" style={{ left: x, top: y }}>
              <div className="lp-orbit-counter"><AgentOrb agent={ag} /></div>
            </div>
          );
        })}
      </div>

      {/* Center logo */}
      <div className="lp-center-logo">
        <div className="lp-center-ring-a" />
        <div className="lp-center-ring-b" />
        <div className="lp-center-glow" />
        <svg viewBox="0 0 80 80" fill="none" className="lp-center-svg">
          <defs>
            <linearGradient id="tG" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%"   stopColor="#2997FF" />
              <stop offset="100%" stopColor="#5E5CE6" />
            </linearGradient>
          </defs>
          <rect x="10" y="12" width="60" height="10" rx="4" fill="url(#tG)" />
          <rect x="30" y="12" width="20" height="56" rx="4" fill="url(#tG)" />
        </svg>
        <div className="lp-pedestal-a" />
        <div className="lp-pedestal-b" />
      </div>
    </div>
  );
}

/* ── Dashboard mockup ───────────────────────────────────────── */
function DashboardMockup() {
  const bars = [32, 48, 42, 64, 58, 76, 70, 84, 88, 96];
  const runs = [
    { n: 'SAP Logon Flow',  s: 'Passed',  c: '#34C759' },
    { n: 'User Management', s: 'Passed',  c: '#34C759' },
    { n: 'AI Mapping Sync', s: 'Running', c: '#2997FF' },
    { n: 'Purchase Order',  s: 'Failed',  c: '#FF453A' },
  ];
  return (
    <div className="lp-dm-shell">
      <div className="lp-dm-topbar">
        <div className="lp-dm-logo-row">
          <div className="lp-dm-logo-badge">TP</div>
          <span style={{ fontSize: '.76rem', fontWeight: 700 }}>TestPilot AI</span>
        </div>
        <div style={{ display: 'flex', gap: '.3rem' }}>
          {['▣','◎','◑','⊙'].map((ic, i) => <div key={i} className="lp-dm-top-icon">{ic}</div>)}
        </div>
        <div className="lp-dm-avatar">QM</div>
      </div>
      <div className="lp-dm-body">
        <div className="lp-dm-sidebar">
          {['Dashboard','Products','Knowledge','Library','Mapping','Execution','Reports','Settings'].map((item, i) => (
            <div key={item} className={`lp-dm-nav-item${i === 0 ? ' lp-dm-nav-active' : ''}`}>{item}</div>
          ))}
        </div>
        <div className="lp-dm-main">
          <div style={{ marginBottom: '.55rem' }}>
            <strong style={{ display: 'block', fontSize: '.8rem', fontWeight: 700, color: '#fff' }}>Automation Command Center</strong>
            <small style={{ fontSize: '.63rem', color: 'rgba(255,255,255,0.3)' }}>Product readiness · Knowledge health · Execution status</small>
          </div>
          <div className="lp-dm-kpi-row">
            {[{ l: 'Readiness', v: '86%' }, { l: 'Test Cases', v: '1,240' }, { l: 'Automations', v: '740' }, { l: 'Pass Rate', v: '97.4%' }].map(k => (
              <div key={k.l} className="lp-dm-kpi"><small>{k.l}</small><strong>{k.v}</strong></div>
            ))}
          </div>
          <div className="lp-dm-charts">
            <div className="lp-dm-chart-box">
              <div className="lp-dm-chart-label">Execution Trend</div>
              <div className="lp-dm-bars">
                {bars.map((h, i) => <div key={i} className="lp-dm-bar" style={{ height: `${h}%`, opacity: 0.5 + i * 0.05 }} />)}
              </div>
            </div>
            <div className="lp-dm-recent-box">
              <div className="lp-dm-chart-label">Recent Runs</div>
              {runs.map(r => (
                <div key={r.n} className="lp-dm-exec-row">
                  <span className="lp-dm-exec-name">{r.n}</span>
                  <span className="lp-dm-exec-pill" style={{ color: r.c, borderColor: r.c }}>{r.s}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Main Landing Page ──────────────────────────────────────── */
export function Landing() {
  return (
    <main className="lp-root">
      <StarField />
      <div className="lp-glow lp-g1" />
      <div className="lp-glow lp-g2" />
      <div className="lp-glow lp-g3" />

      {/* NAV */}
      <nav className="lp-nav">
        <div className="lp-nav-logo">
          <svg className="lp-nav-logo-icon" viewBox="0 0 30 30" fill="none">
            <path d="M15 2L2 8.5v13L15 28l13-6.5v-13L15 2z" fill="rgba(41,151,255,0.12)" stroke="#2997FF" strokeWidth="1.2"/>
            <text x="15" y="18.5" textAnchor="middle" fill="#2997FF" fontSize="9" fontWeight="700" fontFamily="-apple-system,sans-serif">T</text>
          </svg>
          <span className="lp-nav-brand"><strong>TEST</strong><span style={{ fontWeight: 400, color: 'rgba(255,255,255,0.55)' }}>pilot</span></span>
          <span className="lp-ai-badge">AI</span>
        </div>
        <div className="lp-nav-links">
          {['Platform','Solutions','Integrations','Resources','Pricing'].map((item, i) => (
            <a key={item} href="#" className="lp-nav-link">
              {item}{[0,1,3].includes(i) && <span className="lp-chev"> ▾</span>}
            </a>
          ))}
        </div>
        <div className="lp-nav-right">
          <a href="#" className="lp-nav-demo">Book a Demo</a>
          <Link to="/dashboard" className="lp-nav-cta">Get Started</Link>
        </div>
      </nav>

      {/* HERO */}
      <section className="lp-hero">
        <div>
          <div className="lp-hero-tag">AI‑Native · Local‑First · Enterprise‑Grade</div>
          <h1 className="lp-hero-h1">
            The Future of<br />
            Enterprise <span className="lp-pur-grad">Testing</span><br />
            is <span className="lp-pur-grad">Autonomous.</span>
          </h1>
          <p className="lp-hero-sub">
            Deploy a coordinated system of AI agents that understand, automate,
            and continuously heal your entire testing lifecycle — across SAP, Web, Desktop, API, and beyond.
          </p>
          <div className="lp-hero-actions">
            <Link to="/dashboard" className="lp-btn-launch">
              Start Free Trial <IcoArrow />
            </Link>
            <button className="lp-btn-watch">
              <span className="lp-play-circle">
                <svg width="8" height="8" viewBox="0 0 10 12" fill="white"><path d="M0 0l10 6-10 6z"/></svg>
              </span>
              Watch Demo
            </button>
          </div>
          <div className="lp-hero-badge-grid">
            {HERO_BADGES.map(({ icon, title, sub }) => (
              <div key={title} className="lp-hero-badge">
                <span style={{ color: 'var(--blue)', display: 'flex' }}>
                  <EntIcon type={icon} />
                </span>
                <div>
                  <strong>{title}</strong>
                  <small>{sub}</small>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="lp-hero-right">
          <OrbitRing />
        </div>
      </section>

      {/* TRUST */}
      <div className="lp-trust">
        <p className="lp-trust-title">Trusted by leading enterprises</p>
        <div className="lp-trust-row">
          {TRUST_LOGOS.map(logo => <div key={logo} className="lp-trust-logo">{logo}</div>)}
        </div>
      </div>

      {/* PLATFORM */}
      <section className="lp-section lp-section-alt">
        <div className="lp-section-wrap">
          <div className="lp-chip">One Unified Platform</div>
          <div className="lp-two-col lp-two-col-rev">
            <div>
              <h2 className="lp-h2">
                Everything You Need.<br />All in <span className="lp-pur-grad">One Cockpit.</span>
              </h2>
              <p className="lp-para" style={{ marginBottom: '1.4rem' }}>
                Stop context-switching between disconnected tools. TESTpilot unifies your entire
                quality engineering workflow under one intelligent platform.
              </p>
              <div className="lp-feat-list">
                {PLATFORM_FEATURES.map(f => (
                  <div key={f} className="lp-feat-row">
                    <span className="lp-feat-tick"><IcoCheck /></span>
                    {f}
                  </div>
                ))}
              </div>
              <Link to="/dashboard" className="lp-outline-btn" style={{ marginTop: '.5rem' }}>
                Explore Platform <IcoArrow />
              </Link>
            </div>
            <DashboardMockup />
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="lp-section lp-section-center">
        <div className="lp-section-wrap">
          <div className="lp-chip">How It Works</div>
          <h2 className="lp-h2">From Zero to <span className="lp-pur-grad">Autonomous</span><br />in Four Steps</h2>
          <p className="lp-para" style={{ maxWidth: 500, margin: '.5rem auto 3.5rem' }}>
            TESTpilot's knowledge-first methodology grounds every automation in a deep understanding of your application.
          </p>
          <div className="lp-steps-grid">
            {PROCESS_STEPS.map(step => (
              <div key={step.n} className="lp-step-card">
                <div className="lp-step-num">{step.n}</div>
                <div className="lp-step-line" />
                <h3 className="lp-step-title">{step.title}</h3>
                <p className="lp-step-desc">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* STATS */}
      <section className="lp-section lp-section-alt">
        <div className="lp-section-wrap">
          <div className="lp-chip">Engineered for Performance</div>
          <h2 className="lp-h2" style={{ textAlign: 'center' }}>Beyond Speed.<br /><span className="lp-pur-grad">Beyond Limits.</span></h2>
          <p className="lp-para" style={{ textAlign: 'center', maxWidth: 480, margin: '.5rem auto 2.75rem' }}>
            Built for enterprises that demand accuracy, security, and scale at every layer.
          </p>
          <div className="lp-stats-row">
            {STATS.map(s => (
              <div key={s.label} className="lp-stat-card">
                <strong className="lp-stat-val">{s.value}</strong>
                <span className="lp-stat-lbl">{s.label}</span>
                <span className="lp-stat-sub">{s.sub}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ENTERPRISE */}
      <section className="lp-section lp-section-center">
        <div className="lp-section-wrap">
          <div className="lp-chip">Enterprise Grade</div>
          <h2 className="lp-h2">Built for the Most<br /><span className="lp-pur-grad">Demanding Environments</span></h2>
          <p className="lp-para" style={{ maxWidth: 500, margin: '.5rem auto 2.75rem' }}>
            Designed from the ground up for enterprise security, compliance, and scale.
          </p>
          <div className="lp-ent-grid">
            {ENT_FEATURES.map(f => (
              <div key={f.title} className="lp-ent-card-v2">
                <div className="lp-ent-icon-wrap"><EntIcon type={f.icon} /></div>
                <h3 className="lp-ent-title">{f.title}</h3>
                <p className="lp-ent-desc">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="lp-section lp-cta-section">
        <div className="lp-section-wrap" style={{ textAlign: 'center' }}>
          <div className="lp-cta-glow" />
          <div className="lp-chip" style={{ justifyContent: 'center' }}>Get Started Today</div>
          <h2 className="lp-h2" style={{ maxWidth: 580, margin: '0 auto 1rem' }}>
            Ready to Transform<br />Your <span className="lp-pur-grad">Testing Operations?</span>
          </h2>
          <p className="lp-para" style={{ maxWidth: 440, margin: '0 auto 2.25rem' }}>
            Join enterprises already running TESTpilot. Set up your first product in under 30 minutes.
          </p>
          <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link to="/dashboard" className="lp-btn-launch" style={{ fontSize: '1rem' }}>
              Start Free Trial <IcoArrow />
            </Link>
            <a href="#" className="lp-btn-watch">
              <span className="lp-play-circle">
                <svg width="8" height="8" viewBox="0 0 10 12" fill="white"><path d="M0 0l10 6-10 6z"/></svg>
              </span>
              Schedule Demo
            </a>
          </div>
          <p style={{ marginTop: '1.75rem', fontSize: '.75rem', color: 'rgba(255,255,255,0.22)', letterSpacing: '.04em' }}>
            No credit card required · Deploy on-premises in minutes · 99.9% SLA
          </p>
        </div>
      </section>
    </main>
  );
}
