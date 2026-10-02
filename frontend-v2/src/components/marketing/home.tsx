'use client';

import Link from 'next/link';
import { motion } from 'motion/react';
import {
  ArrowRight,
  AppWindow,
  BarChart3,
  BookOpen,
  ChevronDown,
  Database,
  FileCode2,
  Gauge,
  Library,
  ListChecks,
  PlayCircle,
  Plug,
  Rocket,
  ScanSearch,
  Settings,
  ShieldCheck,
  Sparkles,
  Workflow,
} from 'lucide-react';
import { Sparkles as LogoSpark } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { FadeIn } from '@/components/motion/fade-in';
import { StaggerContainer, StaggerItem } from '@/components/motion/stagger';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { PipelineStrip } from './pipeline-strip';
import { ScanIllustration, FlowIllustration, ReviewIllustration } from './ai-illustrations';
import { PreviewPanels } from './preview-panels';

const NAV_ITEMS = ['Product', 'Solutions', 'Resources', 'Pricing', 'Company'];

const WORKFLOW = [
  { icon: ScanSearch, label: 'Scan', description: 'AI scans your application' },
  { icon: Library, label: 'Detect', description: 'AI detects UI objects' },
  { icon: FileCode2, label: 'Generate', description: 'AI generates automation' },
  { icon: PlayCircle, label: 'Execute', description: 'AI executes tests' },
];

const FEATURES = [
  { icon: AppWindow, label: 'Applications', description: 'Register applications under test and their automation defaults — framework, environment, ownership.' },
  { icon: ScanSearch, label: 'Application Scanner', description: 'Real headless-browser scans that discover every object on a page, including SPA tabs sharing one URL.' },
  { icon: Library, label: 'Object Library', description: 'A curated, page-wise object repository with confidence scoring and manual verification.' },
  { icon: ListChecks, label: 'Test Cases', description: 'Import from CSV/Excel or author manually, with AI-assisted object-mapping analysis.' },
  { icon: Database, label: 'Test Data', description: 'Reusable, environment-scoped data sets with dynamic placeholders like {{timestamp}}.' },
  { icon: Workflow, label: 'Automation Builder', description: 'AI drafts the flow from a test case — drag-and-drop canvas stays there to review or fine-tune.' },
  { icon: FileCode2, label: 'Script Generator', description: 'Deterministic Playwright or Selenium code — reviewed by AI, never AI-authored.' },
  { icon: PlayCircle, label: 'Executions', description: 'Run suites with live status, per-step screenshots, and continue-on-failure semantics.' },
  { icon: BarChart3, label: 'Reports', description: 'Coverage, failure trends, and object health in one exportable dashboard.' },
  { icon: BookOpen, label: 'Knowledge Base', description: 'Ground AI features in your own product documentation via local RAG.' },
  { icon: Plug, label: 'Zephyr / Jira', description: 'Two-way sync with the test management tools your team already uses.' },
  { icon: Settings, label: 'Settings', description: 'Role-based access, automation policy thresholds, and provider configuration.' },
];

const FEATURE_STRIP = [
  { icon: ShieldCheck, label: '100% Local AI', description: 'Your data never leaves your environment.' },
  { icon: Gauge, label: 'Enterprise Ready', description: 'Secure, scalable, reliable.' },
  { icon: Sparkles, label: 'Smart Automation', description: 'AI that understands your application.' },
  { icon: Rocket, label: 'Faster Releases', description: 'Ship high quality software with confidence.' },
];

