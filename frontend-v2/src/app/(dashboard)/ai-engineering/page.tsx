'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import {
  Bot,
  Bug,
  CheckCircle2,
  Clock,
  FileCode2,
  ListChecks,
  MessageCircle,
  PlayCircle,
  TrendingUp,
  UserCheck,
  Wrench,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { PageHeader } from '@/components/layout/page-header';
import { AnimatedTableBody, AnimatedTableRow } from '@/components/motion/animated-table';
import { CountUp } from '@/components/motion/count-up';
import { StaggerContainer, StaggerItem } from '@/components/motion/stagger';
import { cn } from '@/lib/utils';
import {
  approveAiTask,
  createAiTask,
  getAiTask,
  getBackendTestSuite,
  getE2ETestSuite,
  getFrontendTestSuite,
  listAiTasks,
  listChatMessages,
  rejectAiTask,
  retryAiTask,
  sendChatMessage,
} from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { isAdmin } from '@/lib/roles';
import { computeAiEngineeringStats, extractTestSummary, formatDurationMs } from '@/lib/ai-engineering-stats';
import { AI_PERSONAS, displayTitle, getPersonaWork } from '@/lib/ai-org-chart';
import type {
  AiChatMessage,
  AiEngineeringTask,
  AiTaskFileDiff,
  AiTaskStatus,
  AiTaskVerification,
  BugSeverity,
  TestSuiteFileResult,
  TestSuiteResult,
} from '@/lib/types';

const STATUS_VARIANT: Record<AiTaskStatus, 'success' | 'secondary' | 'destructive' | 'outline' | 'info' | 'warning'> = {
  PENDING: 'outline',
  PLANNING: 'info',
  IN_PROGRESS: 'info',
  WAITING_REVIEW: 'warning',
  APPROVED: 'success',
  REJECTED: 'destructive',
  COMPLETED: 'success',
  FAILED: 'destructive',
};

const ACTIVE_STATUSES: AiTaskStatus[] = ['PENDING', 'PLANNING', 'IN_PROGRESS'];

function errorMessage(err: unknown, fallback: string) {
  if (isAxiosError(err) && typeof err.response?.data?.message === 'string') {
    return err.response.data.message as string;
  }
  return fallback;
}

function blockerMessage(err: unknown, fallback: string) {
  if (isAxiosError(err) && err.response?.data?.reasons?.length) {
    return (err.response.data.reasons as string[]).join(' ');
  }
  return fallback;
}

function StatIconBadge({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent text-accent-foreground">
      <Icon className="h-3.5 w-3.5" />
    </span>
  );
}

function StatTile({
  label,
  value,
  suffix = '',
  icon,
}: {
  label: string;
  value: number;
  suffix?: string;
  icon?: LucideIcon;
}) {
  return (
    <Card className="flex h-full flex-col justify-between p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        {icon ? <StatIconBadge icon={icon} /> : null}
      </div>
      <p className="text-2xl font-bold tracking-tight">
        <CountUp value={value} suffix={suffix} />
      </p>
    </Card>
  );
}

function PipelineStatsRow({ tasks }: { tasks: AiEngineeringTask[] }) {
  const stats = computeAiEngineeringStats(tasks);
  return (
    <StaggerContainer className="grid grid-cols-2 gap-4 lg:grid-cols-3">
      <StaggerItem>
        <StatTile label="Reports filed" value={stats.total} icon={Bug} />
      </StaggerItem>
      <StaggerItem>
        <StatTile label="Completed" value={stats.completed} icon={CheckCircle2} />
      </StaggerItem>
      <StaggerItem>
        <StatTile
          label="Success rate"
          value={stats.successRatePct !== null ? Math.round(stats.successRatePct) : 0}
          suffix="%"
          icon={TrendingUp}
        />
      </StaggerItem>
      <StaggerItem>
        <StatTile label="Needs a human" value={stats.needsHuman} icon={UserCheck} />
      </StaggerItem>
      <StaggerItem>
        <StatTile
          label="Needed auto-repair"
          value={stats.pctNeedingRepair !== null ? Math.round(stats.pctNeedingRepair) : 0}
          suffix="%"
          icon={Wrench}
        />
      </StaggerItem>
      <StaggerItem>
        <Card className="flex h-full flex-col justify-between p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-muted-foreground">Avg. time to fix</p>
            <StatIconBadge icon={Clock} />
          </div>
          <p className="text-2xl font-bold tracking-tight">
            {stats.avgTimeToFixMs !== null ? formatDurationMs(stats.avgTimeToFixMs) : '—'}
          </p>
        </Card>
      </StaggerItem>
    </StaggerContainer>
  );
}

