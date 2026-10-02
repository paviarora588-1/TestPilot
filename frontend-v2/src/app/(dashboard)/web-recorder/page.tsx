'use client';

import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { ArrowDown, ArrowUp, Trash2, Video } from 'lucide-react';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageHeader } from '@/components/layout/page-header';
import { AnimatedTableBody, AnimatedTableRow } from '@/components/motion/animated-table';
import {
  cancelRecording,
  convertRecording,
  deleteRecordingSession,
  deleteRecordingStep,
  getRecordingSession,
  listRecordingSessions,
  pauseRecording,
  reorderRecordingSteps,
  resumeRecording,
  startRecording,
  stopRecording,
  updateRecordingStep,
} from '@/lib/api';
import { useApplicationContext } from '@/lib/application-context';
import { useAuth } from '@/lib/auth-context';
import { canApprove } from '@/lib/roles';
import type { AutomationFramework, RecordingStatus, WebRecordingStep } from '@/lib/types';

const STATUS_VARIANT: Record<RecordingStatus, 'success' | 'secondary' | 'destructive' | 'outline' | 'info' | 'warning'> = {
  LAUNCHING: 'info',
  RECORDING: 'info',
  PAUSED: 'warning',
  STOPPED: 'secondary',
  CONVERTED: 'success',
  FAILED: 'destructive',
  CANCELLED: 'outline',
  ABANDONED: 'destructive',
};

const ACTIVE_STATUSES: RecordingStatus[] = ['LAUNCHING', 'RECORDING', 'PAUSED'];

// A plain-English sentence for what actually happened — written for someone
// reviewing the recording who has never seen a CSS selector, not for a
// developer. The technical locator is still shown (smaller, clearly
// labeled) alongside it for anyone who does need to verify or fix it.
function describeStep(step: WebRecordingStep): string {
  const name = step.label?.trim();
  switch (step.actionType) {
    case 'NAVIGATE':
      return `Went to "${name || step.pageUrl || 'a page'}"`;
    case 'CLICK':
      return name ? `Clicked "${name}"` : 'Clicked an element';
    case 'DOUBLE_CLICK':
      return name ? `Double-clicked "${name}"` : 'Double-clicked an element';
    case 'RIGHT_CLICK':
      return name ? `Right-clicked "${name}"` : 'Right-clicked an element';
    case 'ENTER_TEXT':
      return name ? `Typed into "${name}"` : 'Typed into a field';
    case 'SELECT_OPTION':
      return name ? `Selected an option in "${name}"` : 'Selected a dropdown option';
    case 'CHECK':
      return name ? `Checked "${name}"` : 'Checked a box';
    case 'UNCHECK':
      return name ? `Unchecked "${name}"` : 'Unchecked a box';
    case 'UPLOAD_FILE':
      return name ? `Uploaded a file to "${name}"` : 'Uploaded a file';
    case 'NEW_TAB':
      return 'Opened a new browser tab';
    case 'SWITCH_TAB':
      return 'Switched to another browser tab';
    case 'CLOSE_TAB':
      return 'Closed a browser tab';
    case 'ALERT_ACCEPT':
      return 'Accepted a popup message';
    case 'ALERT_DISMISS':
      return 'Dismissed a popup message';
    default:
      return name || step.actionType;
  }
}

function blockerMessage(err: unknown, fallback: string) {
  if (isAxiosError(err) && err.response?.data?.reasons?.length) {
    return (err.response.data.reasons as string[]).join(' ');
  }
  return fallback;
}

function errorMessage(err: unknown, fallback: string) {
  if (isAxiosError(err) && typeof err.response?.data?.message === 'string') {
    return err.response.data.message as string;
  }
  return fallback;
}

function deriveVariableName(step: WebRecordingStep): string {
  const source = step.label?.trim().toLowerCase() || step.actionType.toLowerCase();
  return source.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'value';
}

