'use client';

import type { LucideIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { CountUp } from '@/components/motion/count-up';
import { cn } from '@/lib/utils';

// 'brand' is the default, non-semantic look — used for plain counts
// (Applications, Test Cases, etc.) where color carries no meaning. The other
// three are reserved for genuinely semantic health/status signals (e.g.
// automation coverage swinging from healthy to at-risk) — kept visually
// distinct from the brand accent on purpose, so a red/amber tile still reads
// as "something needs attention" rather than just decorative variety.
const ACCENTS = {
  brand: { icon: 'bg-accent text-accent-foreground', text: 'text-foreground' },
  emerald: { icon: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400', text: 'text-emerald-600 dark:text-emerald-400' },
  // Muted ochre rather than Tailwind's default amber-500 — matches the
  // softer amber used everywhere else in this design system.
  amber: { icon: 'bg-[#A8660F]/10 text-[#A8660F] dark:text-[#DBA65B]', text: 'text-[#A8660F] dark:text-[#DBA65B]' },
  rose: { icon: 'bg-rose-500/10 text-rose-600 dark:text-rose-400', text: 'text-rose-600 dark:text-rose-400' },
} as const;

export type StatCardAccent = keyof typeof ACCENTS;

export function StatCard({
  label,
  value,
  suffix = '',
  icon: Icon,
  accent = 'brand',
  subtext,
  className,
}: {
  label: string;
  value: number;
  suffix?: string;
  icon: LucideIcon;
  accent?: StatCardAccent;
  subtext?: string;
  className?: string;
}) {
  const colors = ACCENTS[accent];
  return (
    <Card className={cn('h-full transition-transform hover:-translate-y-0.5', className)}>
      <CardContent className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className={cn('mt-1.5 text-3xl font-bold tracking-tight', colors.text)}>
            <CountUp value={value} suffix={suffix} />
          </p>
          {subtext ? <p className="mt-1 truncate text-xs text-muted-foreground">{subtext}</p> : null}
        </div>
        <div className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl', colors.icon)}>
          <Icon className="h-5 w-5" />
        </div>
      </CardContent>
    </Card>
  );
}
