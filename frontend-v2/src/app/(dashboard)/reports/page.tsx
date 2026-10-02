'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, Download, FileSpreadsheet, FileText } from 'lucide-react';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageHeader } from '@/components/layout/page-header';
import { FailureTrendChart } from '@/components/charts/failure-trend-chart';
import { ModuleCoverageChart } from '@/components/charts/module-coverage-chart';
import { AnimatedTableBody, AnimatedTableRow } from '@/components/motion/animated-table';
import { CountUp } from '@/components/motion/count-up';
import { cn } from '@/lib/utils';
import { downloadReport, getFailureBreakdown, getFailureTrends, getModuleCoverage, getReportSummary } from '@/lib/api';
import { useApplicationContext } from '@/lib/application-context';
import type { ExecutionStatus } from '@/lib/types';

const EASE = [0.16, 1, 0.3, 1] as const;

const STATUS_VARIANT: Record<ExecutionStatus, 'success' | 'secondary' | 'destructive' | 'outline' | 'info'> = {
  READY_TO_RUN: 'outline',
  RUNNING: 'info',
  COMPLETED: 'success',
  FAILED: 'destructive',
  BLOCKED: 'destructive',
};

const STATUS_DOT: Record<ExecutionStatus, string> = {
  READY_TO_RUN: 'bg-muted-foreground',
  RUNNING: 'bg-sky-500 animate-pulse',
  COMPLETED: 'bg-emerald-500',
  FAILED: 'bg-destructive',
  BLOCKED: 'bg-destructive',
};

function StatTile({ label, value, suffix = '' }: { label: string; value: number; suffix?: string }) {
  return (
    <Card className="flex h-full flex-col justify-between p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="text-2xl font-bold tracking-tight">
        <CountUp value={value} suffix={suffix} />
      </p>
    </Card>
  );
}