function StepRow({
  step,
  index,
  total,
  editable,
  onRename,
  onToggleVariable,
  onRenameVariable,
  onToggleSensitive,
  onDelete,
  onMove,
}: {
  step: WebRecordingStep;
  index: number;
  total: number;
  editable: boolean;
  onRename: (label: string) => void;
  onToggleVariable: (isVariable: boolean) => void;
  onRenameVariable: (variableName: string) => void;
  onToggleSensitive: (isSensitive: boolean) => void;
  onDelete: () => void;
  onMove: (direction: 'up' | 'down') => void;
}) {
  return (
    <AnimatedTableRow>
      <TableCell className="text-muted-foreground">{index + 1}</TableCell>
      <TableCell className="max-w-sm">
        <p className="font-medium">{describeStep(step)}</p>
        {step.pageTitle || step.pageUrl ? (
          <p className="truncate text-xs text-muted-foreground">on &quot;{step.pageTitle || step.pageUrl}&quot;</p>
        ) : null}
        {editable ? (
          <Input
            key={step.label ?? ''}
            defaultValue={step.label ?? ''}
            onBlur={(e) => e.target.value !== (step.label ?? '') && onRename(e.target.value)}
            className="mt-1 h-8"
            placeholder="Rename this step"
          />
        ) : null}
        {step.recommendedLocator ? (
          <p className="mt-1 truncate text-[11px] text-muted-foreground">
            Technical locator: <span className="font-mono">{step.recommendedLocator}</span>
          </p>
        ) : null}
      </TableCell>
      <TableCell className="max-w-[200px]">
        {step.isSensitive ? (
          <span className="text-xs italic text-muted-foreground">hidden</span>
        ) : (
          <span className="truncate font-mono text-xs">{step.rawValue ?? <span className="text-muted-foreground">—</span>}</span>
        )}
        {step.isVariable ? (
          editable ? (
            <Input
              key={step.variableName ?? ''}
              defaultValue={step.variableName ?? ''}
              onBlur={(e) => e.target.value !== (step.variableName ?? '') && onRenameVariable(e.target.value)}
              className="mt-1 h-7 font-mono text-xs"
              placeholder="variable_name"
            />
          ) : (
            <p className="font-mono text-[11px] text-accent-foreground">${'{'}{step.variableName}{'}'}</p>
          )
        ) : null}
      </TableCell>
      <TableCell>
        {editable ? (
          <div className="flex flex-wrap items-center justify-end gap-1">
            <Button size="icon" variant="ghost" disabled={index === 0} onClick={() => onMove('up')} title="Move up">
              <ArrowUp className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              disabled={index === total - 1}
              onClick={() => onMove('down')}
              title="Move down"
            >
              <ArrowDown className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="sm"
              variant={step.isVariable ? 'default' : 'outline'}
              onClick={() => onToggleVariable(!step.isVariable)}
            >
              {step.isVariable ? 'Variable' : 'Make variable'}
            </Button>
            <Button
              size="sm"
              variant={step.isSensitive ? 'default' : 'outline'}
              onClick={() => onToggleSensitive(!step.isSensitive)}
            >
              {step.isSensitive ? 'Sensitive' : 'Mark sensitive'}
            </Button>
            <Button size="icon" variant="ghost" onClick={onDelete} title="Delete step">
              <Trash2 className="h-3.5 w-3.5 text-destructive" />
            </Button>
          </div>
        ) : null}
      </TableCell>
    </AnimatedTableRow>
  );
}

