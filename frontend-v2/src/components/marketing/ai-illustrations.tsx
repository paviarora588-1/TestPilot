'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowRight, CheckCircle2, MousePointerClick, SquarePen } from 'lucide-react';

function useReducedMotion() {
  const [reduced] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
  return reduced;
}

// 01 — Computer vision: three fields "detected" in sequence, confidence
// counting up live, with a soft sweep passing over the card as it goes.
const SCAN_FIELDS = [
  { label: 'Username', tag: 'input:text', conf: 0.98 },
  { label: 'Password', tag: 'input:password', conf: 0.96 },
  { label: 'Login', tag: 'button:submit', conf: 0.99 },
];
const SCAN_REVEAL_AT = [0.18, 0.42, 0.66];
const SCAN_DUR = 2600;
const SCAN_HOLD = 1500;

export function ScanIllustration() {
  const reduced = useReducedMotion();
  const [animatedOn, setOn] = useState<boolean[]>([false, false, false]);
  const [animatedConf, setConf] = useState([0, 0, 0]);
  const [animatedResultOn, setResultOn] = useState(false);
  const [sweepPct, setSweepPct] = useState(0);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    if (reduced) return;
    let raf = 0;
    let lastUpdate = 0;
    const UPDATE_INTERVAL = 80; // throttled — no need for a 60fps re-render on a multi-second loop
    const RISE_FRAC = 0.15; // fraction of SCAN_DUR the count-up takes once a field reveals
    function frame(ts: number) {
      if (startRef.current === null) startRef.current = ts;
      if (ts - lastUpdate < UPDATE_INTERVAL) {
        raf = requestAnimationFrame(frame);
        return;
      }
      lastUpdate = ts;
      const t = (ts - startRef.current) % (SCAN_DUR + SCAN_HOLD);
      if (t < SCAN_DUR) {
        const frac = t / SCAN_DUR;
        setSweepPct(frac * 100);
        setOn(SCAN_REVEAL_AT.map((r) => frac >= r));
        setConf(SCAN_REVEAL_AT.map((r, i) => (frac >= r ? Math.min(1, (frac - r) / RISE_FRAC) * SCAN_FIELDS[i].conf : 0)));
        setResultOn(false);
      } else {
        setResultOn(true);
        if (t > SCAN_DUR + SCAN_HOLD - 250) {
          setOn([false, false, false]);
          setConf([0, 0, 0]);
        }
      }
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [reduced]);

  const on = reduced ? SCAN_FIELDS.map(() => true) : animatedOn;
  const conf = reduced ? SCAN_FIELDS.map((field) => field.conf) : animatedConf;
  const resultOn = reduced || animatedResultOn;

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="flex gap-1.5 border-b border-border bg-muted/40 px-3 py-2">
        <span className="h-2 w-2 rounded-full bg-border" />
        <span className="h-2 w-2 rounded-full bg-border" />
        <span className="h-2 w-2 rounded-full bg-border" />
      </div>
      <div className="relative flex flex-col gap-2.5 p-4">
        {!reduced ? (
          <div
            className="pointer-events-none absolute inset-x-0 top-0 h-10 bg-gradient-to-b from-transparent via-primary/[0.06] to-transparent transition-[transform] duration-100"
            style={{ transform: `translateY(${sweepPct}%)` }}
          />
        ) : null}
        {SCAN_FIELDS.map((f, i) => (
          <div
            key={f.label}
            className={
              'flex items-center justify-between gap-2 rounded-lg border px-3 py-2.5 text-sm transition-colors duration-300 ' +
              (on[i] ? 'border-primary/50 bg-accent' : 'border-dashed border-border bg-muted/30')
            }
          >
            <div className="flex min-w-0 items-center gap-2">
              <span
                className={
                  'h-2 w-2 shrink-0 border-l-2 border-t-2 transition-opacity ' + (on[i] ? 'opacity-100' : 'opacity-0')
                }
                style={{ borderColor: 'var(--accent-foreground)' }}
              />
              <span className="truncate font-medium">{f.label}</span>
              <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{f.tag}</span>
            </div>
            <span
              className={'shrink-0 font-mono text-xs font-semibold text-accent-foreground transition-opacity ' + (on[i] ? 'opacity-100' : 'opacity-0')}
            >
              {conf[i].toFixed(2)}
            </span>
          </div>
        ))}
      </div>
      <div
        className={'border-t border-border px-4 py-2.5 text-center font-mono text-xs text-emerald-600 transition-opacity dark:text-emerald-400 ' + (resultOn ? 'opacity-100' : 'opacity-0')}
      >
        3 objects detected · avg. confidence 0.98
      </div>
    </div>
  );
}