// The single most actionable thing on this page: a human needs to look at
// this now, not just track it in a stats tile. Only renders when there's
// actually something waiting, and jumps straight to the same detail card
// (with its existing Approve/Reject/diff/verification actions) rather than
// duplicating that logic here.
function NeedsReviewBanner({
  tasks,
  onSelect,
}: {
  tasks: AiEngineeringTask[];
  onSelect: (id: string) => void;
}) {
  const waiting = tasks.filter((t) => t.status === 'WAITING_REVIEW');
  if (waiting.length === 0) return null;

  return (
    <Card className="border-amber-500/40 bg-amber-500/10">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {waiting.length} task{waiting.length === 1 ? '' : 's'} waiting on your review
        </CardTitle>
        <CardDescription>Nothing reaches real source until you approve it.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {waiting.map((task) => (
          <div
            key={task.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-background p-3"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{displayTitle(task)}</p>
              <p className="text-xs text-muted-foreground">
                {task.area ?? 'NEEDS_HUMAN'} · {task.severity}
                {task.aiReviewPassed === false ? ' · AI review flagged a concern' : ''}
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={() => onSelect(task.id)}>
              Review
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

const RESULT_VARIANT: Record<'PASS' | 'FAIL' | 'PENDING', 'success' | 'destructive' | 'outline'> = {
  PASS: 'success',
  FAIL: 'destructive',
  PENDING: 'outline',
};

function ChatMessageBubble({ message, personaName }: { message: AiChatMessage; personaName: string }) {
  const isUser = message.role === 'USER';
  return (
    <div className={cn('flex flex-col gap-1', isUser ? 'items-end' : 'items-start')}>
      <span className="text-xs font-medium text-muted-foreground">{isUser ? 'You' : personaName}</span>
      <div
        className={cn(
          'max-w-[80%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap',
          isUser ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground',
        )}
      >
        {message.content}
      </div>
    </div>
  );
}

// A lightweight Q&A channel with one persona at a time — separate from the
// task pipeline above. Answers come from AiProvider.generateText (a real,
// fast local call), grounded in that persona's recent real task data
// server-side; it never authors code or changes task state, so there's
// nothing here for a human to approve.
function TeamChatDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [personaId, setPersonaId] = useState<string>(AI_PERSONAS[0].id);
  const [draft, setDraft] = useState('');
  const persona = AI_PERSONAS.find((p) => p.id === personaId) ?? AI_PERSONAS[0];
  const Icon = persona.icon;
  const queryClient = useQueryClient();
  const scrollRef = useRef<HTMLDivElement>(null);

  const { data: messages = [], isLoading } = useQuery({
    queryKey: ['ai-chat', personaId],
    queryFn: () => listChatMessages(personaId),
    enabled: open,
  });

  const sendMutation = useMutation({
    mutationFn: (content: string) => sendChatMessage(personaId, content),
    // Without this, the user's own message doesn't appear until the whole
    // round trip (persist + real AI reply) resolves — confirmed live: the
    // thread just sat on "No messages yet" under the typing indicator for
    // the entire wait. Inserting it into the cache immediately means it
    // shows up the instant you hit Send, same as any real chat app.
    onMutate: async (content: string) => {
      await queryClient.cancelQueries({ queryKey: ['ai-chat', personaId] });
      const previous = queryClient.getQueryData<AiChatMessage[]>(['ai-chat', personaId]) ?? [];
      const optimisticMessage: AiChatMessage = {
        id: `optimistic-${Date.now()}`,
        personaId,
        role: 'USER',
        content,
        askedById: null,
        createdAt: new Date().toISOString(),
      };
      queryClient.setQueryData(['ai-chat', personaId], [...previous, optimisticMessage]);
      return { previous };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-chat', personaId] });
    },
    onError: (err, _content, context) => {
      if (context?.previous) queryClient.setQueryData(['ai-chat', personaId], context.previous);
      toast.error(errorMessage(err, 'Failed to send message'));
    },
  });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length, sendMutation.isPending]);

  function handleSend(event: FormEvent) {
    event.preventDefault();
    const content = draft.trim();
    if (!content) return;
    setDraft('');
    sendMutation.mutate(content);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[80vh] max-h-[720px] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Chat with the team</DialogTitle>
        </DialogHeader>
        <div className="flex flex-wrap gap-1.5 border-b pb-3">
          {AI_PERSONAS.map((p) => {
            const PersonaIcon = p.icon;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setPersonaId(p.id)}
                className={cn(
                  'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                  p.id === personaId ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted',
                )}
              >
                <PersonaIcon className="h-3 w-3" />
                {p.name}
              </button>
            );
          })}
        </div>
        <div ref={scrollRef} className="flex flex-1 flex-col gap-3 overflow-y-auto py-2">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : messages.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No messages yet — ask {persona.name} something about their work.
            </p>
          ) : (
            messages.map((m) => <ChatMessageBubble key={m.id} message={m} personaName={persona.name} />)
          )}
          {sendMutation.isPending ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Icon className="h-3.5 w-3.5" /> {persona.name} is typing…
            </div>
          ) : null}
        </div>
        <form onSubmit={handleSend} className="flex items-center gap-2 border-t pt-3">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={`Ask ${persona.name} something…`}
            disabled={sendMutation.isPending}
          />
          <Button type="submit" disabled={sendMutation.isPending || !draft.trim()}>
            Send
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TeamCard({ tasks }: { tasks: AiEngineeringTask[] }) {
  const [detailTarget, setDetailTarget] = useState<{ taskId: string; personaId: string } | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const detailTask = detailTarget ? tasks.find((t) => t.id === detailTarget.taskId) : null;
  // Robo is QA — their popup is about test results, not the code itself.
  const hideCode = detailTarget?.personaId === 'qa';

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <div>
          <CardTitle>Team</CardTitle>
          <CardDescription>
            Every persona routes through the same triage + specialist pipeline underneath — click one to see their
            work, then click a task for the full result.
          </CardDescription>
        </div>
        <Button size="sm" variant="outline" onClick={() => setChatOpen(true)}>
          <MessageCircle className="mr-2 h-4 w-4" />
          Chat with team
        </Button>
      </CardHeader>
      <TeamChatDialog open={chatOpen} onOpenChange={setChatOpen} />
      <CardContent>
        <Dialog open={!!detailTarget} onOpenChange={(open) => !open && setDetailTarget(null)}>
          <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-4xl">
            <DialogHeader>
              <DialogTitle>{detailTask ? displayTitle(detailTask) : ''}</DialogTitle>
            </DialogHeader>
            {detailTask ? <TaskFullDetail task={detailTask} hideCode={hideCode} /> : null}
          </DialogContent>
        </Dialog>
        <StaggerContainer className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {AI_PERSONAS.map((persona) => {
          const active = persona.isActive(tasks);
          const work = getPersonaWork(persona.id, tasks);
          const Icon = persona.icon;
          return (
            <StaggerItem key={persona.id}>
            <Dialog>
              <DialogTrigger
                render={
                  <button
                    type="button"
                    className="flex h-full w-full flex-col items-center gap-2 rounded-xl border bg-card p-4 text-center transition-all hover:-translate-y-0.5 hover:shadow-md"
                  />
                }
              >
                <span className="relative">
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent text-accent-foreground">
                    <Icon className="h-5 w-5" />
                  </span>
                  <span
                    className={cn(
                      'absolute -top-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card',
                      active ? 'bg-emerald-500' : 'bg-muted-foreground/30',
                    )}
                  />
                </span>
                <span className="min-w-0">
                  <p className="text-sm font-semibold">{persona.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{persona.role}</p>
                </span>
                {active ? <Badge variant="info">working</Badge> : null}
              </DialogTrigger>
              <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-4xl">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <Icon className="h-4 w-4" />
                    {persona.name} — {persona.role}
                  </DialogTitle>
                </DialogHeader>
                {(persona.id === 'qa' || persona.id === 'reviewer') && work.length > 0 ? (
                  <div className="grid grid-cols-2 gap-3 rounded-lg border bg-muted/30 p-4 sm:grid-cols-4">
                    <div>
                      <p className="text-xs font-medium text-muted-foreground">
                        {persona.id === 'qa' ? 'Test cycle' : 'Reviewed'}
                      </p>
                      <p className="text-lg font-bold">
                        {work.length} {persona.id === 'qa' ? (work.length === 1 ? 'run' : 'runs') : (work.length === 1 ? 'task' : 'tasks')}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-muted-foreground">
                        {persona.id === 'qa' ? 'Bugs found' : 'Flagged'}
                      </p>
                      <p className="text-lg font-bold">
                        {persona.id === 'qa'
                          ? work.reduce((sum, w) => sum + w.bugsFound, 0)
                          : work.filter((w) => w.result === 'FAIL').length}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-muted-foreground">
                        {persona.id === 'qa' ? 'Passed' : 'Clean'}
                      </p>
                      <p className="text-lg font-bold text-emerald-600">{work.filter((w) => w.result === 'PASS').length}</p>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-muted-foreground">
                        {persona.id === 'qa' ? 'Failed' : 'Pending'}
                      </p>
                      <p className={cn('text-lg font-bold', persona.id === 'qa' ? 'text-destructive' : 'text-muted-foreground')}>
                        {persona.id === 'qa'
                          ? work.filter((w) => w.result === 'FAIL').length
                          : work.filter((w) => w.result === 'PENDING').length}
                      </p>
                    </div>
                  </div>
                ) : null}
                {work.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No work for this persona yet.</p>
                ) : (
                  <div className="overflow-x-auto">
                  {persona.id === 'qa' ? (
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Test cycle detail — one row per run
                    </p>
                  ) : null}
                  {persona.id === 'reviewer' ? (
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Code review detail — advisory only, never blocks approval
                    </p>
                  ) : null}
                  <Table className="min-w-[640px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Task</TableHead>
                        <TableHead>Status</TableHead>
                        {persona.id === 'pm' ? <TableHead>Assigned to</TableHead> : null}
                        {persona.id !== 'pm' ? <TableHead>Tested</TableHead> : null}
                        {persona.id !== 'pm' ? <TableHead>Bugs found</TableHead> : null}
                        {persona.id !== 'pm' ? <TableHead>Result</TableHead> : null}
                      </TableRow>
                    </TableHeader>
                    <AnimatedTableBody>
                      {work.map((item, i) => (
                        <AnimatedTableRow
                          key={`${item.taskId}-${i}`}
                          className="cursor-pointer"
                          onClick={() => setDetailTarget({ taskId: item.taskId, personaId: persona.id })}
                        >
                          <TableCell className="max-w-xs truncate">{item.title}</TableCell>
                          <TableCell>
                            <Badge variant={STATUS_VARIANT[item.status]}>{item.status}</Badge>
                          </TableCell>
                          {persona.id === 'pm' ? <TableCell>{item.assignedTo}</TableCell> : null}
                          {persona.id !== 'pm' ? <TableCell>{item.tested}</TableCell> : null}
                          {persona.id !== 'pm' ? <TableCell>{item.bugsFound}</TableCell> : null}
                          {persona.id !== 'pm' ? (
                            <TableCell>
                              <Badge variant={RESULT_VARIANT[item.result]}>{item.result}</Badge>
                            </TableCell>
                          ) : null}
                        </AnimatedTableRow>
                      ))}
                    </AnimatedTableBody>
                  </Table>
                  </div>
                )}
              </DialogContent>
            </Dialog>
            </StaggerItem>
          );
        })}
        </StaggerContainer>
      </CardContent>
    </Card>
  );
}