export default function WebRecorderPage() {
  const { selectedApplication } = useApplicationContext();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [framework, setFramework] = useState<AutomationFramework>('PLAYWRIGHT');

  const { data: sessions = [] } = useQuery({
    queryKey: ['recording-sessions', selectedApplication?.id],
    queryFn: () => listRecordingSessions(selectedApplication!.id),
    enabled: !!selectedApplication,
    refetchInterval: (query) => ((query.state.data ?? []).some((s) => ACTIVE_STATUSES.includes(s.status)) ? 1500 : false),
  });

  const { data: activeSession } = useQuery({
    queryKey: ['recording-session', activeSessionId],
    queryFn: () => getRecordingSession(activeSessionId!),
    enabled: !!activeSessionId,
    refetchInterval: (query) => (ACTIVE_STATUSES.includes(query.state.data?.status as RecordingStatus) ? 1500 : false),
  });

  function refreshActive() {
    if (activeSessionId) queryClient.invalidateQueries({ queryKey: ['recording-session', activeSessionId] });
    queryClient.invalidateQueries({ queryKey: ['recording-sessions', selectedApplication?.id] });
  }

  const startMutation = useMutation({
    mutationFn: (targetUrl: string) => startRecording(selectedApplication!.id, targetUrl, framework),
    onSuccess: (session) => {
      setActiveSessionId(session.id);
      queryClient.invalidateQueries({ queryKey: ['recording-sessions', selectedApplication?.id] });
      toast.success('Launching a browser window to record in…');
    },
    onError: (err) => toast.error(errorMessage(err, 'Failed to start recording')),
  });

  const pauseMutation = useMutation({ mutationFn: pauseRecording, onSuccess: refreshActive, onError: () => toast.error('Failed to pause') });
  const resumeMutation = useMutation({ mutationFn: resumeRecording, onSuccess: refreshActive, onError: () => toast.error('Failed to resume') });
  const stopMutation = useMutation({
    mutationFn: stopRecording,
    onSuccess: () => {
      refreshActive();
      toast.success('Recording stopped — review the steps below.');
    },
    onError: () => toast.error('Failed to stop recording'),
  });
  const cancelMutation = useMutation({ mutationFn: cancelRecording, onSuccess: refreshActive, onError: () => toast.error('Failed to cancel') });

  const updateStepMutation = useMutation({
    mutationFn: (input: { stepId: string; data: Parameters<typeof updateRecordingStep>[2] }) =>
      updateRecordingStep(activeSessionId!, input.stepId, input.data),
    onSuccess: refreshActive,
    onError: () => toast.error('Failed to update step'),
  });
  const deleteStepMutation = useMutation({
    mutationFn: (stepId: string) => deleteRecordingStep(activeSessionId!, stepId),
    onSuccess: refreshActive,
    onError: () => toast.error('Failed to delete step'),
  });
  const reorderMutation = useMutation({
    mutationFn: (orderedStepIds: string[]) => reorderRecordingSteps(activeSessionId!, orderedStepIds),
    onSuccess: refreshActive,
    onError: () => toast.error('Failed to reorder steps'),
  });
  const convertMutation = useMutation({
    mutationFn: () => convertRecording(activeSessionId!),
    onSuccess: (flow) => {
      toast.success(`Created automation flow "${flow.name}" — open it from Automation Builder to generate a script.`);
      refreshActive();
    },
    onError: (err) => toast.error(blockerMessage(err, 'Failed to convert recording')),
  });
  const deleteSessionMutation = useMutation({
    mutationFn: deleteRecordingSession,
    onSuccess: (_data, deletedId) => {
      queryClient.invalidateQueries({ queryKey: ['recording-sessions', selectedApplication?.id] });
      if (activeSessionId === deletedId) setActiveSessionId(null);
      toast.success('Recording deleted');
    },
    onError: (err) => toast.error(blockerMessage(err, 'Failed to delete recording')),
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const targetUrl = String(form.get('targetUrl') ?? '');
    if (targetUrl) startMutation.mutate(targetUrl);
  }

  if (!selectedApplication) {
    return (
      <div>
        <PageHeader title="Web Recorder" icon={Video} />
        <Card>
          <CardContent className="p-6 text-muted-foreground">
            Create an application first, then select it from the switcher in the top bar.
          </CardContent>
        </Card>
      </div>
    );
  }

  const steps = activeSession?.steps ?? [];
  const isActive = activeSession ? ACTIVE_STATUSES.includes(activeSession.status) : false;
  const isStopped = activeSession?.status === 'STOPPED';
  const hasActiveRecording = sessions.some((s) => ACTIVE_STATUSES.includes(s.status));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Web Recorder"
        icon={Video}
        description={`Record real actions in a live browser against ${selectedApplication.name} and turn them into an automation flow.`}
      />

      <Card>
        <CardHeader>
          <CardTitle>Start a recording</CardTitle>
          <CardDescription>
            Opens a real, visible Chromium window on this machine. Perform the flow there — clicks, typing, dropdowns,
            navigation all get captured — then come back here to review and convert it into a script.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
            <div className="flex min-w-[240px] flex-1 flex-col gap-2">
              <Label htmlFor="targetUrl">Target URL</Label>
              <Input
                id="targetUrl"
                name="targetUrl"
                placeholder="https://…"
                defaultValue={selectedApplication.entryUrl ?? ''}
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label>Framework</Label>
              <Select value={framework} onValueChange={(v) => v && setFramework(v as AutomationFramework)}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PLAYWRIGHT">Playwright</SelectItem>
                  <SelectItem value="SELENIUM">Selenium (Java)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" disabled={startMutation.isPending || hasActiveRecording}>
              {startMutation.isPending ? 'Launching…' : 'Start Recording'}
            </Button>
          </form>
          {hasActiveRecording ? (
            <p className="mt-2 text-xs text-muted-foreground">
              A recording is already in progress for this application — stop or cancel it before starting another.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {activeSessionId && activeSession ? (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="truncate">{activeSession.targetUrl}</CardTitle>
              <CardDescription>
                {steps.length} step{steps.length === 1 ? '' : 's'} captured
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={STATUS_VARIANT[activeSession.status]}>{activeSession.status}</Badge>
              {activeSession.status === 'RECORDING' ? (
                <Button size="sm" variant="outline" onClick={() => pauseMutation.mutate(activeSession.id)}>
                  Pause
                </Button>
              ) : null}
              {activeSession.status === 'PAUSED' ? (
                <Button size="sm" variant="outline" onClick={() => resumeMutation.mutate(activeSession.id)}>
                  Resume
                </Button>
              ) : null}
              {isActive ? (
                <>
                  <Button size="sm" onClick={() => stopMutation.mutate(activeSession.id)}>
                    Stop Recording
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => cancelMutation.mutate(activeSession.id)}>
                    Cancel
                  </Button>
                </>
              ) : null}
              {isStopped ? (
                <Button size="sm" onClick={() => convertMutation.mutate()} disabled={convertMutation.isPending}>
                  {convertMutation.isPending ? 'Converting…' : 'Convert to Flow'}
                </Button>
              ) : null}
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {activeSession.status === 'FAILED' || activeSession.status === 'ABANDONED' ? (
              <p className="text-sm text-destructive">{activeSession.errorMessage}</p>
            ) : null}
            {isActive ? (
              <p className="text-sm text-muted-foreground">
                Perform the flow in the browser window that opened — captured steps appear below automatically.
              </p>
            ) : null}
            {activeSession.status === 'CONVERTED' ? (
              <p className="text-sm text-muted-foreground">
                Converted into an automation flow — open Automation Builder to review it and generate a script.
              </p>
            ) : null}
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">#</TableHead>
                    <TableHead>What happened</TableHead>
                    <TableHead>Value</TableHead>
                    <TableHead className="w-64" />
                  </TableRow>
                </TableHeader>
                <AnimatedTableBody>
                  {steps.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-muted-foreground">
                        No steps captured yet.
                      </TableCell>
                    </TableRow>
                  ) : (
                    steps.map((step, index) => (
                      <StepRow
                        key={step.id}
                        step={step}
                        index={index}
                        total={steps.length}
                        editable={isStopped}
                        onRename={(label) => updateStepMutation.mutate({ stepId: step.id, data: { label } })}
                        onToggleVariable={(isVariable) =>
                          updateStepMutation.mutate({
                            stepId: step.id,
                            data: { isVariable, variableName: isVariable ? step.variableName ?? deriveVariableName(step) : undefined },
                          })
                        }
                        onRenameVariable={(variableName) => updateStepMutation.mutate({ stepId: step.id, data: { variableName } })}
                        onToggleSensitive={(isSensitive) => updateStepMutation.mutate({ stepId: step.id, data: { isSensitive } })}
                        onDelete={() => deleteStepMutation.mutate(step.id)}
                        onMove={(direction) => {
                          const ids = steps.map((s) => s.id);
                          const j = direction === 'up' ? index - 1 : index + 1;
                          if (j < 0 || j >= ids.length) return;
                          [ids[index], ids[j]] = [ids[j], ids[index]];
                          reorderMutation.mutate(ids);
                        }}
                      />
                    ))
                  )}
                </AnimatedTableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Recording history</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>URL</TableHead>
                <TableHead>Framework</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Started</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <AnimatedTableBody>
              {sessions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    No recordings yet.
                  </TableCell>
                </TableRow>
              ) : (
                sessions.map((session) => (
                  <AnimatedTableRow key={session.id} className="cursor-pointer" onClick={() => setActiveSessionId(session.id)}>
                    <TableCell className="max-w-sm truncate">{session.targetUrl}</TableCell>
                    <TableCell>{session.framework}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[session.status]}>{session.status}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {session.startedAt ? new Date(session.startedAt).toLocaleString() : '—'}
                    </TableCell>
                    <TableCell>
                      {canApprove(user?.role) && !ACTIVE_STATUSES.includes(session.status) ? (
                        <AlertDialog>
                          <AlertDialogTrigger render={<Button size="icon" variant="ghost" onClick={(e) => e.stopPropagation()} />}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </AlertDialogTrigger>
                          <AlertDialogContent onClick={(e) => e.stopPropagation()}>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete this recording?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This removes the recording session and its captured steps. Any automation flow it was already
                                converted into is unaffected. This cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => deleteSessionMutation.mutate(session.id)}>Delete</AlertDialogAction>
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
    </div>
  );
}
