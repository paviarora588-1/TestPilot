'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { Bug, CheckCircle2, ListChecks, Play, PlayCircle, RotateCcw, ScanSearch, Send, Trash2, Wrench, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { PageHeader } from '@/components/layout/page-header';
import { AnimatedTableBody, AnimatedTableRow } from '@/components/motion/animated-table';
import {
  approveAutoHeal,
  assetUrl,
  deleteExecution,
  executeScript,
  generateBugReport,
  getExecution,
  getSuite,
  listAutomationFlows,
  listExecutions,
  listScriptsForFlow,
  rejectAutoHeal,
  retryExecution,
  runSuite,
  submitBugReport,
  updateBugReport,
  validateScript,
} from '@/lib/api';
import { cn } from '@/lib/utils';
import { useApplicationContext } from '@/lib/application-context';
import { useAuth } from '@/lib/auth-context';
import { canApprove, canOperate } from '@/lib/roles';
import type { BugReport, BugSeverity, ExecutionRun, ExecutionStatus, StepResultStatus } from '@/lib/types';

const SEVERITIES: BugSeverity[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

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

const STEP_STATUS_VARIANT: Record<StepResultStatus, 'success' | 'secondary' | 'destructive' | 'outline' | 'info'> = {
  PENDING: 'outline',
  RUNNING: 'info',
  COMPLETED: 'success',
  FAILED: 'destructive',
  SKIPPED: 'outline',
};

const STEP_STATUS_DOT: Record<StepResultStatus, string> = {
  PENDING: 'bg-muted-foreground',
  RUNNING: 'bg-sky-500 animate-pulse',
  COMPLETED: 'bg-emerald-500',
  FAILED: 'bg-destructive',
  SKIPPED: 'bg-muted-foreground',
};

function StatusCell({ status, dot, variant }: { status: string; dot: string; variant: 'success' | 'secondary' | 'destructive' | 'outline' | 'info' }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', dot)} />
      <Badge variant={variant}>{status}</Badge>
    </div>
  );
}

function blockerMessage(err: unknown, fallback: string) {
  if (isAxiosError(err) && err.response?.data?.reasons?.length) {
    return (err.response.data.reasons as string[]).join(' ');
  }
  return fallback;
}