// 02 — Flow synthesis: object + test data feed an "AI" node, which drafts a
// connected sequence of flow steps one at a time.
const FLOW_STEPS = [
  { icon: ArrowRight, label: 'Open login page' },
  { icon: SquarePen, label: 'Enter username' },
  { icon: SquarePen, label: 'Enter password' },
  { icon: MousePointerClick, label: 'Click login' },
  { icon: CheckCircle2, label: 'Verify dashboard loads' },
];

export function FlowIllustration() {
  const reduced = useReducedMotion();
  const [count, setCount] = useState(reduced ? FLOW_STEPS.length : 0);

  useEffect(() => {
    if (reduced) return;
    let cancelled = false;
    function playOnce() {
      setCount(0);
      FLOW_STEPS.forEach((_, i) => {
        setTimeout(() => {
          if (!cancelled) setCount(i + 1);
        }, i * 400);
      });
      setTimeout(() => {
        if (!cancelled) playOnce();
      }, FLOW_STEPS.length * 400 + 1900);
    }
    playOnce();
    return () => {
      cancelled = true;
    };
  }, [reduced]);

  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <p className="font-mono text-[11px] font-medium tracking-wide text-muted-foreground uppercase">AI Flow Synthesis</p>
        <p className="flex items-center gap-1.5 font-mono text-[11px] text-emerald-600 dark:text-emerald-400">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
          drafting
        </p>
      </div>
      <div className="relative ml-5 mt-1 border-l-2 border-border pt-1">
        {FLOW_STEPS.map((step, i) => {
          const on = i < count;
          return (
            <div
              key={step.label}
              className={'relative pb-3.5 pl-6 transition-all duration-300 ' + (on ? 'opacity-100' : 'opacity-0 -translate-x-2')}
            >
              <span
                className={
                  'absolute -left-[9px] top-[9px] h-3.5 w-3.5 rounded-full border-2 transition-colors duration-300 ' +
                  (on ? 'border-emerald-500 bg-emerald-500' : 'border-border bg-card')
                }
              />
              <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 px-3.5 py-2.5 text-sm font-medium">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                  <step.icon className="h-4 w-4" />
                </span>
                {step.label}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// 03 — Risk review: a checklist ticks off one item at a time, then a seal
// stamps in as the verdict.
const CHECKS = ['No hardcoded secrets', 'No destructive actions', 'Locators confidence > 0.9', 'Assertions present'];

export function ReviewIllustration() {
  const reduced = useReducedMotion();
  const [count, setCount] = useState(reduced ? CHECKS.length : 0);
  const [sealOn, setSealOn] = useState(reduced);

  useEffect(() => {
    if (reduced) return;
    let cancelled = false;
    function playOnce() {
      setCount(0);
      setSealOn(false);
      CHECKS.forEach((_, i) => {
        setTimeout(() => {
          if (!cancelled) setCount(i + 1);
        }, i * 380);
      });
      setTimeout(() => {
        if (!cancelled) setSealOn(true);
      }, CHECKS.length * 380 + 250);
      setTimeout(() => {
        if (!cancelled) playOnce();
      }, CHECKS.length * 380 + 2400);
    }
    playOnce();
    return () => {
      cancelled = true;
    };
  }, [reduced]);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 rounded-xl border border-border bg-card p-6 shadow-sm">
      <p className="self-start font-mono text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        AI Risk Review
      </p>
      <div className="flex w-full max-w-[230px] flex-col gap-2.5">
        {CHECKS.map((label, i) => {
          const on = i < count;
          return (
            <div key={label} className={'flex items-center gap-2.5 text-sm transition-colors ' + (on ? 'text-foreground' : 'text-muted-foreground')}>
              <span
                className={
                  'flex h-4 w-4 shrink-0 items-center justify-center rounded border-[1.5px] transition-colors duration-300 ' +
                  (on ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-border')
                }
              >
                {on ? <CheckCircle2 className="h-3 w-3" strokeWidth={3} /> : null}
              </span>
              {label}
            </div>
          );
        })}
      </div>
      <div className={'flex items-center gap-2 transition-all duration-300 ' + (sealOn ? 'scale-100 opacity-100' : 'scale-75 opacity-0')}>
        <svg width="36" height="36" viewBox="0 0 40 40">
          <circle cx="20" cy="20" r="16" fill="none" stroke="rgb(16 185 129)" strokeWidth="2.5" />
          <path d="M12 21l5 5 10-11" fill="none" stroke="rgb(16 185 129)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="font-mono text-xs font-semibold text-emerald-600 dark:text-emerald-400">Approved to run</span>
      </div>
    </div>
  );
}
