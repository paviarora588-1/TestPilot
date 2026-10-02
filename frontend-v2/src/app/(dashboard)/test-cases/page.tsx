'use client';

import { ChangeEvent, FormEvent, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { isAxiosError } from 'axios';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, GitBranch, ListChecks, PlayCircle, Sparkles, SquarePen, Trash2, Upload, Workflow } from 'lucide-react';
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
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { PageHeader } from '@/components/layout/page-header';
import { StaggerContainer, StaggerItem } from '@/components/motion/stagger';
import { BrainOrbIllustration, SearchDocIllustration } from '@/components/illustrations/glow-illustrations';
import {
  analyzeTestCase,
  createTestCase,
  deleteTestCase,
  generateFlowFromTestCase,
  getAutoAutomateJob,
  getCodexGenerationPrompts,
  getDataRequirements,
  getRegressionRecommendation,
  getTestCase,
  getTestCaseGenerationJob,
  importTestCases,
  listIntegrations,
  listJiraStoryImports,
  listKnowledgeSources,
  listTestCases,
  cancelTestCaseGenerationJob,
  saveDataRequirements,
  startAutoAutomateJob,
  startCodexTestCaseGenerationJob,
  startTestCaseGenerationJob,
  updateTestCase,
} from '@/lib/api';
import { useApplicationContext } from '@/lib/application-context';
import { useAuth } from '@/lib/auth-context';
import { isAdmin } from '@/lib/roles';
import { cn } from '@/lib/utils';
import type { AutomationStatus, TestCase, TestCasePriority } from '@/lib/types';

const PRIORITIES: TestCasePriority[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

const PRIORITY_VARIANT: Record<TestCasePriority, 'outline' | 'info' | 'warning' | 'destructive'> = {
  LOW: 'outline',
  MEDIUM: 'info',
  HIGH: 'warning',
  CRITICAL: 'destructive',
};

const AUTOMATION_COLUMNS: { status: AutomationStatus; label: string }[] = [
  { status: 'NOT_STARTED', label: 'Not started' },
  { status: 'MAPPED', label: 'Mapped' },
  { status: 'SCRIPT_GENERATED', label: 'Script generated' },
  { status: 'AUTOMATED', label: 'Automated' },
];

function blockerMessage(err: unknown, fallback: string) {
  if (isAxiosError(err) && err.response?.data?.reasons?.length) {
    return (err.response.data.reasons as string[]).join(' ');
  }
  return fallback;
}

function AnalysisPanel({ testCaseId, applicationId }: { testCaseId: string; applicationId: string }) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const { data: testCase, isLoading } = useQuery({
    queryKey: ['test-case', testCaseId],
    queryFn: () => getTestCase(testCaseId),
  });

  const analyzeMutation = useMutation({
    mutationFn: () => analyzeTestCase(testCaseId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['test-case', testCaseId] });
      toast.success('Analysis complete');
    },
    onError: () => toast.error('Analysis failed'),
  });

  const generateFlowMutation = useMutation({
    mutationFn: () => generateFlowFromTestCase(applicationId, testCaseId),
    onSuccess: (flow) => {
      toast.success('AI generated a flow — opening Automation Builder to review it.');
      if (flow.unmatchedReferences && flow.unmatchedReferences.length > 0) {
        toast.warning(
          `This test case mentions "${flow.unmatchedReferences.join('", "')}" — not found in the Object Library. Scan the screen(s) where these appear so the flow can bind to them.`,
        );
      }
      router.push('/automation-builder');
    },
    onError: (err) => toast.error(blockerMessage(err, 'AI flow generation failed')),
  });

  const regressionMutation = useMutation({
    mutationFn: () => getRegressionRecommendation(testCaseId),
    onError: () => toast.error('Regression analysis failed'),
  });

  if (isLoading || !testCase) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const analysis = testCase.analysisResultJson;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">{testCase.title}</CardTitle>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => analyzeMutation.mutate()} disabled={analyzeMutation.isPending}>
            <Sparkles className="mr-2 h-4 w-4" />
            {analyzeMutation.isPending ? 'Analyzing…' : 'Analyze'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => generateFlowMutation.mutate()}
            disabled={generateFlowMutation.isPending}
          >
            <Workflow className="mr-2 h-4 w-4" />
            {generateFlowMutation.isPending ? 'Generating…' : 'Generate Flow with AI'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => regressionMutation.mutate()}
            disabled={regressionMutation.isPending}
          >
            <GitBranch className="mr-2 h-4 w-4" />
            {regressionMutation.isPending ? 'Analyzing…' : 'Regression Impact'}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div>
          <p className="mb-2 text-sm font-medium">Steps</p>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
            {testCase.steps?.map((step) => <li key={step.id}>{step.instruction}</li>)}
          </ol>
        </div>

        {regressionMutation.data ? (
          <div className="flex flex-col gap-2 border-t pt-4">
            <p className="text-sm font-medium">
              {regressionMutation.data.recommended.length === 0
                ? 'No related test cases found — this change looks isolated.'
                : `This test case affects ${regressionMutation.data.recommended.length} other test case(s):`}
            </p>
            {regressionMutation.data.recommended.map((r) => (
              <div key={r.testCaseId} className="flex items-center justify-between rounded-md border p-2 text-sm">
                <div>
                  <span className="font-medium">{r.title}</span>
                  <p className="text-xs text-muted-foreground">
                    {r.moduleName ?? 'No module'} · {r.sharedObjects} shared object(s) · {r.reason}
                  </p>
                </div>
                <Badge variant={r.riskLevel === 'HIGH' ? 'destructive' : r.riskLevel === 'MEDIUM' ? 'secondary' : 'outline'}>
                  {r.riskLevel} risk
                </Badge>
              </div>
            ))}
          </div>
        ) : null}
        {analysis ? (
          <>
          <div className="grid grid-cols-1 gap-4 border-t pt-4 sm:grid-cols-2">
            <div>
              <p className="text-xs font-medium text-muted-foreground">Required objects</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {analysis.requiredObjects.length === 0 ? (
                  <span className="text-sm text-muted-foreground">none matched</span>
                ) : (
                  Array.from(new Set(analysis.requiredObjects)).map((obj) => (
                    <Badge key={obj} variant="secondary">
                      {obj}
                    </Badge>
                  ))
                )}
              </div>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">Missing object mappings</p>
              <div className="mt-1">
                {analysis.missingObjectMappings.length === 0 ? (
                  <Badge>0 missing</Badge>
                ) : (
                  Array.from(new Set(analysis.missingObjectMappings)).map((m) => (
                    <p key={m} className="text-sm text-destructive">
                      {m}
                    </p>
                  ))
                )}
              </div>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">Required test data</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {Array.from(new Set(analysis.requiredTestData)).map((d) => (
                  <Badge key={d} variant="outline">
                    {d}
                  </Badge>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">Automatable</p>
              <Badge variant={analysis.automatable ? 'success' : 'secondary'}>
                {analysis.automatable ? 'Yes' : 'Not yet'}
              </Badge>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">Knowledge base context</p>
              <Badge variant={analysis.ragContextUsed ? 'info' : 'outline'}>
                {analysis.ragContextUsed ? 'Used' : 'None retrieved'}
              </Badge>
            </div>
            {!analysis.aiEnrichmentAvailable ? (
              <p className="col-span-2 text-xs text-muted-foreground">
                Object mapping is deterministic (matched against the Object Library) and always available. Qualitative
                AI enrichment (page purpose, validations, gaps) needs a configured local/cloud AI provider — none is
                reachable right now, see Settings.
              </p>
            ) : null}
          </div>
          <TestDataQuestions testCaseId={testCaseId} />
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Not analyzed yet.</p>
        )}
      </CardContent>
    </Card>
  );
}

