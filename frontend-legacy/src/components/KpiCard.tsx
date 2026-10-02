import type { ReactNode } from 'react';

const ICON_PALETTE: Record<string, { a: string; b: string; s: string }> = {
  P: { a: '#2563eb', b: '#3b82f6', s: 'rgba(37,99,235,0.28)' },
  K: { a: '#16a34a', b: '#22c55e', s: 'rgba(22,163,74,0.28)' },
  L: { a: '#7c3aed', b: '#a855f7', s: 'rgba(124,58,237,0.28)' },
  M: { a: '#d97706', b: '#f59e0b', s: 'rgba(217,119,6,0.28)' },
  T: { a: '#0891b2', b: '#22d3ee', s: 'rgba(8,145,178,0.28)' },
  A: { a: '#ea580c', b: '#f97316', s: 'rgba(234,88,12,0.28)' },
  U: { a: '#64748b', b: '#94a3b8', s: 'rgba(100,116,139,0.28)' },
  G: { a: '#0d9488', b: '#14b8a6', s: 'rgba(13,148,136,0.28)' },
  F: { a: '#dc2626', b: '#f87171', s: 'rgba(220,38,38,0.28)' },
  E: { a: '#059669', b: '#10b981', s: 'rgba(5,150,105,0.28)' },
  S: { a: '#4f46e5', b: '#818cf8', s: 'rgba(79,70,229,0.28)' },
};

function KpiSvg({ children }: { children: ReactNode }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
      stroke="white" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

function getKpiIcon(label: string): ReactNode {
  const l = label.toLowerCase();

  if (l.includes('readiness') || l.includes('ready')) return (
    <KpiSvg><path d="M12 2a10 10 0 1 0 10 10"/><path d="M12 2a10 10 0 0 1 7.74 3.64"/><path d="M12 12 8.5 8.5"/><circle cx="12" cy="12" r="2"/></KpiSvg>
  );
  if (l.includes('knowledge') && !l.includes('source')) return (
    <KpiSvg><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></KpiSvg>
  );
  if (l.includes('library') || (l.includes('object') && !l.includes('test'))) return (
    <KpiSvg><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></KpiSvg>
  );
  if (l.includes('mapping') && !l.includes('step')) return (
    <KpiSvg><rect x="2" y="3" width="6" height="6" rx="1"/><rect x="16" y="3" width="6" height="6" rx="1"/><rect x="9" y="15" width="6" height="6" rx="1"/><path d="M5 9v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9"/><line x1="12" y1="14" x2="12" y2="15"/></KpiSvg>
  );
  if (l.includes('script') || l.includes('generated')) return (
    <KpiSvg><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><polyline points="10 12 8 14 10 16"/><polyline points="14 12 16 14 14 16"/></KpiSvg>
  );
  if (l.includes('test') || l.includes('case') || l.includes('quality')) return (
    <KpiSvg><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></KpiSvg>
  );
  if (l.includes('heal')) return (
    <KpiSvg><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></KpiSvg>
  );
  if (l.includes('source') || l.includes('upload') || l.includes('chunk')) return (
    <KpiSvg><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></KpiSvg>
  );
  if (l.includes('step') || l.includes('unmapped') || l.includes('mapped')) return (
    <KpiSvg><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></KpiSvg>
  );
  if (l.includes('execution') || l.includes('run')) return (
    <KpiSvg><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></KpiSvg>
  );
  if (l.includes('history') || l.includes('event')) return (
    <KpiSvg><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></KpiSvg>
  );
  if (l.includes('total') || (l.includes('product') && !l.includes('readiness'))) return (
    <KpiSvg><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></KpiSvg>
  );
  // default: sparkle/star
  return (
    <KpiSvg><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></KpiSvg>
  );
}

export function KpiCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  const key = label.charAt(0).toUpperCase();
  const pal = ICON_PALETTE[key] ?? ICON_PALETTE.P;
  return (
    <div className="metric-card flex items-center gap-4">
      <div
        className="metric-icon"
        style={{
          background: `linear-gradient(135deg, ${pal.a}, ${pal.b})`,
          boxShadow: `0 6px 20px ${pal.s}`,
        }}
      >
        {getKpiIcon(label)}
      </div>
      <div className="min-w-0">
        <p className="text-[11px] font-bold uppercase tracking-wide text-muted">{label}</p>
        <strong className="metric-value">{value}</strong>
        <p className="truncate text-xs text-muted">{detail}</p>
      </div>
    </div>
  );
}