export function HomePage() {
  return (
    <div className="relative flex min-h-screen flex-col overflow-x-hidden bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-border bg-card">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-8">
            <span className="flex items-center gap-2 text-lg font-bold tracking-wide">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <LogoSpark className="h-4 w-4" />
              </span>
              TestPilot
            </span>
            <nav className="hidden items-center gap-6 lg:flex">
              {NAV_ITEMS.map((item) => (
                <span
                  key={item}
                  className="flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  {item}
                  {item !== 'Pricing' ? <ChevronDown className="h-3 w-3" /> : null}
                </span>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant="outline" className="hidden gap-1.5 sm:inline-flex">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Local AI
            </Badge>
            <ThemeToggle />
            <Button variant="outline" nativeButton={false} render={<Link href="/login" />}>
              Sign in
            </Button>
            <Button nativeButton={false} render={<Link href="/login" />}>
              Get Started
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <section className="relative px-6 pb-24 pt-20 sm:pt-28">
          <div className="relative mx-auto max-w-4xl flex flex-col items-center text-center">
            <FadeIn>
              <span className="mb-6 inline-flex items-center gap-1.5 rounded-full bg-accent px-3 py-1 text-xs font-semibold uppercase tracking-wide text-accent-foreground">
                <Sparkles className="h-3.5 w-3.5" />
                Next-Gen Test Automation Platform
              </span>
            </FadeIn>
            <FadeIn delay={0.08}>
              <h1 className="text-4xl tracking-tight sm:text-6xl">
                Learn the product. Build the library.{' '}
                <span className="text-primary">Automate anything.</span>
              </h1>
            </FadeIn>
            <FadeIn delay={0.16}>
              <p className="mt-6 max-w-xl text-balance text-muted-foreground sm:text-lg">
                TestPilot scans real applications, builds a living object repository, and lets Local AI generate
                reviewed, runnable Playwright or Selenium scripts — with company data staying on your own
                infrastructure.
              </p>
            </FadeIn>
            <FadeIn delay={0.24}>
              <div className="mt-8 flex gap-3">
                <Button size="lg" nativeButton={false} render={<Link href="/login" />}>
                  Sign in
                  <ArrowRight className="ml-1 h-4 w-4" />
                </Button>
                <Button size="lg" variant="outline" nativeButton={false} render={<a href="#features" />}>
                  See what&apos;s inside
                </Button>
              </div>
            </FadeIn>
            <FadeIn delay={0.32}>
              <div className="mt-10 grid w-full max-w-md grid-cols-4 gap-2 sm:gap-3">
                {WORKFLOW.map((step, i) => (
                  <div key={step.label} className="relative flex flex-col items-center gap-1.5 text-center">
                    {i < WORKFLOW.length - 1 ? (
                      <span className="absolute left-[calc(50%+18px)] top-4 hidden h-px w-[calc(100%-36px)] bg-border sm:block" />
                    ) : null}
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent">
                      <step.icon className="h-4 w-4 text-accent-foreground" />
                    </span>
                    <span className="text-[11px] font-medium">{step.label}</span>
                  </div>
                ))}
              </div>
            </FadeIn>
          </div>

          <FadeIn delay={0.4}>
            <div className="mx-auto mt-14 max-w-3xl">
              <PipelineStrip />
            </div>
          </FadeIn>

          {/* Real product panels, not a decorative animation — this is what
              the app's Scanner/Automation Builder/Dashboard/Object Library
              actually produce, laid out as an asymmetric bento grid. */}
          <div className="relative mx-auto mt-8 max-w-6xl">
            <PreviewPanels />
          </div>
        </section>

        <section className="relative border-t border-border px-6 py-10">
          <div className="mx-auto grid max-w-6xl grid-cols-2 gap-4 lg:grid-cols-4">
            {FEATURE_STRIP.map((item) => (
              <motion.div
                key={item.label}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-40px' }}
                transition={{ duration: 0.4 }}
                className="flex items-start gap-3 rounded-xl border border-border bg-card p-4"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                  <item.icon className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-sm font-semibold">{item.label}</p>
                  <p className="text-xs text-muted-foreground">{item.description}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </section>

        <section id="features" className="relative border-t border-border px-6 py-24">
          <div className="mx-auto max-w-6xl">
            <FadeIn>
              <h2 className="text-center text-2xl tracking-tight sm:text-3xl">
                One platform, the whole automation lifecycle
              </h2>
            </FadeIn>
            <StaggerContainer className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((feature) => (
                <StaggerItem key={feature.label}>
                  <motion.div
                    whileHover={{ y: -4 }}
                    transition={{ duration: 0.2 }}
                    className="group relative h-full rounded-xl border border-border bg-card p-5 shadow-sm transition-colors hover:border-primary/40"
                  >
                    <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                      <feature.icon className="h-5 w-5" />
                    </div>
                    <h3 className="text-base font-semibold">{feature.label}</h3>
                    <p className="mt-1.5 text-sm text-muted-foreground">{feature.description}</p>
                  </motion.div>
                </StaggerItem>
              ))}
            </StaggerContainer>
          </div>
        </section>

        <section className="relative border-t border-border bg-muted/30 px-6 py-24">
          <div className="mx-auto max-w-5xl">
            <FadeIn>
              <p className="text-center font-mono text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                How it works
              </p>
              <h2 className="mt-2 text-center text-2xl tracking-tight sm:text-3xl">
                Three things AI does, in order, on every run.
              </h2>
              <p className="mx-auto mt-3 max-w-md text-center text-sm text-muted-foreground">
                Not a chatbot bolted onto a test runner — a pipeline that hands each step real, verified data.
              </p>
            </FadeIn>

            <div className="mt-16 grid grid-cols-1 items-center gap-10 lg:grid-cols-2">
              <FadeIn><ScanIllustration /></FadeIn>
              <FadeIn delay={0.08}>
                <div>
                  <p className="font-mono text-xs text-muted-foreground">01 · COMPUTER VISION</p>
                  <h3 className="mt-2 text-xl font-semibold">It sees the page the way a QA engineer does.</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    Every field, button, and label gets a bounding box and a confidence score in real time — no
                    brittle XPath guessing.
                  </p>
                </div>
              </FadeIn>
            </div>

            <div className="mt-16 grid grid-cols-1 items-center gap-10 lg:grid-cols-2">
              <FadeIn className="lg:order-2"><FlowIllustration /></FadeIn>
              <FadeIn delay={0.08} className="lg:order-1">
                <div>
                  <p className="font-mono text-xs text-muted-foreground">02 · FLOW SYNTHESIS</p>
                  <h3 className="mt-2 text-xl font-semibold">It drafts the automation, not just the assertions.</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    It reads the Object Library and Test Data already on file and composes a real flow, ready to
                    review — watch it build.
                  </p>
                </div>
              </FadeIn>
            </div>

            <div className="mt-16 grid grid-cols-1 items-center gap-10 lg:grid-cols-2">
              <FadeIn><ReviewIllustration /></FadeIn>
              <FadeIn delay={0.08}>
                <div>
                  <p className="font-mono text-xs text-muted-foreground">03 · RISK REVIEW</p>
                  <h3 className="mt-2 text-xl font-semibold">Nothing runs until AI signs off on it.</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    Every generated script is checked against a real rubric before it ever touches your environment —
                    deterministic code, AI-reviewed, never AI-authored.
                  </p>
                </div>
              </FadeIn>
            </div>
          </div>
        </section>

        <section className="relative border-t border-border px-6 py-24 text-center">
          <FadeIn>
            <h2 className="text-2xl tracking-tight sm:text-3xl">Automation your team can actually trust.</h2>
            <p className="mx-auto mt-3 max-w-lg text-muted-foreground">
              Enterprise-grade, private by default, and built for the way QA teams actually work.
            </p>
            <Button size="lg" nativeButton={false} render={<Link href="/login" />} className="mt-8">
              Sign in
              <ArrowRight className="ml-1 h-4 w-4" />
            </Button>
          </FadeIn>
        </section>
      </main>

      <footer className="border-t border-border px-6 py-8 text-center text-xs text-muted-foreground">
        TestPilot — private, in-house QA automation.
      </footer>
    </div>
  );
}