// Same aggregate Robo's own popup shows, surfaced directly on the page so it
// doesn't take a click to find — every task with a verification result run
// counts as one test cycle, regardless of which persona's popup you'd find
// the row under.
function TestCycleCard({ tasks }: { tasks: AiEngineeringTask[] }) {
  const work = getPersonaWork('qa', tasks);
  const bugsFound = work.reduce((sum, w) => sum + w.bugsFound, 0);
  const passed = work.filter((w) => w.result === 'PASS').length;
  const failed = work.filter((w) => w.result === 'FAIL').length;
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null);
  const detailTask = detailTaskId ? tasks.find((t) => t.id === detailTaskId) : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Test Cycle</CardTitle>
        <CardDescription>Robo&apos;s verification runs across every task — typecheck, tests, and results.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {work.length === 0 ? (
          <p className="text-sm text-muted-foreground">No test cycles run yet.</p>
        ) : (
          <>
            <StaggerContainer className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <StaggerItem>
                <StatTile label="Runs" value={work.length} icon={PlayCircle} />
              </StaggerItem>
              <StaggerItem>
                <StatTile label="Bugs found" value={bugsFound} icon={Bug} />
              </StaggerItem>
              <StaggerItem>
                <StatTile label="Passed" value={passed} icon={CheckCircle2} />
              </StaggerItem>
              <StaggerItem>
                <StatTile label="Failed" value={failed} icon={XCircle} />
              </StaggerItem>
            </StaggerContainer>
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Test cases in this cycle ({work.length})
              </p>
              <div className="overflow-x-auto">
                <Table className="min-w-[640px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Test case</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Tested</TableHead>
                      <TableHead>Bugs found</TableHead>
                      <TableHead>Result</TableHead>
                    </TableRow>
                  </TableHeader>
                  <AnimatedTableBody>
                    {work.map((item, i) => (
                      <AnimatedTableRow
                        key={`${item.taskId}-${i}`}
                        className="cursor-pointer"
                        onClick={() => setDetailTaskId(item.taskId)}
                      >
                        <TableCell className="max-w-xs truncate">{item.title}</TableCell>
                        <TableCell>
                          <Badge variant={STATUS_VARIANT[item.status]}>{item.status}</Badge>
                        </TableCell>
                        <TableCell>{item.tested}</TableCell>
                        <TableCell>{item.bugsFound}</TableCell>
                        <TableCell>
                          <Badge variant={RESULT_VARIANT[item.result]}>{item.result}</Badge>
                        </TableCell>
                      </AnimatedTableRow>
                    ))}
                  </AnimatedTableBody>
                </Table>
              </div>
            </div>
          </>
        )}
        <Dialog open={!!detailTaskId} onOpenChange={(open) => !open && setDetailTaskId(null)}>
          <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-4xl">
            <DialogHeader>
              <DialogTitle>{detailTask ? displayTitle(detailTask) : ''}</DialogTitle>
            </DialogHeader>
            {detailTask ? <TaskFullDetail task={detailTask} hideCode /> : null}
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

