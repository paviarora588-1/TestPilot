'use client';

import { useQuery } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { AppWindow, Database, LayoutDashboard, Workflow } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/layout/page-header';
import { FailureTrendChart } from '@/components/charts/failure-trend-chart';
import { ModuleCoverageChart } from '@/components/charts/module-coverage-chart';
import { CountUp } from '@/components/motion/count-up';
import { StatCard } from '@/components/dashboard/stat-card';
import {
  getFailureTrends,
  getModuleCoverage,
  getQualityScore,
  listAutomationFlows,
  listExecutions,
  listObjectLibrary,
  listTestCases,
  listTestDataSets,
} from '@/lib/api';
import { useApplicationContext } from '@/lib/application-context';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/utils';
import type { ExecutionStatus } from '@/lib/types';

const EASE = [0.16, 1, 0.3, 1] as const;

function fadeUp(delay: number) {
  return {
    initial: { opacity: 0, y: 16 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.45, delay, ease: EASE },
  };
}

function relativeTime(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.round(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  return `${Math.round(hr / 24)}d ago`;
}

const STATUS_DOT: Record<ExecutionStatus, string> = {
  READY_TO_RUN: 'bg-muted-foreground',
  RUNNING: 'bg-sky-500',
  COMPLETED: 'bg-emerald-500',
  FAILED: 'bg-rose-500',
  BLOCKED: 'bg-amber-500',
};

const STATUS_LABEL: Record<ExecutionStatus, string> = {
  READY_TO_RUN: 'queued',
  RUNNING: 'is running',
  COMPLETED: 'passed',
  FAILED: 'failed',
  BLOCKED: 'was blocked',
};

function SideTile({
  label,
  value,
  icon: Icon,
  delay,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
  delay: number;
}) {
  return (
    <motion.div {...fadeUp(delay)} className="h-full">
      <Card className="flex h-full flex-col justify-between p-4">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-accent text-accent-foreground">
            <Icon className="h-3.5 w-3.5" />
          </span>
        </div>
        <p className="text-2xl font-bold tracking-tight">
          <CountUp value={value} />
        </p>
      </Card>
    </motion.div>
  );
}

function scoreTone(value: number) {
  return value >= 70
    ? { text: 'text-emerald-600 dark:text-emerald-400', bar: 'bg-emerald-500' }
    : value >= 40
      ? { text: 'text-[#A8660F] dark:text-[#DBA65B]', bar: 'bg-[#A8660F] dark:bg-[#DBA65B]' }
      : { text: 'text-rose-600 dark:text-rose-400', bar: 'bg-destructive' };
}

function QualityScoreCard({ applicationId }: { applicationId: string }) {
  const { data } = useQuery({
    queryKey: ['quality-score', applicationId],
    queryFn: () => getQualityScore(applicationId),
    enabled: !!applicationId,
  });

  if (!data) return null;

  if (data.score == null) {
    return (
      <motion.div {...fadeUp(0.32)}>
        <Card className="p-6">
          <p className="text-sm font-medium text-muted-foreground">Quality score</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Not enough data yet — scan the app and run some executions to see a blended quality score here.
          </p>
        </Card>
      </motion.div>
    );
  }

  const tone = scoreTone(data.score);

  return (
    <motion.div {...fadeUp(0.32)}>
      <Card className="flex flex-col gap-6 p-6 sm:flex-row sm:items-center">
        <div className="flex shrink-0 flex-col items-center gap-1 sm:border-r sm:border-border sm:pr-6">
          <p className={cn('text-4xl font-bold tracking-tight', tone.text)}>
            <CountUp value={data.score} />
          </p>
          <p className="text-xs font-medium text-muted-foreground">Quality score</p>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2.5">
          {data.components.map((c) => (
            <div key={c.label} className="flex items-center gap-3 text-sm">
              <span className="w-40 shrink-0 truncate text-muted-foreground">{c.label}</span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn('h-full rounded-full', scoreTone(c.value).bar)}
                  style={{ width: `${Math.round(c.value)}%` }}
                />
              </div>
              <span className="w-10 shrink-0 text-right font-mono text-xs text-muted-foreground">
                {Math.round(c.value)}%
              </span>
            </div>
          ))}
        </div>
      </Card>
    </motion.div>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const { selectedApplication, applications } = useApplicationContext();
  const appId = selectedApplication?.id;

  const { data: testCases = [] } = useQuery({
    queryKey: ['test-cases', appId],
    queryFn: () => listTestCases(appId!),
    enabled: !!appId,
  });
  const { data: objects = [] } = useQuery({
    queryKey: ['object-library', appId],
    queryFn: () => listObjectLibrary(appId!),
    enabled: !!appId,
  });
  const { data: flows = [] } = useQuery({
    queryKey: ['automation-flows', appId],
    queryFn: () => listAutomationFlows(appId!),
    enabled: !!appId,
  });
  const { data: dataSets = [] } = useQuery({
    queryKey: ['test-data-sets', appId],
    queryFn: () => listTestDataSets(appId!),
    enabled: !!appId,
  });
  const { data: coverage = [] } = useQuery({
    queryKey: ['report-coverage', appId],
    queryFn: () => getModuleCoverage(appId!),
    enabled: !!appId,
  });
  const { data: trends = [] } = useQuery({
    queryKey: ['report-trends', appId],
    queryFn: () => getFailureTrends(appId!),
    enabled: !!appId,
  });
  const { data: executions = [] } = useQuery({
    queryKey: ['executions', appId],
    queryFn: () => listExecutions(appId!),
    enabled: !!appId,
  });

  const automatable = testCases.filter((tc) => tc.automationStatus !== 'NOT_STARTED').length;
  const coveragePct = testCases.length > 0 ? Math.round((automatable / testCases.length) * 100) : 0;
  // Muted, ochre-leaning amber rather than Tailwind's default amber-500 —
  // that read as a jarring traffic-cone orange at this size against the
  // rest of the restrained paper/ink palette. Matches the softer amber
  // used throughout the rest of this design system.
  const health =
    coveragePct >= 70
      ? { text: 'text-emerald-600 dark:text-emerald-400', ring: 'rgb(16 185 129)' }
      : coveragePct >= 30
        ? { text: 'text-[#A8660F] dark:text-[#DBA65B]', ring: '#A8660F' }
        : { text: 'text-rose-600 dark:text-rose-400', ring: 'rgb(244 63 94)' };
  const recentExecutions = [...executions]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5);

  const circumference = 2 * Math.PI * 50;
  const offset = circumference * (1 - coveragePct / 100);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`Welcome back, ${user?.name ?? ''}`}
        icon={LayoutDashboard}
        description={
          selectedApplication
            ? `Live status for ${selectedApplication.name}.`
            : 'Select or create an application to see live status.'
        }
      />

      {selectedApplication ? (
        <>
          <QualityScoreCard applicationId={selectedApplication.id} />

          {/* Bento grid — one big load-bearing tile (the metric that actually
              matters day to day) instead of a row of same-sized boxes, plus
              four smaller counters filling the space beside it. */}
          <div className="grid auto-rows-[minmax(84px,auto)] grid-cols-2 gap-4 lg:grid-cols-4">
            <motion.div {...fadeUp(0)} className="row-span-2 sm:col-span-2">
              <Card className="flex h-full items-center gap-6 bg-accent/40 p-6">
                <div className="relative h-28 w-28 shrink-0">
                  <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
                    <circle cx="60" cy="60" r="50" fill="none" stroke="var(--border)" strokeWidth="9" />
                    <motion.circle
                      cx="60"
                      cy="60"
                      r="50"
                      fill="none"
                      stroke={health.ring}
                      strokeWidth="9"
                      strokeLinecap="round"
                      strokeDasharray={circumference}
                      initial={{ strokeDashoffset: circumference }}
                      animate={{ strokeDashoffset: offset }}
                      transition={{ duration: 1, delay: 0.3, ease: EASE }}
                    />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <p className={`text-2xl font-bold tracking-tight ${health.text}`}>
                      <CountUp value={coveragePct} suffix="%" />
                    </p>
                  </div>
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-muted-foreground">Automation coverage</p>
                  <p className="mt-1 text-sm text-foreground">
                    {automatable} of {testCases.length} test case(s) mapped or further along
                  </p>
                </div>
              </Card>
            </motion.div>

            <SideTile label="Applications" value={applications.length} icon={AppWindow} delay={0.08} />
            <SideTile label="Automation Flows" value={flows.length} icon={Workflow} delay={0.14} />
            <SideTile label="Object Library" value={objects.length} icon={Database} delay={0.2} />
            <SideTile label="Test Data Sets" value={dataSets.length} icon={Database} delay={0.26} />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
            <Card className="lg:col-span-3">
              <CardHeader>
                <CardTitle className="text-base">Execution trend</CardTitle>
                <CardDescription>Pass/fail outcomes over time</CardDescription>
              </CardHeader>
              <CardContent>
                <FailureTrendChart data={trends} />
              </CardContent>
            </Card>
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-base">Module coverage</CardTitle>
                <CardDescription>Automated vs. not-yet-automated test cases</CardDescription>
              </CardHeader>
              <CardContent>
                <ModuleCoverageChart data={coverage} />
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recent activity</CardTitle>
              <CardDescription>The last few executions for {selectedApplication.name}</CardDescription>
            </CardHeader>
            <CardContent>
              {recentExecutions.length === 0 ? (
                <p className="text-sm text-muted-foreground">No executions yet — run a script to see activity here.</p>
              ) : (
                <div className="flex flex-col gap-3">
                  {recentExecutions.map((run, i) => (
                    <motion.div
                      key={run.id}
                      {...fadeUp(0.05 * i)}
                      className="flex items-center gap-3 text-sm"
                    >
                      <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[run.status]}`} />
                      <span className="min-w-0 flex-1 truncate">
                        <span className="font-medium">{run.script?.automationFlow?.name ?? 'Execution'}</span>{' '}
                        <span className="text-muted-foreground">{STATUS_LABEL[run.status]}</span>
                      </span>
                      <span className="shrink-0 font-mono text-xs text-muted-foreground">{relativeTime(run.createdAt)}</span>
                    </motion.div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Applications" value={applications.length} icon={AppWindow} />
        </div>
      )}
    </div>
  );
}