// AI drafts the bug report from the failed execution's evidence, but it only
// ever opens here as an editable draft — nothing reaches Jira until the user
// reviews/edits and explicitly clicks Submit.
function BugReportDialog({ report, onClose }: { report: BugReport; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(report);

  const updateMutation = useMutation({
    mutationFn: () =>
      updateBugReport(draft.id, {
        title: draft.title,
        stepsToReproduce: draft.stepsToReproduce,
        actualResult: draft.actualResult,
        expectedResult: draft.expectedResult ?? undefined,
        severity: draft.severity,
        environment: draft.environment ?? undefined,
      }),
    onSuccess: (updated) => {
      setDraft(updated);
      toast.success('Draft saved');
    },
    onError: () => toast.error('Failed to save draft'),
  });

  const submitMutation = useMutation({
    mutationFn: () => submitBugReport(draft.id),
    onSuccess: (updated) => {
      setDraft(updated);
      queryClient.invalidateQueries({ queryKey: ['bug-reports'] });
      if (updated.status === 'SUBMITTED') {
        toast.success(`Filed as ${updated.externalIssueKey}`);
      } else {
        toast.error(updated.errorMessage ?? 'Submission failed');
      }
    },
    onError: () => toast.error('Submission failed'),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bug className="h-4 w-4" />
            Bug Report {draft.status === 'SUBMITTED' ? <Badge>{draft.externalIssueKey}</Badge> : <Badge variant="secondary">DRAFT</Badge>}
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label>Title</Label>
            <Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          </div>
          <div className="flex flex-col gap-2">
            <Label>Steps to reproduce</Label>
            <Textarea
              rows={5}
              value={draft.stepsToReproduce.join('\n')}
              onChange={(e) => setDraft({ ...draft, stepsToReproduce: e.target.value.split('\n').filter(Boolean) })}
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label>Actual result</Label>
              <Textarea
                rows={2}
                value={draft.actualResult}
                onChange={(e) => setDraft({ ...draft, actualResult: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label>Expected result</Label>
              <Textarea
                rows={2}
                value={draft.expectedResult ?? ''}
                onChange={(e) => setDraft({ ...draft, expectedResult: e.target.value })}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label>Severity</Label>
              <Select value={draft.severity} onValueChange={(v) => v && setDraft({ ...draft, severity: v as BugSeverity })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SEVERITIES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label>Environment</Label>
              <Input
                value={draft.environment ?? ''}
                onChange={(e) => setDraft({ ...draft, environment: e.target.value })}
              />
            </div>
          </div>
          {draft.evidencePaths && draft.evidencePaths.length > 0 ? (
            <div className="flex flex-col gap-2">
              <Label>Evidence</Label>
              <div className="flex flex-wrap gap-2">
                {draft.evidencePaths.map((p) => (
                  <a key={p} href={assetUrl(p)!} target="_blank" rel="noreferrer">
                    <img src={assetUrl(p)!} alt="Evidence" className="h-16 w-24 rounded border object-cover object-top" />
                  </a>
                ))}
              </div>
            </div>
          ) : null}
          {draft.status === 'FAILED' && draft.errorMessage ? (
            <p className="text-sm text-destructive">Last submit attempt failed: {draft.errorMessage}</p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => updateMutation.mutate()} disabled={updateMutation.isPending}>
              {updateMutation.isPending ? 'Saving…' : 'Save draft'}
            </Button>
            <Button
              onClick={() => submitMutation.mutate()}
              disabled={submitMutation.isPending || draft.status === 'SUBMITTED'}
            >
              <Send className="mr-2 h-4 w-4" />
              {submitMutation.isPending ? 'Submitting…' : draft.status === 'SUBMITTED' ? 'Submitted' : 'Submit to Jira'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ExecutionDetail({ executionId }: { executionId: string }) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [bugReport, setBugReport] = useState<BugReport | null>(null);
  const { data: run } = useQuery({
    queryKey: ['execution', executionId],
    queryFn: () => getExecution(executionId),
    refetchInterval: (query) => (query.state.data?.status === 'RUNNING' ? 1500 : false),
  });

  const retryMutation = useMutation({
    mutationFn: () => retryExecution(executionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['execution', executionId] });
      toast.success('Re-run started');
    },
    onError: (err) => toast.error(blockerMessage(err, 'Retry failed')),
  });

  const decideMutation = useMutation({
    mutationFn: ({ id, approve }: { id: string; approve: boolean }) => (approve ? approveAutoHeal(id) : rejectAutoHeal(id)),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['execution', executionId] });
      toast.success(vars.approve ? 'Auto-heal applied to Object Library' : 'Suggestion rejected');
    },
    onError: () => toast.error('Failed to record decision'),
  });

  const bugReportMutation = useMutation({
    mutationFn: () => generateBugReport(executionId),
    onSuccess: (report) => {
      setBugReport(report);
      toast.success('AI drafted a bug report — review before submitting.');
    },
    onError: (err) => toast.error(blockerMessage(err, 'Bug report generation failed')),
  });

  if (!run) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const analysis = run.failureAnalysisJson;

  return (
    <Card>
      {bugReport ? <BugReportDialog report={bugReport} onClose={() => setBugReport(null)} /> : null}
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            {run.runType === 'VALIDATION' ? (
              <Badge variant="outline" className="gap-1">
                <ScanSearch className="h-3 w-3" />
                Validation — dry run, not a real execution
              </Badge>
            ) : null}
            {run.script?.automationFlow?.name ?? 'Execution'} — {run.id.slice(-8)}
          </CardTitle>
          <CardDescription>{run.command}</CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={STATUS_VARIANT[run.status]}>{run.status}</Badge>
          <span className="text-xs text-muted-foreground">{run.durationSeconds.toFixed(1)}s</span>
          {(run.status === 'FAILED' || run.status === 'BLOCKED') && canOperate(user?.role) ? (
            <Button size="sm" variant="outline" onClick={() => retryMutation.mutate()} disabled={retryMutation.isPending}>
              <RotateCcw className="mr-2 h-4 w-4" />
              {retryMutation.isPending ? 'Retrying…' : 'Retry'}
            </Button>
          ) : null}
          {run.status === 'FAILED' && run.runType !== 'VALIDATION' && canOperate(user?.role) ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => bugReportMutation.mutate()}
              disabled={bugReportMutation.isPending}
            >
              <Bug className="mr-2 h-4 w-4" />
              {bugReportMutation.isPending ? 'Drafting…' : 'Report Bug'}
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">#</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Target</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-48">Duration</TableHead>
              <TableHead className="w-24">Screenshot</TableHead>
            </TableRow>
          </TableHeader>
          <AnimatedTableBody>
            {(run.stepResults ?? []).map((step) => {
              const maxDuration = Math.max(0.01, ...(run.stepResults ?? []).map((s) => s.durationSeconds));
              const barPct = Math.max(3, Math.round((step.durationSeconds / maxDuration) * 100));
              return (
              <AnimatedTableRow key={step.id}>
                <TableCell className="text-muted-foreground">{step.stepOrder}</TableCell>
                <TableCell className="font-medium">{step.action}</TableCell>
                <TableCell className="text-muted-foreground">{step.instruction ?? '—'}</TableCell>
                <TableCell>
                  <StatusCell status={step.status} dot={STEP_STATUS_DOT[step.status]} variant={STEP_STATUS_VARIANT[step.status]} />
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-24 shrink-0 overflow-hidden rounded-full bg-muted">
                      <div
                        className={cn('h-full rounded-full', STEP_STATUS_DOT[step.status].replace(' animate-pulse', ''))}
                        style={{ width: `${barPct}%` }}
                      />
                    </div>
                    <span className="font-mono text-xs text-muted-foreground">{step.durationSeconds.toFixed(2)}s</span>
                  </div>
                </TableCell>
                <TableCell>
                  {step.screenshotPath ? (
                    <a href={assetUrl(step.screenshotPath)!} target="_blank" rel="noreferrer">
                      <img
                        src={assetUrl(step.screenshotPath)!}
                        alt={`Step ${step.stepOrder} screenshot`}
                        className="h-12 w-20 rounded border border-border object-cover object-top transition-opacity hover:opacity-80"
                      />
                    </a>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </TableCell>
              </AnimatedTableRow>
              );
            })}
          </AnimatedTableBody>
        </Table>

        {analysis ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
            <div className="flex items-center gap-2 font-medium text-destructive">
              <XCircle className="h-4 w-4" />
              {analysis.category.replace(/_/g, ' ')}
            </div>
            <p className="mt-1 text-muted-foreground">{analysis.aiRootCause ?? analysis.likelyRootCause}</p>
            <p className="mt-1">
              <span className="font-medium">Suggested fix: </span>
              {analysis.aiSuggestedFix ?? analysis.suggestedFix}
            </p>
            {analysis.aiSuggestedCodeFix ? (
              <pre className="mt-2 max-h-48 overflow-auto rounded-md bg-muted p-3 text-xs">{analysis.aiSuggestedCodeFix}</pre>
            ) : null}
            {!analysis.aiEnrichmentAvailable ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Deterministic analysis only — AI enrichment unavailable (no local/cloud model reachable).
              </p>
            ) : null}
          </div>
        ) : null}

        {(run.autoHealSuggestions ?? []).length > 0 ? (
          <div className="flex flex-col gap-2">
            <p className="flex items-center gap-2 text-sm font-medium">
              <Wrench className="h-4 w-4" />
              Auto-heal suggestions
            </p>
            {(run.autoHealSuggestions ?? []).map((s) => (
              <div key={s.id} className="flex flex-col gap-1 rounded-md border p-3 text-sm">
                <p>{s.reason}</p>
                <p className="font-mono text-xs text-muted-foreground">
                  {s.oldPath} → {s.suggestedPath}
                </p>
                <div className="mt-1 flex items-center gap-2">
                  <Badge variant={s.status === 'APPROVED' ? 'success' : s.status === 'REJECTED' ? 'destructive' : 'secondary'}>
                    {s.status}
                  </Badge>
                  {s.status === 'PENDING' && canApprove(user?.role) ? (
                    <>
                      <Button size="sm" variant="outline" onClick={() => decideMutation.mutate({ id: s.id, approve: true })}>
                        <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                        Approve
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => decideMutation.mutate({ id: s.id, approve: false })}>
                        Reject
                      </Button>
                    </>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {run.logs && run.logs.length > 0 ? (
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer select-none">Raw log</summary>
            <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-muted p-3">{run.logs.join('\n')}</pre>
          </details>
        ) : null}
      </CardContent>
    </Card>
  );
}

function SuiteDetail({ suiteId }: { suiteId: string }) {
  const { data: suite } = useQuery({
    queryKey: ['execution-suite', suiteId],
    queryFn: () => getSuite(suiteId),
    refetchInterval: (query) => (query.state.data?.status === 'RUNNING' ? 1500 : false),
  });

  if (!suite) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-base">Suite run — {suite.id.slice(-8)}</CardTitle>
          <CardDescription>{suite.scope} · continue-on-failure</CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={STATUS_VARIANT[suite.status]}>{suite.status}</Badge>
          <span className="text-xs text-muted-foreground">
            {suite.passCount} passed · {suite.failCount} failed · {suite.totalCount} total
          </span>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Script</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Duration</TableHead>
            </TableRow>
          </TableHeader>
          <AnimatedTableBody>
            {(suite.runs ?? []).map((run) => (
              <AnimatedTableRow key={run.id}>
                <TableCell>{run.script?.automationFlow?.name ?? run.scriptId.slice(-8)}</TableCell>
                <TableCell>
                  <StatusCell status={run.status} dot={STATUS_DOT[run.status]} variant={STATUS_VARIANT[run.status]} />
                </TableCell>
                <TableCell>{run.durationSeconds.toFixed(1)}s</TableCell>
              </AnimatedTableRow>
            ))}
          </AnimatedTableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

export default function ExecutionsPage() {
  const { selectedApplication } = useApplicationContext();
  const { user } = useAuth();
  const appId = selectedApplication?.id;
  const queryClient = useQueryClient();
  const [selectedFlowId, setSelectedFlowId] = useState<string | null>(null);
  const [viewing, setViewing] = useState<{ type: 'run' | 'suite'; id: string } | null>(null);

  const { data: flows = [] } = useQuery({
    queryKey: ['automation-flows', appId],
    queryFn: () => listAutomationFlows(appId!),
    enabled: !!appId,
  });
  const { data: scripts = [] } = useQuery({
    queryKey: ['flow-scripts', selectedFlowId],
    queryFn: () => listScriptsForFlow(selectedFlowId!),
    enabled: !!selectedFlowId,
  });
  const { data: executions = [] } = useQuery({
    queryKey: ['executions', appId],
    queryFn: () => listExecutions(appId!),
    enabled: !!appId,
    refetchInterval: (query) =>
      (query.state.data ?? []).some((r: ExecutionRun) => r.status === 'RUNNING') ? 2000 : false,
  });

  const executeMutation = useMutation({
    mutationFn: executeScript,
    onSuccess: (run) => {
      queryClient.invalidateQueries({ queryKey: ['executions', appId] });
      setViewing({ type: 'run', id: run.id });
      toast.success('Execution started');
    },
    onError: (err) => toast.error(blockerMessage(err, 'Execution blocked')),
  });

  // Pre-flight dry run — locates every bound object, never clicks/types/
  // submits. A clean pass means the Object Library is current right now,
  // before the real, potentially data-mutating Execute run.
  const validateMutation = useMutation({
    mutationFn: validateScript,
    onSuccess: (run) => {
      queryClient.invalidateQueries({ queryKey: ['executions', appId] });
      setViewing({ type: 'run', id: run.id });
      toast.success('Validation started');
    },
    onError: (err) => toast.error(blockerMessage(err, 'Validation failed to start')),
  });

  const runSuiteMutation = useMutation({
    mutationFn: (scriptIds: string[]) => runSuite(appId!, 'SELECTED', scriptIds),
    onSuccess: (suite) => {
      queryClient.invalidateQueries({ queryKey: ['executions', appId] });
      setViewing({ type: 'suite', id: suite.id });
      toast.success('Suite run started');
    },
    onError: () => toast.error('Failed to start suite'),
  });

  const deleteExecutionMutation = useMutation({
    mutationFn: deleteExecution,
    onSuccess: (_data, deletedId) => {
      queryClient.invalidateQueries({ queryKey: ['executions', appId] });
      if (viewing?.type === 'run' && viewing.id === deletedId) setViewing(null);
      toast.success('Execution deleted');
    },
    onError: (err) => toast.error(blockerMessage(err, 'Failed to delete execution')),
  });

  if (!selectedApplication) {
    return (
      <div>
        <PageHeader title="Executions" icon={PlayCircle} />
        <Card>
          <CardContent className="p-6 text-muted-foreground">
            Create an application first, then select it from the switcher in the top bar.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Executions"
        icon={PlayCircle}
        description={`Run generated scripts and review live results for ${selectedApplication.name}.`}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Flows</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <AnimatedTableBody>
              {flows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={2} className="text-center text-muted-foreground">
                    No flows yet — build one in Automation Builder.
                  </TableCell>
                </TableRow>
              ) : (
                flows.map((flow) => (
                  <AnimatedTableRow key={flow.id} className="cursor-pointer" onClick={() => setSelectedFlowId(flow.id)}>
                    <TableCell className="font-medium">{flow.name}</TableCell>
                    <TableCell>
                      <Badge variant={flow.status === 'DRAFT' ? 'secondary' : 'success'}>{flow.status}</Badge>
                    </TableCell>
                  </AnimatedTableRow>
                ))
              )}
            </AnimatedTableBody>
          </Table>
        </CardContent>
      </Card>

      {selectedFlowId ? (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Scripts</CardTitle>
            {scripts.length > 1 && canOperate(user?.role) ? (
              <Button
                size="sm"
                variant="outline"
                disabled={runSuiteMutation.isPending}
                onClick={() => runSuiteMutation.mutate(scripts.map((s) => s.id))}
              >
                <ListChecks className="mr-2 h-4 w-4" />
                Run all as suite
              </Button>
            ) : null}
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Generated</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Risk</TableHead>
                  <TableHead className="w-32" />
                </TableRow>
              </TableHeader>
              <AnimatedTableBody>
                {scripts.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground">
                      No scripts generated yet for this flow.
                    </TableCell>
                  </TableRow>
                ) : (
                  scripts.map((s) => (
                    <AnimatedTableRow key={s.id}>
                      <TableCell>{new Date(s.createdAt).toLocaleString()}</TableCell>
                      <TableCell>
                        <Badge variant={s.status === 'REVIEWED' ? 'success' : 'secondary'}>{s.status}</Badge>
                      </TableCell>
                      <TableCell>{s.riskScore != null ? Math.round(s.riskScore * 100) + '%' : '—'}</TableCell>
                      <TableCell>
                        {canOperate(user?.role) ? (
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={validateMutation.isPending}
                              onClick={() => validateMutation.mutate(s.id)}
                              title="Locate every object without clicking, typing, or submitting anything"
                            >
                              <ScanSearch className="mr-2 h-4 w-4" />
                              Validate
                            </Button>
                            <Button
                              size="sm"
                              disabled={executeMutation.isPending}
                              onClick={() => executeMutation.mutate(s.id)}
                            >
                              <Play className="mr-2 h-4 w-4" />
                              Execute
                            </Button>
                          </div>
                        ) : null}
                      </TableCell>
                    </AnimatedTableRow>
                  ))
                )}
              </AnimatedTableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Execution history</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Run</TableHead>
                <TableHead>Framework</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>When</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <AnimatedTableBody>
              {executions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    No executions yet.
                  </TableCell>
                </TableRow>
              ) : (
                executions.map((run) => (
                  <AnimatedTableRow key={run.id} className="cursor-pointer" onClick={() => setViewing({ type: 'run', id: run.id })}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {run.runType === 'VALIDATION' ? (
                          <Badge variant="outline" className="gap-1">
                            <ScanSearch className="h-3 w-3" />
                            Validate
                          </Badge>
                        ) : null}
                        {run.script?.automationFlow?.name ?? run.id.slice(-8)}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{run.script?.framework ?? '—'}</TableCell>
                    <TableCell>
                      <StatusCell status={run.status} dot={STATUS_DOT[run.status]} variant={STATUS_VARIANT[run.status]} />
                    </TableCell>
                    <TableCell>{run.durationSeconds.toFixed(1)}s</TableCell>
                    <TableCell className="text-muted-foreground">{new Date(run.createdAt).toLocaleString()}</TableCell>
                    <TableCell>
                      {canApprove(user?.role) ? (
                        <AlertDialog>
                          <AlertDialogTrigger
                            render={<Button size="icon" variant="ghost" onClick={(e) => e.stopPropagation()} />}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </AlertDialogTrigger>
                          <AlertDialogContent onClick={(e) => e.stopPropagation()}>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete this execution?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This removes the run and its step results and screenshots. This cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => deleteExecutionMutation.mutate(run.id)}>Delete</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      ) : null}
                    </TableCell>
                  </AnimatedTableRow>
                ))
              )}
            </AnimatedTableBody>
          </Table>
        </CardContent>
      </Card>

      {viewing?.type === 'run' ? <ExecutionDetail executionId={viewing.id} /> : null}
      {viewing?.type === 'suite' ? <SuiteDetail suiteId={viewing.id} /> : null}
    </div>
  );
}