export default function ReportsPage() {
  const { selectedApplication } = useApplicationContext();
  const appId = selectedApplication?.id;
  const [downloading, setDownloading] = useState<'csv' | 'xlsx' | 'pdf' | null>(null);

  const { data: summary } = useQuery({
    queryKey: ['report-summary', appId],
    queryFn: () => getReportSummary(appId!),
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
  const { data: breakdown } = useQuery({
    queryKey: ['report-failure-breakdown', appId],
    queryFn: () => getFailureBreakdown(appId!),
    enabled: !!appId,
  });

  if (!selectedApplication) {
    return (
      <div>
        <PageHeader title="Reports" icon={BarChart3} />
        <Card>
          <CardContent className="p-6 text-muted-foreground">
            Create an application first, then select it from the switcher in the top bar.
          </CardContent>
        </Card>
      </div>
    );
  }

  async function handleExport(format: 'csv' | 'xlsx' | 'pdf') {
    setDownloading(format);
    try {
      await downloadReport(appId!, format);
    } catch {
      toast.error(`Failed to export ${format.toUpperCase()}`);
    } finally {
      setDownloading(null);
    }
  }

  const circumference = 2 * Math.PI * 50;
  const passOffset = summary ? circumference * (1 - summary.passRate / 100) : circumference;
  const passRingColor =
    summary && summary.passRate >= 70 ? 'rgb(16 185 129)' : summary && summary.passRate >= 30 ? '#A8660F' : 'rgb(244 63 94)';
  const passTextClass =
    summary && summary.passRate >= 70
      ? 'text-emerald-600 dark:text-emerald-400'
      : summary && summary.passRate >= 30
        ? 'text-[#A8660F] dark:text-[#DBA65B]'
        : 'text-rose-600 dark:text-rose-400';

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageHeader
          title="Reports"
          icon={BarChart3}
          description={`Coverage, failure trends, and object health for ${selectedApplication.name}.`}
        />
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={downloading === 'csv'} onClick={() => handleExport('csv')}>
            <Download className="mr-2 h-4 w-4" />
            CSV
          </Button>
          <Button variant="outline" size="sm" disabled={downloading === 'xlsx'} onClick={() => handleExport('xlsx')}>
            <FileSpreadsheet className="mr-2 h-4 w-4" />
            Excel
          </Button>
          <Button variant="outline" size="sm" disabled={downloading === 'pdf'} onClick={() => handleExport('pdf')}>
            <FileText className="mr-2 h-4 w-4" />
            PDF
          </Button>
        </div>
      </div>

      {summary ? (
        <div className="grid auto-rows-[minmax(84px,auto)] grid-cols-2 gap-4 lg:grid-cols-4">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: EASE }}
            className="row-span-2 sm:col-span-2"
          >
            <Card className="flex h-full items-center gap-6 bg-accent/40 p-6">
              <div className="relative h-28 w-28 shrink-0">
                <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
                  <circle cx="60" cy="60" r="50" fill="none" stroke="var(--border)" strokeWidth="9" />
                  <motion.circle
                    cx="60"
                    cy="60"
                    r="50"
                    fill="none"
                    stroke={passRingColor}
                    strokeWidth="9"
                    strokeLinecap="round"
                    strokeDasharray={circumference}
                    initial={{ strokeDashoffset: circumference }}
                    animate={{ strokeDashoffset: passOffset }}
                    transition={{ duration: 1, delay: 0.3, ease: EASE }}
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <p className={cn('text-2xl font-bold tracking-tight', passTextClass)}>
                    <CountUp value={summary.passRate} suffix="%" />
                  </p>
                </div>
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-muted-foreground">Pass rate</p>
                <p className="mt-1 text-sm text-foreground">
                  {summary.passedExecutions} of {summary.totalExecutions} execution(s) passed
                  {summary.failedExecutions > 0 ? ` · ${summary.failedExecutions} failed` : ''}
                  {summary.blockedExecutions > 0 ? ` · ${summary.blockedExecutions} blocked` : ''}
                </p>
              </div>
            </Card>
          </motion.div>

          <StatTile label="Automation coverage" value={summary.automationCoverage} suffix="%" />
          <StatTile label="Total executions" value={summary.totalExecutions} />
          <StatTile label="Object health (working)" value={summary.objectHealth.working} suffix={` / ${summary.totalObjects}`} />
          <StatTile label="Automated test cases" value={summary.automatedTestCases} suffix={` / ${summary.totalTestCases}`} />
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Module coverage</CardTitle>
            <CardDescription>Automated vs. not-yet-automated test cases, by module.</CardDescription>
          </CardHeader>
          <CardContent>
            <ModuleCoverageChart data={coverage} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Execution trend</CardTitle>
            <CardDescription>Pass/fail outcomes over time.</CardDescription>
          </CardHeader>
          <CardContent>
            <FailureTrendChart data={trends} />
          </CardContent>
        </Card>
      </div>

      {breakdown ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">First-run pass rate</CardTitle>
            <CardDescription>
              Outcomes for executions currently on their first attempt (never retried), broken down by why the rest failed.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-wrap items-baseline gap-3">
              <p className="text-2xl font-bold tracking-tight">
                <CountUp value={breakdown.firstAttemptPassRate} suffix="%" />
              </p>
              <p className="text-sm text-muted-foreground">
                {breakdown.firstAttemptPassed} of {breakdown.firstAttemptTotal} first-attempt execution(s) passed
              </p>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Failure category</TableHead>
                  <TableHead>First attempt</TableHead>
                  <TableHead>After retry</TableHead>
                  <TableHead>Total</TableHead>
                </TableRow>
              </TableHeader>
              <AnimatedTableBody>
                {breakdown.byCategory.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground">
                      No failures recorded yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  breakdown.byCategory.map((row) => (
                    <AnimatedTableRow key={row.category}>
                      <TableCell className="font-medium capitalize">{row.category.replace(/_/g, ' ')}</TableCell>
                      <TableCell>{row.firstAttempt}</TableCell>
                      <TableCell>{row.retried}</TableCell>
                      <TableCell>{row.total}</TableCell>
                    </AnimatedTableRow>
                  ))
                )}
              </AnimatedTableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      {summary ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent executions</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Run</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>When</TableHead>
                </TableRow>
              </TableHeader>
              <AnimatedTableBody>
                {summary.latestExecutions.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground">
                      No executions yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  summary.latestExecutions.map((run) => (
                    <AnimatedTableRow key={run.id}>
                      <TableCell className="font-mono text-xs">{run.id.slice(-8)}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', STATUS_DOT[run.status])} />
                          <Badge variant={STATUS_VARIANT[run.status]}>{run.status}</Badge>
                        </div>
                      </TableCell>
                      <TableCell>{run.durationSeconds.toFixed(1)}s</TableCell>
                      <TableCell className="text-muted-foreground">{new Date(run.createdAt).toLocaleString()}</TableCell>
                    </AnimatedTableRow>
                  ))
                )}
              </AnimatedTableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