// Asks one yes/no question per screen the test case touches ("Provide
// specific details for Applicant Details?") instead of leaving every field
// to the AI's guess when a flow is generated later. Answering "yes" reveals
// editable inputs pre-filled with a deterministic suggestion for recognized
// field patterns (name/email/username/etc.); saved values are keyed to
// match generateFromTestCase's own object+screen lookup, so they're reused
// automatically — no per-field wiring needed on the generation side.
function TestDataQuestions({ testCaseId }: { testCaseId: string }) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['test-case-data-requirements', testCaseId],
    queryFn: () => getDataRequirements(testCaseId),
    // The fields below are uncontrolled (defaultValue) so the user's typing
    // isn't clobbered by a re-render — a background refetch (e.g. on window
    // focus) would otherwise change an already-initialized field's default
    // out from under them. The only thing that should ever refresh this is
    // our own save mutation, via explicit invalidation below.
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());

  const saveMutation = useMutation({
    mutationFn: (values: { objectId: string; value: string }[]) => saveDataRequirements(testCaseId, values),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['test-case-data-requirements', testCaseId] });
      toast.success(
        result.saved > 0
          ? `Saved ${result.saved} value(s) — Generate Flow with AI will reuse them.`
          : 'No values entered — toggle a section on and fill in at least one field to save.',
      );
    },
    onError: () => toast.error('Failed to save test data'),
  });

  function toggleGroup(screenName: string) {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(screenName)) next.delete(screenName);
      else next.add(screenName);
      return next;
    });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const values: { objectId: string; value: string }[] = [];
    for (const group of data?.groups ?? []) {
      if (!openGroups.has(group.screenName)) continue;
      for (const field of group.fields) {
        const value = String(form.get(`field:${field.objectId}`) ?? '').trim();
        if (value) values.push({ objectId: field.objectId, value });
      }
    }
    saveMutation.mutate(values);
  }

  if (isLoading || !data || data.groups.length === 0) return null;

  return (
    <div className="border-t pt-4">
      <p className="text-sm font-medium">Test data</p>
      <p className="mt-1 text-xs text-muted-foreground">
        This test case touches {data.groups.length} section{data.groups.length === 1 ? '' : 's'} with fields to fill
        in. Turn a section on to provide specific values — otherwise Generate Flow with AI will guess.
      </p>
      <form onSubmit={handleSubmit} className="mt-3 flex flex-col gap-3">
        {data.groups.map((group) => {
          const isOpen = openGroups.has(group.screenName);
          const missingCount = group.fields.filter((f) => !f.existingValue).length;
          return (
            <div key={group.screenName} className="rounded-md border p-3">
              <label className="flex cursor-pointer items-center justify-between gap-3">
                <span className="text-sm">
                  Provide specific details for <strong>{group.screenName}</strong>?
                  {missingCount > 0 ? (
                    <Badge variant="outline" className="ml-2">
                      {missingCount} missing
                    </Badge>
                  ) : (
                    <Badge variant="success" className="ml-2">
                      all set
                    </Badge>
                  )}
                </span>
                <Checkbox checked={isOpen} onCheckedChange={() => toggleGroup(group.screenName)} />
              </label>
              {isOpen ? (
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {group.fields.map((field) => (
                    <div key={field.objectId} className="flex flex-col gap-1">
                      <Label htmlFor={`field:${field.objectId}`} className="text-xs">
                        {field.fieldLabel}
                      </Label>
                      <Input
                        // Uncontrolled (defaultValue only sets the initial value) —
                        // keying on whether a saved value exists forces a clean
                        // remount on that one legitimate transition (unsaved ->
                        // saved) instead of mutating an already-initialized
                        // field's default in place.
                        key={field.existingValue ?? 'unsaved'}
                        id={`field:${field.objectId}`}
                        name={`field:${field.objectId}`}
                        type={field.sensitive ? 'password' : 'text'}
                        defaultValue={field.existingValue ?? field.suggestedValue ?? ''}
                        placeholder={field.suggestedValue ? undefined : 'No suggestion — enter a value'}
                      />
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
        {openGroups.size > 0 ? (
          <Button type="submit" size="sm" className="self-start" disabled={saveMutation.isPending}>
            {saveMutation.isPending ? 'Saving…' : 'Save Test Data'}
          </Button>
        ) : null}
      </form>
    </div>
  );
}

function EditTestCaseDialog({
  testCaseId,
  applicationId,
  open,
  onOpenChange,
}: {
  testCaseId: string;
  applicationId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  // Full detail only — the table's list query doesn't include steps.
  const { data: testCase, isLoading } = useQuery({
    queryKey: ['test-case', testCaseId],
    queryFn: () => getTestCase(testCaseId),
    enabled: open,
  });

  const updateMutation = useMutation({
    mutationFn: (data: Parameters<typeof updateTestCase>[1]) => updateTestCase(testCaseId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['test-cases', applicationId] });
      queryClient.invalidateQueries({ queryKey: ['test-case', testCaseId] });
      toast.success('Test case updated');
      onOpenChange(false);
    },
    onError: () => toast.error('Failed to update test case'),
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const stepsRaw = String(form.get('steps') ?? '');
    updateMutation.mutate({
      title: String(form.get('title') ?? ''),
      moduleName: String(form.get('moduleName') ?? '') || undefined,
      featureName: String(form.get('featureName') ?? '') || undefined,
      priority: String(form.get('priority') ?? 'MEDIUM'),
      expectedResult: String(form.get('expectedResult') ?? '') || undefined,
      steps: stepsRaw
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((instruction) => ({ instruction })),
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit Test Case</DialogTitle>
        </DialogHeader>
        {isLoading || !testCase ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <form key={testCase.id} onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="edit-title">Title</Label>
              <Input id="edit-title" name="title" required defaultValue={testCase.title} />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="flex flex-col gap-2">
                <Label htmlFor="edit-moduleName">Module</Label>
                <Input id="edit-moduleName" name="moduleName" defaultValue={testCase.moduleName ?? ''} />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="edit-featureName">Feature</Label>
                <Input id="edit-featureName" name="featureName" defaultValue={testCase.featureName ?? ''} />
              </div>
              <div className="flex flex-col gap-2">
                <Label>Priority</Label>
                <Select name="priority" defaultValue={testCase.priority}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRIORITIES.map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="edit-steps">Steps (one per line)</Label>
              <Textarea
                id="edit-steps"
                name="steps"
                rows={5}
                defaultValue={(testCase.steps ?? []).map((s) => s.instruction).join('\n')}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="edit-expectedResult">Expected result</Label>
              <Input id="edit-expectedResult" name="expectedResult" defaultValue={testCase.expectedResult ?? ''} />
            </div>
            <Button type="submit" disabled={updateMutation.isPending}>
              {updateMutation.isPending ? 'Saving…' : 'Save Changes'}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function TestCaseCard({
  tc,
  isSelected,
  isChecked,
  onSelect,
  onToggleChecked,
  onEdit,
  onDelete,
}: {
  tc: TestCase;
  isSelected: boolean;
  isChecked: boolean;
  onSelect: () => void;
  onToggleChecked: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <Card
      className={cn(
        'cursor-pointer border-l-4 p-3 transition-transform hover:-translate-y-0.5',
        isSelected ? 'border-primary ring-1 ring-primary' : 'border-l-border',
      )}
      onClick={onSelect}
    >
      <div className="flex items-start justify-between gap-2">
        <div onClick={(e) => e.stopPropagation()}>
          <Checkbox checked={isChecked} onCheckedChange={onToggleChecked} aria-label={`Select ${tc.title}`} />
        </div>
        <div className="flex shrink-0 gap-0.5" onClick={(e) => e.stopPropagation()}>
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onEdit} aria-label={`Edit ${tc.title}`}>
            <SquarePen className="h-3.5 w-3.5" />
          </Button>
          <AlertDialog>
            <AlertDialogTrigger render={<Button size="icon" variant="ghost" className="h-7 w-7" />}>
              <Trash2 className="h-3.5 w-3.5 text-destructive" />
            </AlertDialogTrigger>
            <AlertDialogContent onClick={(e) => e.stopPropagation()}>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete {tc.title}?</AlertDialogTitle>
                <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={onDelete}>Delete</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
      <p className="mt-1 line-clamp-2 text-sm font-medium">{tc.title}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {[tc.moduleName, tc.featureName].filter(Boolean).join(' / ') || '—'}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <Badge variant={PRIORITY_VARIANT[tc.priority]}>{tc.priority}</Badge>
        <Badge variant="secondary">{tc.source}</Badge>
      </div>
    </Card>
  );
}

export default function TestCasesPage() {
  const { selectedApplication } = useApplicationContext();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedTestCaseId, setSelectedTestCaseId] = useState<string | null>(null);
  const [editingTestCaseId, setEditingTestCaseId] = useState<string | null>(null);
  const [aiCount, setAiCount] = useState(5);
  const [aiFocus, setAiFocus] = useState('');
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: testCases = [], isLoading } = useQuery({
    queryKey: ['test-cases', selectedApplication?.id],
    queryFn: () => listTestCases(selectedApplication!.id),
    enabled: !!selectedApplication,
  });

  const createMutation = useMutation({
    mutationFn: (data: Parameters<typeof createTestCase>[1]) => createTestCase(selectedApplication!.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['test-cases', selectedApplication?.id] });
      toast.success('Test case created');
      setDialogOpen(false);
    },
    onError: () => toast.error('Failed to create test case'),
  });

  const importMutation = useMutation({
    mutationFn: (file: File) => importTestCases(selectedApplication!.id, file),
    onSuccess: (result: { imported: number }) => {
      queryClient.invalidateQueries({ queryKey: ['test-cases', selectedApplication?.id] });
      toast.success(`Imported ${result.imported} test case(s)`);
    },
    onError: () => toast.error('Import failed'),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteTestCase,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['test-cases', selectedApplication?.id] });
      toast.success('Test case deleted');
    },
  });

  const [generationJobId, setGenerationJobId] = useState<string | null>(null);

  const startGenerationMutation = useMutation({
    mutationFn: () =>
      startTestCaseGenerationJob(selectedApplication!.id, {
        count: aiCount,
        focus: aiFocus || undefined,
        autoGenerateFlows: true,
      }),
    onSuccess: (job) => setGenerationJobId(job.id),
    onError: (err) => toast.error(blockerMessage(err, 'AI test case generation failed to start')),
  });

  // Polled instead of one long blocking request — a local AI model doing one
  // call per test case (plus a flow-generation attempt per item) genuinely
  // takes minutes, so this is the only way to show real progress and to
  // know the job is still alive rather than a frozen spinner.
  const { data: generationJob } = useQuery({
    queryKey: ['test-case-generation-job', generationJobId],
    queryFn: async () => {
      const polledJobId = generationJobId!;
      const job = await getTestCaseGenerationJob(polledJobId);
      if (job.status === 'COMPLETED' || job.status === 'FAILED') {
        setGenerationJobId((activeJobId) => (activeJobId === polledJobId ? null : activeJobId));
      }
      return job;
    },
    enabled: !!generationJobId,
    refetchInterval: (query) =>
      query.state.data?.status === 'RUNNING' || query.state.data?.status === 'QUEUED' ? 1500 : false,
  });

  useEffect(() => {
    if (!generationJob) return;
    if (generationJob.status === 'COMPLETED' && generationJob.resultJson && 'testCases' in generationJob.resultJson) {
      queryClient.invalidateQueries({ queryKey: ['test-cases', selectedApplication?.id] });
      queryClient.invalidateQueries({ queryKey: ['automation-flows', selectedApplication?.id] });
      const result = generationJob.resultJson;
      const automated = result.testCases.filter((tc) => tc.flowGenerated).length;
      toast.success(
        `AI created ${result.created} test case(s)${automated > 0 ? ` and automated ${automated} of them` : ''} — review them below.`,
      );
    } else if (generationJob.status === 'FAILED') {
      toast.error(generationJob.errorMessage ?? 'AI test case generation failed');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generationJob?.status]);

  const isGenerating = !!generationJobId && (generationJob?.status === 'RUNNING' || generationJob?.status === 'QUEUED' || !generationJob);

  const cancelGenerationMutation = useMutation({
    mutationFn: () => cancelTestCaseGenerationJob(generationJobId!),
    onSuccess: () => {
      toast.info('Generation cancelled');
      setGenerationJobId(null);
    },
    onError: () => toast.error('Failed to cancel — it may have already finished'),
  });

  // Source-aware, Codex-powered generation — Knowledge Base, a linked Jira
  // story, existing Zephyr test cases, and a free-text prompt are all
  // independently optional (Object Library / scanned objects are always
  // included). Admin-only, internal-tool path — kept fully separate from the
  // local-AI generation above rather than merged, since the two run against
  // different backends with different result shapes.
  const appId = selectedApplication?.id;
  const showCodexSection = isAdmin(user?.role);
  const [engine, setEngine] = useState<'LOCAL' | 'CODEX'>('LOCAL');

  const { data: jiraImports = [] } = useQuery({
    queryKey: ['jira-story-imports', appId],
    queryFn: () => listJiraStoryImports(appId!),
    enabled: !!appId && showCodexSection,
  });
  const { data: knowledgeSources = [] } = useQuery({
    queryKey: ['knowledge-sources', appId],
    queryFn: () => listKnowledgeSources(appId!),
    enabled: !!appId && showCodexSection,
  });
  const { data: integrations = [] } = useQuery({
    queryKey: ['integrations', appId],
    queryFn: () => listIntegrations(appId!),
    enabled: !!appId && showCodexSection,
  });
  const hasProcessedKnowledge = knowledgeSources.some((s) => s.status === 'PROCESSED');
  const hasZephyrIntegration = integrations.some((i) => i.type === 'ZEPHYR');

  const [codexCount, setCodexCount] = useState(6);
  const [codexUserPrompt, setCodexUserPrompt] = useState('');
  const [codexJiraStoryImportId, setCodexJiraStoryImportId] = useState<string>('__none__');
  const [codexIncludeKb, setCodexIncludeKb] = useState(true);
  const [codexIncludeZephyr, setCodexIncludeZephyr] = useState(true);
  const [codexChainAutomation, setCodexChainAutomation] = useState(true);
  const [codexJobId, setCodexJobId] = useState<string | null>(null);

  const startCodexGenerationMutation = useMutation({
    mutationFn: () =>
      startCodexTestCaseGenerationJob(selectedApplication!.id, {
        count: codexCount,
        userPrompt: codexUserPrompt || undefined,
        jiraStoryImportId: codexJiraStoryImportId === '__none__' ? undefined : codexJiraStoryImportId,
        includeKnowledgeBase: codexIncludeKb && hasProcessedKnowledge,
        includeZephyr: codexIncludeZephyr && hasZephyrIntegration,
        chainAutomation: codexChainAutomation,
      }),
    onSuccess: (job) => setCodexJobId(job.id),
    onError: (err) => toast.error(blockerMessage(err, 'Codex test case generation failed to start')),
  });

  const { data: codexJob } = useQuery({
    queryKey: ['test-case-generation-job', codexJobId],
    queryFn: () => getTestCaseGenerationJob(codexJobId!),
    enabled: !!codexJobId,
    refetchInterval: (query) =>
      query.state.data?.status === 'RUNNING' || query.state.data?.status === 'QUEUED' ? 1500 : false,
  });

  const isCodexGenerating = !!codexJobId && (codexJob?.status === 'RUNNING' || codexJob?.status === 'QUEUED' || !codexJob);

  useEffect(() => {
    if (!codexJob) return;
    if (codexJob.status === 'COMPLETED' && codexJob.resultJson && 'testCaseIds' in codexJob.resultJson) {
      queryClient.invalidateQueries({ queryKey: ['test-cases', selectedApplication?.id] });
      queryClient.invalidateQueries({ queryKey: ['automation-flows', selectedApplication?.id] });
      const result = codexJob.resultJson;
      toast.success(
        `Codex created ${result.created} test case(s)${codexChainAutomation ? ' and built automation flow/script/review for each' : ''} — review them below.`,
      );
      const stuck = result.automationSummary?.results.filter((r) => r.status !== 'EXECUTED' && r.status !== 'SCRIPT_GENERATED') ?? [];
      if (stuck.length > 0) {
        toast.warning(
          `${stuck.length} of ${result.created} didn't make it to a generated script: ` +
            stuck.map((r) => `"${r.testCaseTitle}" — ${r.reasons.join(' ') || r.status}`).join('; '),
        );
      }
    } else if (codexJob.status === 'FAILED') {
      toast.error(codexJob.errorMessage ?? 'Codex test case generation failed');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codexJob?.status]);

  // Kept visible after completion (unlike the local-AI job above) — the
  // whole point of this path is full visibility into what was actually sent
  // to Codex, not just the final result.
  const { data: codexPrompts = [] } = useQuery({
    queryKey: ['codex-generation-prompts', codexJobId],
    queryFn: () => getCodexGenerationPrompts(codexJobId!),
    enabled: !!codexJobId && (codexJob?.status === 'COMPLETED' || codexJob?.status === 'FAILED'),
  });

  // Chains flow generation -> script generation -> execution for every
  // selected test case — job-based (not one long-lived HTTP request), so the
  // batch keeps running server-side no matter what the browser does while
  // it's in flight; this page just polls for progress.
  const [autoAutomateEngine, setAutoAutomateEngine] = useState<'LOCAL' | 'CODEX'>('LOCAL');
  const [autoAutomateJobId, setAutoAutomateJobId] = useState<string | null>(null);

  const startAutoAutomateMutation = useMutation({
    mutationFn: () => startAutoAutomateJob(selectedApplication!.id, Array.from(checkedIds), autoAutomateEngine),
    onSuccess: (job) => {
      setAutoAutomateJobId(job.id);
      setCheckedIds(new Set());
    },
    onError: (err) => toast.error(blockerMessage(err, 'Automation pipeline failed to start')),
  });

  const { data: autoAutomateJob } = useQuery({
    queryKey: ['auto-automate-job', autoAutomateJobId],
    queryFn: () => getAutoAutomateJob(autoAutomateJobId!),
    enabled: !!autoAutomateJobId,
    refetchInterval: (query) =>
      query.state.data?.status === 'RUNNING' || query.state.data?.status === 'QUEUED' ? 1500 : false,
  });

  const isAutoAutomating =
    !!autoAutomateJobId && (autoAutomateJob?.status === 'RUNNING' || autoAutomateJob?.status === 'QUEUED' || !autoAutomateJob);

  useEffect(() => {
    if (!autoAutomateJob) return;
    if (autoAutomateJob.status === 'COMPLETED' && autoAutomateJob.resultJson) {
      queryClient.invalidateQueries({ queryKey: ['test-cases', selectedApplication?.id] });
      queryClient.invalidateQueries({ queryKey: ['automation-flows', selectedApplication?.id] });
      queryClient.invalidateQueries({ queryKey: ['execution-suites', selectedApplication?.id] });
      const { executing, blocked, total } = autoAutomateJob.resultJson.summary;
      if (blocked === 0) {
        toast.success(`Automating ${executing} of ${total} test case(s) — check Executions for progress.`);
      } else {
        toast.warning(`${executing} of ${total} test case(s) are now running; ${blocked} were blocked — see details below.`);
      }
    } else if (autoAutomateJob.status === 'FAILED') {
      toast.error(autoAutomateJob.errorMessage ?? 'Automation pipeline failed');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoAutomateJob?.status]);

  const autoAutomateResult = autoAutomateJob?.status === 'COMPLETED' ? autoAutomateJob.resultJson : null;

  function toggleChecked(id: string) {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllChecked() {
    setCheckedIds((prev) => (prev.size === testCases.length ? new Set() : new Set(testCases.map((tc) => tc.id))));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const stepsRaw = String(form.get('steps') ?? '');
    createMutation.mutate({
      title: String(form.get('title') ?? ''),
      moduleName: String(form.get('moduleName') ?? '') || undefined,
      featureName: String(form.get('featureName') ?? '') || undefined,
      priority: String(form.get('priority') ?? 'MEDIUM'),
      expectedResult: String(form.get('expectedResult') ?? '') || undefined,
      steps: stepsRaw
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((instruction) => ({ instruction })),
    });
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) importMutation.mutate(file);
    event.target.value = '';
  }

  if (!selectedApplication) {
    return (
      <div>
        <PageHeader title="Test Cases" icon={ListChecks} />
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
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageHeader
          title="Test Cases"
          icon={ListChecks}
          description={`Imported and manually authored test cases for ${selectedApplication.name}.`}
        />
        <div className="flex gap-2">
          <input ref={fileInputRef} type="file" accept=".csv,.xlsx" className="hidden" onChange={handleFileChange} />
          <Button variant="outline" onClick={() => fileInputRef.current?.click()} disabled={importMutation.isPending}>
            <Upload className="mr-2 h-4 w-4" />
            {importMutation.isPending ? 'Importing…' : 'Import CSV/Excel'}
          </Button>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger render={<Button />}>New Test Case</DialogTrigger>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>New Test Case</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="title">Title</Label>
                  <Input id="title" name="title" required placeholder="OrangeHRM Login" />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="moduleName">Module</Label>
                    <Input id="moduleName" name="moduleName" placeholder="Auth" />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="featureName">Feature</Label>
                    <Input id="featureName" name="featureName" placeholder="Login" />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label>Priority</Label>
                    <Select name="priority" defaultValue="MEDIUM">
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PRIORITIES.map((p) => (
                          <SelectItem key={p} value={p}>
                            {p}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="steps">Steps (one per line)</Label>
                  <Textarea
                    id="steps"
                    name="steps"
                    rows={5}
                    placeholder={'Enter username\nEnter password\nClick login button\nVerify dashboard is visible'}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="expectedResult">Expected result</Label>
                  <Input id="expectedResult" name="expectedResult" placeholder="User lands on the dashboard" />
                </div>
                <Button type="submit" disabled={createMutation.isPending}>
                  {createMutation.isPending ? 'Creating…' : 'Create Test Case'}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card className="border-primary/40 bg-gradient-to-br from-primary/[0.07] via-transparent to-transparent dark:shadow-[0_0_0_1px_color-mix(in_oklch,var(--primary)_40%,transparent),0_0_50px_-16px_var(--primary)]">
        <CardContent className="flex flex-col gap-5 p-6 sm:flex-row sm:items-center">
          <BrainOrbIllustration />
          <div className="flex flex-1 flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Sparkles className="h-4 w-4 text-primary" />
                  Generate with AI
                  <Badge variant="info" className="ml-1">
                    AI
                  </Badge>
                </CardTitle>
                <CardDescription className="mt-1.5">
                  {engine === 'CODEX' ? (
                    <>
                      Every source below is optional and combinable — pick any mix, or just write a prompt with none
                      selected. Produces a mix of narrow, pure-functionality test cases and full end-to-end journeys,
                      the way a senior QA engineer would cover this application.
                    </>
                  ) : (
                    <>
                      AI reads what the Scanner found and what the Knowledge Base already knows about{' '}
                      {selectedApplication.name} — either is enough on its own — and proposes realistic test cases,
                      then immediately drafts an automation flow for each one, so you only review the result.
                    </>
                  )}
                </CardDescription>
              </div>
              {showCodexSection ? (
                <div className="flex items-center gap-1 rounded-md border p-0.5">
                  <Button
                    type="button"
                    size="sm"
                    variant={engine === 'LOCAL' ? 'secondary' : 'ghost'}
                    className="h-7 px-2.5"
                    onClick={() => setEngine('LOCAL')}
                  >
                    Local AI
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={engine === 'CODEX' ? 'secondary' : 'ghost'}
                    className="h-7 px-2.5"
                    onClick={() => setEngine('CODEX')}
                  >
                    <Bot className="mr-1.5 h-3.5 w-3.5" />
                    Codex
                  </Button>
                </div>
              ) : null}
            </div>

            {engine === 'CODEX' ? (
              <>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={codexIncludeKb}
                      onCheckedChange={(v) => setCodexIncludeKb(!!v)}
                      disabled={!hasProcessedKnowledge}
                    />
                    Include Knowledge Base
                    {!hasProcessedKnowledge ? <span className="text-xs text-muted-foreground">(none processed yet)</span> : null}
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={codexIncludeZephyr}
                      onCheckedChange={(v) => setCodexIncludeZephyr(!!v)}
                      disabled={!hasZephyrIntegration}
                    />
                    Include Zephyr test cases
                    {!hasZephyrIntegration ? <span className="text-xs text-muted-foreground">(no Zephyr connection)</span> : null}
                  </label>
                </div>

                <div className="flex flex-col gap-2">
                  <Label>Include Jira story (optional)</Label>
                  <Select value={codexJiraStoryImportId} onValueChange={(v) => setCodexJiraStoryImportId(v ?? '__none__')}>
                    <SelectTrigger className="w-full sm:w-80">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">None</SelectItem>
                      {jiraImports.map((imp) => (
                        <SelectItem key={imp.id} value={imp.id}>
                          {imp.issueKey} — {imp.status}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {jiraImports.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No stories imported yet — import one from the Knowledge Base page.</p>
                  ) : null}
                </div>

                <div className="flex flex-col gap-2">
                  <Label htmlFor="codex-prompt">Additional instructions (optional)</Label>
                  <Textarea
                    id="codex-prompt"
                    placeholder="e.g. focus on the password reset flow, including what happens when the reset link has expired"
                    value={codexUserPrompt}
                    onChange={(e) => setCodexUserPrompt(e.target.value)}
                    rows={3}
                  />
                </div>
              </>
            ) : null}

            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-2">
                <Label htmlFor="ai-count">How many</Label>
                <Input
                  id="ai-count"
                  type="number"
                  min={1}
                  max={20}
                  className="w-24"
                  value={engine === 'CODEX' ? codexCount : aiCount}
                  onChange={(e) =>
                    engine === 'CODEX'
                      ? setCodexCount(Number(e.target.value) || 1)
                      : setAiCount(Number(e.target.value) || 1)
                  }
                />
              </div>
              {engine === 'LOCAL' ? (
                <div className="flex flex-1 min-w-48 flex-col gap-2">
                  <Label htmlFor="ai-focus">Focus area (optional)</Label>
                  <Input
                    id="ai-focus"
                    placeholder="e.g. password reset flows"
                    value={aiFocus}
                    onChange={(e) => setAiFocus(e.target.value)}
                  />
                </div>
              ) : (
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={codexChainAutomation} onCheckedChange={(v) => setCodexChainAutomation(!!v)} />
                  Auto-build automation (flow → script → review)
                </label>
              )}
              <Button
                disabled={
                  engine === 'CODEX'
                    ? isCodexGenerating || startCodexGenerationMutation.isPending
                    : isGenerating || startGenerationMutation.isPending
                }
                onClick={() =>
                  engine === 'CODEX' ? startCodexGenerationMutation.mutate() : startGenerationMutation.mutate()
                }
              >
                {engine === 'CODEX' ? <Bot className="mr-2 h-4 w-4" /> : <Sparkles className="mr-2 h-4 w-4" />}
                {engine === 'CODEX'
                  ? isCodexGenerating || startCodexGenerationMutation.isPending
                    ? 'Generating…'
                    : 'Generate with Codex'
                  : isGenerating || startGenerationMutation.isPending
                    ? 'Generating…'
                    : 'Generate Test Cases + Automation'}
              </Button>
              {engine === 'LOCAL' && isGenerating ? (
                <Button
                  variant="outline"
                  disabled={cancelGenerationMutation.isPending}
                  onClick={() => cancelGenerationMutation.mutate()}
                >
                  {cancelGenerationMutation.isPending ? 'Cancelling…' : 'Cancel'}
                </Button>
              ) : null}
            </div>

            {engine === 'LOCAL' && isGenerating ? (
              <div className="flex flex-col gap-1.5">
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-all duration-500"
                    style={{
                      width: generationJob
                        ? `${Math.min(100, Math.round((generationJob.completedCount / Math.max(1, generationJob.totalCount)) * 100))}%`
                        : '5%',
                    }}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  {generationJob?.currentStep ?? 'Starting…'}
                  {generationJob ? ` (${generationJob.completedCount}/${generationJob.totalCount})` : ''} — a local AI
                  model does one call per item, so this can take a few minutes.
                </p>
              </div>
            ) : null}

            {engine === 'CODEX' && isCodexGenerating ? (
              <div className="flex flex-col gap-1.5">
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-all duration-500"
                    style={{
                      width: codexJob
                        ? `${Math.min(100, Math.round((codexJob.completedCount / Math.max(1, codexJob.totalCount)) * 100))}%`
                        : '5%',
                    }}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  {codexJob?.currentStep ?? 'Starting…'}
                  {codexJob ? ` (${codexJob.completedCount}/${codexJob.totalCount})` : ''} — each call goes through
                  Codex CLI, so this can take a few minutes.
                </p>
              </div>
            ) : null}

            {engine === 'CODEX' && codexPrompts.length > 0 ? (
              <details className="rounded-md border p-3 text-sm">
                <summary className="cursor-pointer select-none font-medium">
                  Prompts sent to Codex ({codexPrompts.length})
                </summary>
                <div className="mt-3 flex flex-col gap-2">
                  {codexPrompts.map((p) => (
                    <details key={p.id} className="rounded-md border p-3 text-sm">
                      <summary className="cursor-pointer select-none font-medium">
                        {p.stage}
                        {p.label ? ` — ${p.label}` : ''}{' '}
                        <Badge variant={p.succeeded ? 'success' : 'destructive'} className="ml-1">
                          {p.succeeded ? 'succeeded' : 'failed'}
                        </Badge>
                      </summary>
                      <div className="mt-3 flex flex-col gap-3">
                        <div>
                          <p className="text-xs font-medium text-muted-foreground">User prompt (exactly what was sent to Codex)</p>
                          <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 text-xs">{p.userPrompt}</pre>
                        </div>
                        <div>
                          <p className="text-xs font-medium text-muted-foreground">Raw response</p>
                          <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 text-xs">{p.rawResponse ?? '(none)'}</pre>
                        </div>
                      </div>
                    </details>
                  ))}
                </div>
              </details>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {checkedIds.size > 0 ? (
        <Card className="border-primary/30 bg-primary/[0.03]">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-3">
            <p className="text-sm text-muted-foreground">
              {checkedIds.size} test case{checkedIds.size === 1 ? '' : 's'} selected
            </p>
            <div className="flex items-center gap-2">
              {showCodexSection ? (
                <div className="flex items-center gap-1 rounded-md border p-0.5">
                  <Button
                    type="button"
                    size="sm"
                    variant={autoAutomateEngine === 'LOCAL' ? 'secondary' : 'ghost'}
                    className="h-7 px-2.5"
                    onClick={() => setAutoAutomateEngine('LOCAL')}
                  >
                    Local AI
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={autoAutomateEngine === 'CODEX' ? 'secondary' : 'ghost'}
                    className="h-7 px-2.5"
                    onClick={() => setAutoAutomateEngine('CODEX')}
                  >
                    <Bot className="mr-1.5 h-3.5 w-3.5" />
                    Codex
                  </Button>
                </div>
              ) : null}
              <Button
                disabled={isAutoAutomating || startAutoAutomateMutation.isPending}
                onClick={() => startAutoAutomateMutation.mutate()}
              >
                <PlayCircle className="mr-2 h-4 w-4" />
                {isAutoAutomating || startAutoAutomateMutation.isPending ? 'Automating…' : `Automate ${checkedIds.size} Selected`}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {isAutoAutomating ? (
        <Card>
          <CardContent className="flex flex-col gap-1.5 py-3">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all duration-500"
                style={{
                  width: autoAutomateJob
                    ? `${Math.min(100, Math.round((autoAutomateJob.completedCount / Math.max(1, autoAutomateJob.totalCount)) * 100))}%`
                    : '5%',
                }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {autoAutomateJob?.currentStep ?? 'Starting…'}
              {autoAutomateJob ? ` (${autoAutomateJob.completedCount}/${autoAutomateJob.totalCount})` : ''} — this keeps
              running even if you navigate away.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {autoAutomateResult && autoAutomateResult.summary.blocked > 0 ? (
        <Card className="border-destructive/30 bg-destructive/[0.03]">
          <CardContent className="flex flex-col gap-2 py-3 text-sm">
            <div className="flex items-center justify-between">
              <p className="font-medium">
                {autoAutomateResult.summary.blocked} of {autoAutomateResult.summary.total} blocked
              </p>
              <Button size="sm" variant="ghost" onClick={() => setAutoAutomateJobId(null)}>
                Dismiss
              </Button>
            </div>
            {autoAutomateResult.results
              .filter((r) => r.status === 'BLOCKED' || r.status === 'FLOW_GENERATED')
              .map((r) => (
                <div key={r.testCaseId} className="rounded-md border p-2">
                  <p className="font-medium">{r.testCaseTitle}</p>
                  <p className="text-xs text-muted-foreground">{r.reasons.join(' ')}</p>
                </div>
              ))}
          </CardContent>
        </Card>
      ) : null}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : testCases.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-16">
            <SearchDocIllustration />
            <div className="text-center">
              <p className="text-base font-semibold">No test cases yet</p>
              <p className="mt-1 text-sm text-muted-foreground">Create one or import a CSV/Excel file to get started.</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
                <Upload className="mr-2 h-4 w-4" />
                Import CSV/Excel
              </Button>
              <Button onClick={() => setDialogOpen(true)}>New Test Case</Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>
              {testCases.length} test case{testCases.length === 1 ? '' : 's'}
            </span>
            <button
              type="button"
              className="font-medium text-primary hover:underline"
              onClick={toggleAllChecked}
            >
              {checkedIds.size === testCases.length ? 'Clear selection' : 'Select all'}
            </button>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {AUTOMATION_COLUMNS.map((col) => {
              const items = testCases.filter((tc) => tc.automationStatus === col.status);
              return (
                <div key={col.status} className="flex flex-col gap-2">
                  <div className="flex items-center justify-between px-1">
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {col.label}
                    </span>
                    <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground">
                      {items.length}
                    </span>
                  </div>
                  <StaggerContainer className="flex min-h-[80px] flex-col gap-2 rounded-lg bg-muted/40 p-2">
                    {items.length === 0 ? (
                      <p className="px-2 py-3 text-center text-xs text-muted-foreground">No test cases</p>
                    ) : (
                      items.map((tc) => (
                        <StaggerItem key={tc.id}>
                          <TestCaseCard
                            tc={tc}
                            isSelected={selectedTestCaseId === tc.id}
                            isChecked={checkedIds.has(tc.id)}
                            onSelect={() => setSelectedTestCaseId(tc.id)}
                            onToggleChecked={() => toggleChecked(tc.id)}
                            onEdit={() => setEditingTestCaseId(tc.id)}
                            onDelete={() => deleteMutation.mutate(tc.id)}
                          />
                        </StaggerItem>
                      ))
                    )}
                  </StaggerContainer>
                </div>
              );
            })}
          </div>
        </>
      )}

      {selectedTestCaseId && selectedApplication ? (
        <AnalysisPanel testCaseId={selectedTestCaseId} applicationId={selectedApplication.id} />
      ) : null}

      {editingTestCaseId && selectedApplication ? (
        <EditTestCaseDialog
          testCaseId={editingTestCaseId}
          applicationId={selectedApplication.id}
          open={!!editingTestCaseId}
          onOpenChange={(open) => !open && setEditingTestCaseId(null)}
        />
      ) : null}
    </div>
  );
}
