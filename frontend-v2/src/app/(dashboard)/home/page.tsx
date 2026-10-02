'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { ArrowRight, FileCode2, Library, PlayCircle, ScanSearch } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { CountUp } from '@/components/motion/count-up';
import { PipelineStrip } from '@/components/marketing/pipeline-strip';
import { NAV_ITEMS } from '@/lib/nav-config';
import { listAutomationFlows, listTestCases } from '@/lib/api';
import { useApplicationContext } from '@/lib/application-context';
import { useAuth } from '@/lib/auth-context';

const EASE = [0.16, 1, 0.3, 1] as const;

const AVATAR_WORKFLOW = [
  { icon: ScanSearch, label: 'Scan' },
  { icon: Library, label: 'Detect' },
  { icon: FileCode2, label: 'Generate' },
  { icon: PlayCircle, label: 'Execute' },
];

const STAGE_DESCRIPTIONS: Record<string, string> = {
  '/dashboard': 'Live automation coverage, execution trends, and stats.',
  '/applications': 'Register the app under test and its automation defaults.',
  '/knowledge-base': 'Ground AI features in your product docs and requirements.',
  '/scanner': 'Scan a live web app or SAP GUI session to discover its objects.',
  '/object-library': 'Review and curate the objects the scanner found.',
  '/test-cases': 'Import, author, or let AI draft test cases.',
  '/test-data': 'Reusable, environment-scoped data sets for your flows.',
  '/automation-builder': 'AI drafts a flow from a test case — review or fine-tune it.',
  '/script-generator': 'Compile a flow into real, runnable Playwright or Selenium code.',
  '/executions': 'Run scripts and suites, with live per-step results.',
  '/reports': 'Coverage, failure trends, and object health in one place.',
  '/integrations': 'Sync test cases and push real bug reports to Jira/Zephyr.',
  '/settings': 'Roles, automation policy thresholds, and AI provider setup.',
};

// A handful of the most-used stages get a bigger tile in the bento grid —
// not every module is equally important day-to-day.
const FEATURED_HREFS = new Set(['/test-cases', '/automation-builder', '/executions']);

export default function HomePage() {
  const { user } = useAuth();
  const { selectedApplication } = useApplicationContext();
  const appId = selectedApplication?.id;
  const stages = NAV_ITEMS.filter((item) => item.href !== '/home' && item.href !== '/dashboard');
  const firstName = user?.name?.split(' ')[0] ?? 'there';

  const { data: testCases = [] } = useQuery({
    queryKey: ['test-cases', appId],
    queryFn: () => listTestCases(appId!),
    enabled: !!appId,
  });
  const { data: flows = [] } = useQuery({
    queryKey: ['automation-flows', appId],
    queryFn: () => listAutomationFlows(appId!),
    enabled: !!appId,
  });
  const automated = testCases.filter((tc) => tc.automationStatus !== 'NOT_STARTED').length;
  const coveragePct = testCases.length > 0 ? Math.round((automated / testCases.length) * 100) : 0;

  return (
    <div className="-m-6 min-h-[calc(100vh-3.5rem)] bg-muted/30">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-10 sm:px-10">
        <motion.h1
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: EASE }}
          className="text-3xl sm:text-4xl"
        >
          Welcome back, {firstName}
        </motion.h1>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.05, ease: EASE }}
        >
          <PipelineStrip appName={selectedApplication?.name ?? 'No application selected'} />
        </motion.div>

        {/* Bento grid — real data and real shortcuts, not decoration */}
        <div className="grid auto-rows-[minmax(110px,auto)] grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {/* Continue with {app} — big tile, real stats */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1, ease: EASE }}
            className="row-span-2 sm:col-span-2"
          >
            <Card className="flex h-full flex-col justify-between bg-accent/40 p-5">
              <div>
                <p className="text-xs font-medium text-muted-foreground">Current application</p>
                <p className="mt-1 text-2xl font-bold">{selectedApplication?.name ?? 'None selected'}</p>
              </div>
              {selectedApplication ? (
                <div className="mt-4 grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-3xl font-bold text-primary">
                      <CountUp value={testCases.length} />
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">Test cases</p>
                  </div>
                  <div>
                    <p className="text-3xl font-bold text-primary">
                      <CountUp value={coveragePct} suffix="%" />
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">Automated ({flows.length} flows)</p>
                  </div>
                </div>
              ) : (
                <p className="mt-4 text-sm text-muted-foreground">Select or create an application from the switcher above.</p>
              )}
              <Link href="/dashboard" className="mt-4 inline-flex w-fit items-center gap-1.5 text-sm font-medium text-primary hover:underline">
                Open Dashboard <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Card>
          </motion.div>

          {/* AI status */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.16, ease: EASE }}
            className="sm:col-span-2"
          >
            <Card className="h-full p-5">
              <p className="text-xs font-medium text-muted-foreground">AI briefing</p>
              <p className="mt-2 text-sm leading-relaxed text-foreground/80">
                I&apos;m the AI behind TestPilot. Point me at an application and I&apos;ll scan it, learn its objects,
                draft test cases and flows, generate real Playwright/Selenium code, run it, and explain failures.
              </p>
            </Card>
          </motion.div>

          {/* Workflow strip */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.22, ease: EASE }}
            className="sm:col-span-2"
          >
            <Card className="flex h-full items-center justify-around p-5">
              {AVATAR_WORKFLOW.map((step) => (
                <div key={step.label} className="flex flex-col items-center gap-1.5">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-accent-foreground">
                    <step.icon className="h-4 w-4" />
                  </span>
                  <span className="text-xs font-medium text-muted-foreground">{step.label}</span>
                </div>
              ))}
            </Card>
          </motion.div>
        </div>

        {/* Modules */}
        <div>
          <p className="mb-4 text-sm font-semibold text-muted-foreground">Modules</p>
          <div className="grid auto-rows-[128px] grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {stages.map((stage, i) => {
              const featured = FEATURED_HREFS.has(stage.href);
              return (
                <motion.div
                  key={stage.href}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, delay: 0.3 + i * 0.03, ease: EASE }}
                  className={featured ? 'sm:col-span-2' : ''}
                >
                  <Link href={stage.href} className="block h-full">
                    <Card className="flex h-full flex-col justify-between p-5 transition-colors hover:border-primary/40">
                      <div className="flex items-start gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                          <stage.icon className="h-5 w-5" />
                        </div>
                        <div>
                          <p className="font-semibold">{stage.label}</p>
                          <p className="mt-1 text-sm text-muted-foreground">{STAGE_DESCRIPTIONS[stage.href] ?? ''}</p>
                        </div>
                      </div>
                    </Card>
                  </Link>
                </motion.div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
