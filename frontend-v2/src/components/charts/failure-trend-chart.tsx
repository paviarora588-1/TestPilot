'use client';

import { CheckCircle2, XCircle } from 'lucide-react';
import type { FailureTrendPoint } from '@/lib/types';

// Pass/fail is a status pair (good/critical), not an arbitrary "series 4" —
// validated with the dataviz skill's validate_palette.js against this app's
// real card surfaces (#ffffff light / #0c0f16 dark). Status color never
// carries meaning alone, so both the legend and the tooltip pair it with an
// icon + label, per the skill's status-collision rule.
const CHART_VARS = '[--tp-good:#0ca30c] [--tp-critical:#d03b3b]';
const CHART_HEIGHT = 160;

function niceCeil(n: number): number {
  if (n <= 5) return 5;
  const magnitude = 10 ** Math.floor(Math.log10(n));
  const residual = n / magnitude;
  const niceResidual = residual <= 1 ? 1 : residual <= 2 ? 2 : residual <= 5 ? 5 : 10;
  return niceResidual * magnitude;
}

function formatDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function FailureTrendChart({ data }: { data: FailureTrendPoint[] }) {
  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground">No executions yet — run a script to see trends here.</p>;
  }

  const maxTotal = niceCeil(Math.max(1, ...data.map((d) => d.passed + d.failed)));

  return (
    <div className={`flex flex-col gap-4 ${CHART_VARS}`}>
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <CheckCircle2 className="h-3.5 w-3.5 text-[var(--tp-good)]" />
          Passed
        </span>
        <span className="flex items-center gap-1.5">
          <XCircle className="h-3.5 w-3.5 text-[var(--tp-critical)]" />
          Failed
        </span>
      </div>

      <div className="flex gap-3">
        <div className="flex flex-col justify-between py-0 text-[10px] text-muted-foreground" style={{ height: CHART_HEIGHT }}>
          <span>{maxTotal}</span>
          <span>{Math.round(maxTotal / 2)}</span>
          <span>0</span>
        </div>

        <div className="relative flex flex-1 items-end justify-around gap-2 border-l border-b border-border pl-2" style={{ height: CHART_HEIGHT }}>
          <div className="pointer-events-none absolute inset-x-0 top-0 border-t border-dashed border-border/60" />
          <div className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-dashed border-border/60" />

          {data.map((point) => {
            const total = point.passed + point.failed;
            const passedH = (point.passed / maxTotal) * CHART_HEIGHT;
            const failedH = (point.failed / maxTotal) * CHART_HEIGHT;
            const gap = point.passed > 0 && point.failed > 0 ? 2 : 0;

            return (
              <div
                key={point.date}
                tabIndex={0}
                className="group relative flex w-6 flex-col items-center gap-1.5 outline-none"
              >
                <div className="flex flex-col-reverse" style={{ height: CHART_HEIGHT }}>
                  {point.failed > 0 ? (
                    <div
                      className="w-6 rounded-t-[4px] bg-[var(--tp-critical)]"
                      style={{ height: failedH, marginBottom: gap }}
                    />
                  ) : null}
                  {point.passed > 0 ? (
                    <div
                      className="w-6 bg-[var(--tp-good)]"
                      style={{ height: passedH, borderRadius: point.failed > 0 ? '0 0 0 0' : '4px 4px 0 0' }}
                    />
                  ) : null}
                  {total === 0 ? <div className="h-1 w-6 rounded-full bg-border" /> : null}
                </div>
                <span className="text-[10px] text-muted-foreground">{formatDate(point.date)}</span>

                <div
                  role="tooltip"
                  className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs opacity-0 shadow-md transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                >
                  <div className="font-medium text-popover-foreground">{formatDate(point.date)}</div>
                  <div className="flex items-center gap-1">
                    <span className="font-semibold text-popover-foreground">{point.passed}</span>
                    <span className="text-muted-foreground">passed</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="font-semibold text-popover-foreground">{point.failed}</span>
                    <span className="text-muted-foreground">failed</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
