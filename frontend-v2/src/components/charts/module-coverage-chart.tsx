'use client';

import type { ModuleCoverage } from '@/lib/types';

// Palette validated with the dataviz skill's validate_palette.js against this
// app's real card surfaces (#ffffff light / #0c0f16 dark): an "emphasis" chart
// (one hue = the story, gray = context), not full categorical — automation
// coverage is the point, the un-automated remainder is backdrop. Accent hue
// matches the app-wide cyan primary rather than an unrelated brand color.
const CHART_VARS =
  '[--tp-accent:#0e7490] [--tp-muted-bar:#737373] dark:[--tp-accent:#22d3ee] dark:[--tp-muted-bar:#8c929f]';

function CoverageRow({ item }: { item: ModuleCoverage }) {
  const total = item.testCases || 1;
  const automatedPct = (item.automated / total) * 100;
  const manualCount = item.testCases - item.automated;
  const manualPct = 100 - automatedPct;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-medium">{item.module}</span>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>
            {item.automated}/{item.testCases} automated
          </span>
          <span className="rounded-full bg-[var(--tp-accent)]/15 px-2 py-0.5 font-semibold text-[var(--tp-accent)]">
            {item.coverage}%
          </span>
        </div>
      </div>
      <div className="flex h-2.5 w-full gap-[2px]" role="img" aria-label={`${item.module}: ${item.coverage}% automated`}>
        {automatedPct > 0 ? (
          <div
            tabIndex={0}
            className="group relative h-full rounded-full bg-[var(--tp-accent)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--tp-accent)]"
            style={{ width: `${automatedPct}%` }}
          >
            <Tooltip label="Automated" value={item.automated} colorVar="--tp-accent" />
          </div>
        ) : null}
        {manualPct > 0 ? (
          <div
            tabIndex={0}
            className="group relative h-full rounded-full bg-[var(--tp-muted-bar)]/40 outline-none focus-visible:ring-2 focus-visible:ring-[var(--tp-muted-bar)]"
            style={{ width: `${manualPct}%` }}
          >
            <Tooltip label="Not automated" value={manualCount} colorVar="--tp-muted-bar" />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Tooltip({ label, value, colorVar }: { label: string; value: number; colorVar: string }) {
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs opacity-0 shadow-md transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
    >
      <span className="font-semibold text-popover-foreground">{value}</span>
      <span className="ml-1 inline-block h-2 w-2 rounded-full align-middle" style={{ background: `var(${colorVar})` }} />
      <span className="ml-1 text-muted-foreground">{label}</span>
    </div>
  );
}

export function ModuleCoverageChart({ data }: { data: ModuleCoverage[] }) {
  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground">No test cases mapped to modules yet.</p>;
  }

  return (
    <div className={`flex flex-col gap-4 ${CHART_VARS}`}>
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-[var(--tp-accent)]" />
          Automated
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-[var(--tp-muted-bar)]/40" />
          Not automated
        </span>
      </div>
      <div className="flex flex-col gap-3">
        {data.map((item) => (
          <CoverageRow key={item.module} item={item} />
        ))}
      </div>
    </div>
  );
}
