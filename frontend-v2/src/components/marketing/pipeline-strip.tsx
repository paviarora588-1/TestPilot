'use client';

import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, FileCode2, Library, PlayCircle, ScanSearch, Workflow } from 'lucide-react';

const STAGES = [
  { icon: ScanSearch, label: 'Scan' },
  { icon: Library, label: 'Detect' },
  { icon: Workflow, label: 'Draft' },
  { icon: FileCode2, label: 'Generate' },
  { icon: CheckCircle2, label: 'Verify' },
  { icon: PlayCircle, label: 'Execute' },
] as const;

// Fraction of one loop (0-1) at which each stage lights up, and the fill
// line reaches it — spaced to feel like a real pipeline advancing, not a
// uniform metronome.
const REVEAL_AT = [0.05, 0.22, 0.4, 0.58, 0.76, 0.9];
const TARGETS = { objects: 18, cases: 6, passed: 5, failed: 1 };
const LOOP_MS = 6000;

export function PipelineStrip({ runId = '8842', appName = 'OrangeHRM' }: { runId?: string; appName?: string }) {
  const [reduced] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
  const [animatedLit, setLit] = useState<boolean[]>(() => STAGES.map(() => false));
  const [animatedFillPct, setFillPct] = useState(5);
  const [animatedMetrics, setMetrics] = useState({ objects: 0, cases: 0, passed: 0, failed: 0 });
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    if (reduced) return;
    let raf = 0;
    let lastUpdate = 0;
    // Throttled to ~12 updates/sec — this is a multi-second loop, not
    // something that benefits from a full 60fps React re-render, and
    // updating four numbers + six booleans on every animation frame was
    // pure render pressure for no visible smoothness gain.
    const UPDATE_INTERVAL = 80;
    function frame(ts: number) {
      if (startRef.current === null) startRef.current = ts;
      if (ts - lastUpdate < UPDATE_INTERVAL) {
        raf = requestAnimationFrame(frame);
        return;
      }
      lastUpdate = ts;
      const p = ((ts - startRef.current) % LOOP_MS) / LOOP_MS;
      setFillPct(5 + p * 85);
      setLit(REVEAL_AT.map((r) => p >= r));
      setMetrics({
        objects: Math.round(Math.min(1, p / 0.3) * TARGETS.objects),
        cases: Math.round(Math.min(1, Math.max(0, (p - 0.25) / 0.3)) * TARGETS.cases),
        passed: Math.round(Math.min(1, Math.max(0, (p - 0.55) / 0.3)) * TARGETS.passed),
        failed: Math.round(Math.min(1, Math.max(0, (p - 0.7) / 0.25)) * TARGETS.failed),
      });
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [reduced]);

  const lit = reduced ? STAGES.map(() => true) : animatedLit;
  const fillPct = reduced ? 90 : animatedFillPct;
  const metrics = reduced ? TARGETS : animatedMetrics;

  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-7">
      <div className="mb-6 flex items-center justify-between">
        <p className="font-mono text-xs text-muted-foreground">
          RUN <span className="font-semibold text-foreground">#{runId}</span> · {appName} · Staging
        </p>
        <p className="flex items-center gap-1.5 font-mono text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
          LIVE
        </p>
      </div>

      <div className="relative grid grid-cols-3 gap-y-5 gap-x-2 sm:grid-cols-6 sm:gap-x-3">
        <div className="absolute left-[8%] right-[8%] top-[20px] hidden h-0.5 bg-border sm:block" />
        <div
          className="absolute left-[8%] top-[20px] hidden h-0.5 bg-emerald-500 transition-[width] duration-300 ease-linear sm:block"
          style={{ width: `${fillPct * 0.84}%` }}
        />
        {STAGES.map((stage, i) => (
          <div key={stage.label} className="relative z-10 text-center">
            <div
              className={
                'mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full border-2 transition-colors duration-300 ' +
                (lit[i]
                  ? 'border-emerald-500 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                  : 'border-border bg-card text-muted-foreground')
              }
            >
              <stage.icon className="h-4 w-4" />
            </div>
            <p className={'text-[11px] font-semibold ' + (lit[i] ? 'text-foreground' : 'text-muted-foreground')}>
              {stage.label}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-7 grid grid-cols-2 gap-3 border-t border-border pt-5 sm:grid-cols-4">
        <PipelineMetric label="Objects found" value={metrics.objects} />
        <PipelineMetric label="Cases drafted" value={metrics.cases} />
        <PipelineMetric label="Passed" value={metrics.passed} className="text-emerald-600 dark:text-emerald-400" />
        <PipelineMetric label="Failed" value={metrics.failed} className="text-rose-600 dark:text-rose-400" />
      </div>
    </div>
  );
}

function PipelineMetric({ label, value, className }: { label: string; value: number; className?: string }) {
  return (
    <div className="text-center">
      <p className={'font-mono text-lg font-bold tabular-nums ' + (className ?? '')}>{value}</p>
      <p className="mt-0.5 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
    </div>
  );
}