function RegressionSuiteFileRow({ file }: { file: TestSuiteFileResult }) {
  const [expanded, setExpanded] = useState(false);
  const failed = file.tests.filter((t) => t.status === 'failed').length;
  return (
    <div className="rounded-md border">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-muted/50"
      >
        <span className="truncate font-mono text-xs">{file.file}</span>
        <span className="flex shrink-0 items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {file.tests.length} test{file.tests.length === 1 ? '' : 's'}
            {failed > 0 ? `, ${failed} failed` : ''}
          </span>
          <Badge variant={file.status === 'passed' ? 'success' : 'destructive'}>{file.status}</Badge>
        </span>
      </button>
      {expanded ? (
        <div className="border-t px-3 py-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Test case</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Duration</TableHead>
              </TableRow>
            </TableHeader>
            <AnimatedTableBody>
              {file.tests.map((t, i) => (
                <AnimatedTableRow key={i}>
                  <TableCell className="max-w-md truncate text-xs">{t.name}</TableCell>
                  <TableCell>
                    <Badge variant={t.status === 'passed' ? 'success' : t.status === 'failed' ? 'destructive' : 'outline'}>
                      {t.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {t.durationMs != null ? `${t.durationMs}ms` : '—'}
                  </TableCell>
                </AnimatedTableRow>
              ))}
            </AnimatedTableBody>
          </Table>
        </div>
      ) : null}
    </div>
  );
}

function RegressionSuiteCard({
  title,
  description,
  queryFn,
}: {
  title: string;
  description: string;
  queryFn: () => Promise<TestSuiteResult>;
}) {
  const mutation = useMutation({
    mutationFn: queryFn,
    onError: (err) => toast.error(errorMessage(err, 'Failed to run the regression suite')),
  });
  const result = mutation.data;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending ? 'Running…' : result ? 'Run again' : 'Run regression suite'}
          </Button>
          {result ? (
            <span className="text-xs text-muted-foreground">
              Last run {new Date(result.ranAt).toLocaleTimeString()} · took {formatDurationMs(result.durationMs)}
            </span>
          ) : null}
        </div>
        {result ? (
          <>
            <StaggerContainer className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <StaggerItem>
                <StatTile label="Total tests" value={result.numTotalTests} icon={ListChecks} />
              </StaggerItem>
              <StaggerItem>
                <StatTile label="Passed" value={result.numPassedTests} icon={CheckCircle2} />
              </StaggerItem>
              <StaggerItem>
                <StatTile label="Failed" value={result.numFailedTests} icon={XCircle} />
              </StaggerItem>
              <StaggerItem>
                <StatTile label="Files" value={result.files.length} icon={FileCode2} />
              </StaggerItem>
            </StaggerContainer>
            <div className="flex flex-col gap-2">
              {result.files.map((file) => (
                <RegressionSuiteFileRow key={file.file} file={file} />
              ))}
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Not run yet this session — click &quot;Run regression suite&quot; for the current, real pass/fail list.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function VerificationBlock({ label, result }: { label: string; result: { passed: boolean; output: string } }) {
  const [showRaw, setShowRaw] = useState(false);
  const summary = extractTestSummary(result.output);
  return (
    <div className="flex flex-col gap-1.5">
      <Badge variant={result.passed ? 'success' : 'destructive'}>
        {label} {result.passed ? 'passed' : 'failed'}
      </Badge>
      {summary ? <p className="font-mono text-xs whitespace-pre-wrap text-muted-foreground">{summary}</p> : null}
      {result.output ? (
        <>
          <button
            type="button"
            className="w-fit text-xs font-medium text-primary hover:underline"
            onClick={() => setShowRaw((v) => !v)}
          >
            {showRaw ? 'Hide raw output' : 'Show raw output'}
          </button>
          {showRaw ? (
            <pre className="max-h-64 overflow-auto rounded-md border bg-muted p-3 font-mono text-xs whitespace-pre-wrap">
              {result.output}
            </pre>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function CodeDiffSection({ label, diffs }: { label: string; diffs: AiTaskFileDiff[] | null }) {
  if (!diffs?.length) return null;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      {diffs.map((file) => (
        <div key={file.path} className="overflow-hidden rounded-md border">
          <p className="border-b bg-muted px-3 py-1.5 font-mono text-xs">{file.path}</p>
          <pre className="max-h-96 overflow-auto p-3 font-mono text-xs whitespace-pre-wrap">{file.diff}</pre>
        </div>
      ))}
    </div>
  );
}

function VerificationSection({
  label,
  verification,
  aiReviewPassed,
  aiReviewSummary,
}: {
  label: string;
  verification: AiTaskVerification | null;
  aiReviewPassed?: boolean | null;
  aiReviewSummary?: string | null;
}) {
  if (!verification) return null;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="flex flex-col gap-3 sm:flex-row sm:gap-4">
        <VerificationBlock label="Typecheck" result={verification.tsc} />
        <VerificationBlock label="Tests" result={verification.tests} />
      </div>
      {aiReviewSummary ? (
        <div className="flex flex-col gap-1.5">
          <Badge variant={aiReviewPassed ? 'success' : 'warning'}>
            AI review {aiReviewPassed ? '— no concerns' : '— flagged concerns'}
          </Badge>
          <p className="text-xs text-muted-foreground">
            Advisory only — checked the full project for impact, does not block approval.
          </p>
          <p className="text-sm">{aiReviewSummary}</p>
        </div>
      ) : null}
    </div>
  );
}

// The "all round results in detail" view — reused wherever a single task
// needs its full story shown at once (currently: clicking a row inside a
// persona's work popup), separate from the always-visible summary card so
// that card doesn't get as crowded.
function TaskFullDetail({ task, hideCode = false }: { task: AiEngineeringTask; hideCode?: boolean }) {
  return (
    <div className="flex flex-col gap-4">
      {task.friendlySummary ? <p className="text-xs text-muted-foreground">Technical title: {task.title}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={STATUS_VARIANT[task.status]}>{task.status}</Badge>
        <Badge variant="secondary">{task.severity}</Badge>
        <Badge variant="outline">{task.source === 'SCHEDULED_SCAN' ? '🤖 Auto-found' : 'Reported'}</Badge>
        {task.repairAttempts > 0 ? <Badge variant="outline">Auto-repaired ×{task.repairAttempts}</Badge> : null}
        {task.autoApproved ? <Badge variant="info">Auto-approved by Val — no human review needed</Badge> : null}
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
        <span>Reported {new Date(task.createdAt).toLocaleString()}</span>
        {task.completedAt ? <span>Completed {new Date(task.completedAt).toLocaleString()}</span> : null}
        {task.reviewedById ? <span>Reviewed by {task.reviewedById}</span> : null}
      </div>

      {task.reproSteps?.length ? (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Steps to reproduce</p>
          <ol className="list-decimal space-y-0.5 pl-5 text-sm">
            {task.reproSteps.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
        </div>
      ) : null}

      {task.errorMessage ? <p className="text-sm text-destructive">{task.errorMessage}</p> : null}
      {task.planSummary ? (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Project Manager&apos;s plan</p>
          <p className="text-sm">{task.planSummary}</p>
        </div>
      ) : null}
      {task.specialistSummary ? (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">What the fix does</p>
          <p className="whitespace-pre-wrap text-sm">{task.specialistSummary}</p>
        </div>
      ) : null}

      {task.touchesSchema ? (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
          <p className="font-semibold">This task changes the database schema</p>
          <p className="mt-1 text-muted-foreground">
            Approving drafts a migration file — TestPilot never runs it. Run{' '}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">npx prisma migrate deploy</code> and{' '}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">npx prisma generate</code> yourself once ready.
          </p>
          {!hideCode && task.migrationSql ? (
            <pre className="mt-2 max-h-64 overflow-auto rounded-md border bg-muted p-3 font-mono text-xs whitespace-pre-wrap">
              {task.migrationSql}
            </pre>
          ) : null}
        </div>
      ) : null}

      <VerificationSection
        label={task.area === 'BOTH' ? 'Backend verification' : 'Verification'}
        verification={task.verificationJson}
        aiReviewPassed={task.aiReviewPassed}
        aiReviewSummary={task.aiReviewSummary}
      />
      {!hideCode ? (
        <CodeDiffSection label={task.area === 'BOTH' ? 'Backend changes' : 'Changes'} diffs={task.diffSummary} />
      ) : null}
      {task.area === 'BOTH' ? (
        <>
          <VerificationSection
            label="Frontend verification"
            verification={task.secondaryVerificationJson}
            aiReviewPassed={task.secondaryAiReviewPassed}
            aiReviewSummary={task.secondaryAiReviewSummary}
          />
          {!hideCode ? <CodeDiffSection label="Frontend changes" diffs={task.secondaryDiffSummary} /> : null}
        </>
      ) : null}
    </div>
  );
}

export default function AiEngineeringPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [severity, setSeverity] = useState<BugSeverity>('MEDIUM');
  const [historyFilter, setHistoryFilter] = useState<AiTaskStatus | 'ALL'>('ALL');

  const { data: tasks = [] } = useQuery({
    queryKey: ['ai-tasks'],
    queryFn: listAiTasks,
    refetchInterval: (query) => ((query.state.data ?? []).some((t) => ACTIVE_STATUSES.includes(t.status)) ? 2000 : false),
  });

  const { data: activeTask } = useQuery({
    queryKey: ['ai-task', activeTaskId],
    queryFn: () => getAiTask(activeTaskId!),
    enabled: !!activeTaskId,
    refetchInterval: (query) => (ACTIVE_STATUSES.includes(query.state.data?.status as AiTaskStatus) ? 2000 : false),
  });

  const createMutation = useMutation({
    mutationFn: (input: { title: string; description: string; reproSteps: string[]; severity: BugSeverity }) =>
      createAiTask(input),
    onSuccess: (task) => {
      setActiveTaskId(task.id);
      queryClient.invalidateQueries({ queryKey: ['ai-tasks'] });
      toast.success('Bug reported — the AI Project Manager is triaging it now.');
    },
    onError: (err) => toast.error(errorMessage(err, 'Failed to submit the bug report')),
  });

  const approveMutation = useMutation({
    mutationFn: approveAiTask,
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['ai-task', activeTaskId] });
      queryClient.invalidateQueries({ queryKey: ['ai-tasks'] });
      toast.success(`Applied ${result.appliedFiles.length} file(s) to the real source.`);
    },
    onError: (err) => toast.error(blockerMessage(err, 'Failed to approve')),
  });

  const rejectMutation = useMutation({
    mutationFn: rejectAiTask,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-task', activeTaskId] });
      queryClient.invalidateQueries({ queryKey: ['ai-tasks'] });
      toast.success('Rejected — nothing was applied to the real source.');
    },
    onError: (err) => toast.error(blockerMessage(err, 'Failed to reject')),
  });

  const retryMutation = useMutation({
    mutationFn: retryAiTask,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-task', activeTaskId] });
      queryClient.invalidateQueries({ queryKey: ['ai-tasks'] });
      toast.success('Retrying — back in the queue for triage.');
    },
    onError: (err) => toast.error(blockerMessage(err, 'Failed to retry')),
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const title = String(form.get('title') ?? '');
    const description = String(form.get('description') ?? '');
    const reproSteps = String(form.get('reproSteps') ?? '')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!title || !description) return;
    createMutation.mutate({ title, description, reproSteps, severity });
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="AI Engineering"
        icon={Bot}
        description="Found a bug in TestPilot itself? Report it here — the AI Project Manager triages it, drafts a fix in an isolated workspace, and a human approves before anything reaches real source."
      />

      <TeamCard tasks={tasks} />

      <PipelineStatsRow tasks={tasks} />

      <NeedsReviewBanner tasks={tasks} onSelect={setActiveTaskId} />

      <Card>
        <CardHeader>
          <CardTitle>Report a bug</CardTitle>
          <CardDescription>This is about TestPilot itself, not an application you&apos;re testing with it.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="title">Title</Label>
              <Input id="title" name="title" placeholder="Short summary of the problem" required />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="description">Description</Label>
              <Textarea id="description" name="description" rows={3} placeholder="What's wrong, and what did you expect instead?" required />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="reproSteps">Steps to reproduce (one per line)</Label>
              <Textarea id="reproSteps" name="reproSteps" rows={4} placeholder={'1. Go to...\n2. Click...\n3. See...'} />
            </div>
            <div className="flex flex-col gap-2 sm:w-64">
              <Label>Severity</Label>
              <Select value={severity} onValueChange={(v) => v && setSeverity(v as BugSeverity)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="LOW">Low</SelectItem>
                  <SelectItem value="MEDIUM">Medium</SelectItem>
                  <SelectItem value="HIGH">High</SelectItem>
                  <SelectItem value="CRITICAL">Critical</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" disabled={createMutation.isPending} className="self-start">
              {createMutation.isPending ? 'Submitting…' : 'Report Bug'}
            </Button>
          </form>
        </CardContent>
      </Card>

      {activeTaskId && activeTask ? (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="truncate">{displayTitle(activeTask)}</CardTitle>
              <CardDescription>
                {activeTask.area ? `Area: ${activeTask.area}` : 'Being triaged…'}
                {activeTask.friendlySummary ? ` · ${activeTask.title}` : ''}
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={STATUS_VARIANT[activeTask.status]}>{activeTask.status}</Badge>
              <Badge variant="secondary">{activeTask.severity}</Badge>
              <Badge variant="outline">{activeTask.source === 'SCHEDULED_SCAN' ? '🤖 Auto-found' : 'Reported'}</Badge>
              {activeTask.repairAttempts > 0 ? (
                <Badge variant="outline">Auto-repaired ×{activeTask.repairAttempts}</Badge>
              ) : null}
              {activeTask.autoApproved ? <Badge variant="info">Auto-approved by Val</Badge> : null}
              {activeTask.diffSummary?.length || activeTask.secondaryDiffSummary?.length ? (
                <Dialog>
                  <DialogTrigger render={<Button size="sm" variant="outline" />}>Code Review</DialogTrigger>
                  <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-4xl">
                    <DialogHeader>
                      <DialogTitle>Code review — {activeTask.title}</DialogTitle>
                    </DialogHeader>
                    <div className="flex flex-col gap-4">
                      <CodeDiffSection
                        label={activeTask.area === 'BOTH' ? 'Backend changes' : 'Changes'}
                        diffs={activeTask.diffSummary}
                      />
                      {activeTask.area === 'BOTH' ? (
                        <CodeDiffSection label="Frontend changes" diffs={activeTask.secondaryDiffSummary} />
                      ) : null}
                    </div>
                  </DialogContent>
                </Dialog>
              ) : null}
              {activeTask.verificationJson || activeTask.secondaryVerificationJson ? (
                <Dialog>
                  <DialogTrigger render={<Button size="sm" variant="outline" />}>Test Review</DialogTrigger>
                  <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
                    <DialogHeader>
                      <DialogTitle>Test review — {activeTask.title}</DialogTitle>
                    </DialogHeader>
                    <div className="flex flex-col gap-4">
                      <VerificationSection
                        label={activeTask.area === 'BOTH' ? 'Backend verification' : 'Verification'}
                        verification={activeTask.verificationJson}
                        aiReviewPassed={activeTask.aiReviewPassed}
                        aiReviewSummary={activeTask.aiReviewSummary}
                      />
                      {activeTask.area === 'BOTH' ? (
                        <VerificationSection
                          label="Frontend verification"
                          verification={activeTask.secondaryVerificationJson}
                          aiReviewPassed={activeTask.secondaryAiReviewPassed}
                          aiReviewSummary={activeTask.secondaryAiReviewSummary}
                        />
                      ) : null}
                    </div>
                  </DialogContent>
                </Dialog>
              ) : null}
              {activeTask.status === 'WAITING_REVIEW' && isAdmin(user?.role) ? (
                <>
                  <Button size="sm" onClick={() => approveMutation.mutate(activeTask.id)} disabled={approveMutation.isPending}>
                    {approveMutation.isPending ? 'Applying…' : 'Approve & Apply'}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => rejectMutation.mutate(activeTask.id)}
                    disabled={rejectMutation.isPending}
                  >
                    Reject
                  </Button>
                </>
              ) : null}
              {activeTask.status === 'FAILED' ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => retryMutation.mutate(activeTask.id)}
                  disabled={retryMutation.isPending}
                >
                  {retryMutation.isPending ? 'Retrying…' : 'Retry'}
                </Button>
              ) : null}
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
              <span>Reported {new Date(activeTask.createdAt).toLocaleString()}</span>
              {activeTask.completedAt ? <span>Completed {new Date(activeTask.completedAt).toLocaleString()}</span> : null}
              {activeTask.reviewedById ? <span>Reviewed by {activeTask.reviewedById}</span> : null}
            </div>

            {activeTask.reproSteps?.length ? (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Steps to reproduce</p>
                <ol className="list-decimal space-y-0.5 pl-5 text-sm">
                  {activeTask.reproSteps.map((step, i) => (
                    <li key={i}>{step}</li>
                  ))}
                </ol>
              </div>
            ) : null}

            {activeTask.errorMessage ? <p className="text-sm text-destructive">{activeTask.errorMessage}</p> : null}
            {activeTask.planSummary ? (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Project Manager&apos;s plan
                </p>
                <p className="text-sm">{activeTask.planSummary}</p>
              </div>
            ) : null}
            {activeTask.specialistSummary ? (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">What the fix does</p>
                <p className="whitespace-pre-wrap text-sm">{activeTask.specialistSummary}</p>
              </div>
            ) : null}

            {activeTask.touchesSchema ? (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
                <p className="font-semibold">This task changes the database schema</p>
                <p className="mt-1 text-muted-foreground">
                  Approving drafts a migration file — TestPilot never runs it. Run{' '}
                  <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">npx prisma migrate deploy</code> and{' '}
                  <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">npx prisma generate</code> yourself once ready.
                </p>
                {activeTask.migrationSql ? (
                  <pre className="mt-2 max-h-64 overflow-auto rounded-md border bg-muted p-3 font-mono text-xs whitespace-pre-wrap">
                    {activeTask.migrationSql}
                  </pre>
                ) : null}
              </div>
            ) : null}

          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>Report history</CardTitle>
            <CardDescription>Every bug reported, its review verdict, and who signed off.</CardDescription>
          </div>
          <Select value={historyFilter} onValueChange={(v) => v && setHistoryFilter(v as AiTaskStatus | 'ALL')}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All statuses</SelectItem>
              {(Object.keys(STATUS_VARIANT) as AiTaskStatus[]).map((status) => (
                <SelectItem key={status} value={status}>
                  {status}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table className="min-w-[820px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Area</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>AI review</TableHead>
                  <TableHead>Reviewed by</TableHead>
                  <TableHead>Reported</TableHead>
                </TableRow>
              </TableHeader>
              <AnimatedTableBody>
                {(() => {
                  const filtered = historyFilter === 'ALL' ? tasks : tasks.filter((t) => t.status === historyFilter);
                  if (filtered.length === 0) {
                    return (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center text-muted-foreground">
                          {tasks.length === 0 ? 'No bugs reported yet.' : 'No tasks match this filter.'}
                        </TableCell>
                      </TableRow>
                    );
                  }
                  return filtered.map((task) => {
                    const aiReview = task.aiReviewPassed ?? task.secondaryAiReviewPassed;
                    return (
                      <AnimatedTableRow key={task.id} className="cursor-pointer" onClick={() => setActiveTaskId(task.id)}>
                        <TableCell className="max-w-sm truncate">{displayTitle(task)}</TableCell>
                        <TableCell>{task.area ?? '—'}</TableCell>
                        <TableCell>{task.severity}</TableCell>
                        <TableCell>{task.source === 'SCHEDULED_SCAN' ? '🤖 Auto-found' : 'Reported'}</TableCell>
                        <TableCell>
                          <Badge variant={STATUS_VARIANT[task.status]}>{task.status}</Badge>
                        </TableCell>
                        <TableCell>
                          {aiReview === undefined || aiReview === null ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            <Badge variant={aiReview ? 'success' : 'warning'}>{aiReview ? 'Clean' : 'Flagged'}</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {task.autoApproved ? 'Auto (Val)' : task.reviewedById ? 'Yes' : '—'}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{new Date(task.createdAt).toLocaleString()}</TableCell>
                      </AnimatedTableRow>
                    );
                  });
                })()}
              </AnimatedTableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <div className="mt-2 flex items-center gap-3">
        <div className="h-px flex-1 bg-border" />
        <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Testing &amp; verification</p>
        <div className="h-px flex-1 bg-border" />
      </div>

      <TestCycleCard tasks={tasks} />

      <RegressionSuiteCard
        title="Backend Regression Suite"
        description="The real jest suite, run live against TestPilot's own backend source — not a cached count."
        queryFn={getBackendTestSuite}
      />

      <RegressionSuiteCard
        title="Frontend Regression Suite"
        description="The real vitest suite, run live against TestPilot's own frontend source — not a cached count."
        queryFn={getFrontendTestSuite}
      />

      <RegressionSuiteCard
        title="E2E Regression Suite"
        description="Real browser automation against the live app — login, scan, generate, execute. Takes minutes, not seconds."
        queryFn={getE2ETestSuite}
      />
    </div>
  );
}
