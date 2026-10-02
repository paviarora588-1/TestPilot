'use client';

import { motion } from 'motion/react';
import { Brain, Cpu, FolderTree, Lock, MousePointerClick, Play, Radar, Scan, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

function PanelShell({
  title,
  icon: Icon,
  children,
  className = '',
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      className={`relative flex flex-col overflow-hidden rounded-2xl border border-border bg-card p-5 shadow-sm ${className}`}
    >
      <div className="mb-4 flex items-center gap-2">
        <Icon className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold tracking-wide">{title}</h3>
      </div>
      {children}
    </motion.div>
  );
}

const SCAN_OBJECTS = [
  { name: 'Username Field', type: 'input:text' },
  { name: 'Password Field', type: 'input:password' },
  { name: 'Login Button', type: 'button:submit' },
];

function ScannerPanel() {
  return (
    <PanelShell title="Scanner" icon={Scan}>
      <div className="mb-4 flex items-center justify-center">
        <div className="relative flex h-24 w-24 items-center justify-center">
          <motion.div
            className="absolute inset-0 rounded-full border border-primary/30"
            animate={{ scale: [1, 1.15, 1], opacity: [0.6, 0.2, 0.6] }}
            transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
          />
          <motion.div
            className="absolute inset-3 rounded-full border border-primary/30"
            animate={{ scale: [1, 1.2, 1], opacity: [0.5, 0.15, 0.5] }}
            transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut', delay: 0.3 }}
          />
          <Radar className="h-8 w-8 text-primary" />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        {SCAN_OBJECTS.map((obj) => (
          <div key={obj.name} className="flex items-center justify-between rounded-lg border border-border bg-muted/40 px-2.5 py-1.5">
            <span className="text-xs font-medium">{obj.name}</span>
            <span className="rounded-full bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] text-primary">{obj.type}</span>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[11px] text-muted-foreground">AI Scanner is detecting UI elements…</p>
    </PanelShell>
  );
}

const BUILDER_STEPS = [
  { icon: '1', label: 'Open URL', detail: 'Navigate to login page' },
  { icon: '2', label: 'Enter Username', detail: 'Enter value in field' },
  { icon: '3', label: 'Enter Password', detail: 'Enter value in field' },
  { icon: '4', label: 'Click Login', detail: 'Click on button' },
  { icon: '5', label: 'Verify Dashboard', detail: "Verify user is on Dashboard" },
];

function AutomationBuilderPanel() {
  return (
    <PanelShell title="Automation Builder" icon={MousePointerClick}>
      <div className="flex flex-col gap-2">
        {BUILDER_STEPS.map((step, i) => (
          <div key={step.label} className="relative flex items-center gap-2.5">
            {i < BUILDER_STEPS.length - 1 ? (
              <span className="absolute left-[11px] top-6 h-3 w-px bg-gradient-to-b from-primary/40 to-transparent" />
            ) : null}
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[10px] font-semibold text-primary ring-1 ring-primary/30">
              {step.icon}
            </span>
            <div className="min-w-0 flex-1 rounded-lg border border-border bg-muted/40 px-2.5 py-1.5">
              <p className="truncate text-xs font-medium">{step.label}</p>
              <p className="truncate text-[10px] text-muted-foreground">{step.detail}</p>
            </div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[11px] text-muted-foreground">Drag, drop, automate.</p>
    </PanelShell>
  );
}

function LocalAiPanel() {
  return (
    <PanelShell title="Local AI Core" icon={Brain}>
      <div className="mb-4 flex items-center justify-center gap-4">
        <motion.div
          className="relative flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-primary/30 to-primary/5 ring-1 ring-primary/40"
          animate={{ boxShadow: ['0 0 0px 0px var(--primary)', '0 0 24px 4px color-mix(in oklch, var(--primary) 35%, transparent)', '0 0 0px 0px var(--primary)'] }}
          transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
        >
          <Cpu className="h-7 w-7 text-primary" />
        </motion.div>
        <div className="flex flex-col items-center gap-1 rounded-lg border border-border bg-muted/40 px-3 py-2">
          <ShieldCheck className="h-4 w-4 text-emerald-400" />
          <span className="text-[10px] font-medium">100% Private</span>
        </div>
      </div>
      <div className="flex flex-col gap-1.5 text-[11px] text-muted-foreground">
        {['Understanding UI content…', 'Generating locators…', 'Creating test steps…'].map((line) => (
          <div key={line} className="flex items-center gap-1.5">
            <Lock className="h-3 w-3 text-primary/60" />
            {line}
          </div>
        ))}
      </div>
      <p className="mt-3 text-[11px] font-medium text-foreground">Your data stays on your machine.</p>
    </PanelShell>
  );
}

const KPIS = [
  { label: 'Test Cases', value: '1,248' },
  { label: 'Automation Coverage', value: '78%' },
  { label: 'Passed', value: '932', color: 'text-emerald-400' },
  { label: 'Failed', value: '216', color: 'text-rose-400' },
];

function DashboardPanel() {
  return (
    <PanelShell title="Dashboard Preview" icon={Play}>
      <div className="grid grid-cols-2 gap-2">
        {KPIS.map((kpi) => (
          <div key={kpi.label} className="rounded-lg border border-border bg-muted/40 px-2.5 py-2">
            <p className="text-[10px] text-muted-foreground">{kpi.label}</p>
            <p className={`text-base font-semibold ${kpi.color ?? ''}`}>{kpi.value}</p>
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-end gap-1 rounded-lg border border-border bg-muted/40 p-2.5">
        {[40, 65, 50, 80, 60, 90, 72].map((h, i) => (
          <div key={i} className="flex-1 rounded-sm bg-gradient-to-t from-primary/70 to-primary/20" style={{ height: `${h * 0.4}px` }} />
        ))}
      </div>
      <p className="mt-3 text-[11px] text-muted-foreground">92% object health · 3 flaky tests flagged this week.</p>
    </PanelShell>
  );
}

const OBJECT_TREE = [
  {
    screen: 'Login Page',
    objects: [
      { name: 'Username Field', locator: '[name="username"]', type: 'input:text' },
      { name: 'Password Field', locator: '[name="password"]', type: 'input:password' },
      { name: 'Login Button', locator: 'button[type="submit"]', type: 'button:submit' },
    ],
  },
];

function ObjectLibraryPanel() {
  return (
    <PanelShell title="Object Library" icon={FolderTree} className="lg:col-span-2">
      <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
        <span className="rounded-md bg-muted px-2 py-1 font-medium text-foreground">RP</span>
        <span>›</span>
        <span>{OBJECT_TREE[0].screen}</span>
        <Badge variant="outline" className="ml-auto">{OBJECT_TREE[0].objects.length} objects</Badge>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {OBJECT_TREE[0].objects.map((obj) => (
          <div key={obj.name} className="rounded-lg border border-border bg-muted/40 p-2.5">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium">{obj.name}</p>
              <span className="rounded bg-primary/10 px-1 py-0.5 font-mono text-[9px] text-primary">{obj.type}</span>
            </div>
            <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">{obj.locator}</p>
            <div className="mt-1.5 flex gap-1">
              <Badge variant="outline" className="text-[9px]">XPath</Badge>
              <Badge variant="outline" className="text-[9px]">CSS</Badge>
              <Badge className="text-[9px]">Recommended</Badge>
            </div>
          </div>
        ))}
      </div>
    </PanelShell>
  );
}

export function PreviewPanels() {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <ObjectLibraryPanel />
        <ScannerPanel />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <AutomationBuilderPanel />
        <LocalAiPanel />
        <DashboardPanel />
      </div>
    </div>
  );
}
