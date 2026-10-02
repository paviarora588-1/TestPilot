'use client';

import { FormEvent, useState } from 'react';
import { isAxiosError } from 'axios';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Plus, Sparkles, Trash2, Workflow } from 'lucide-react';
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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PageHeader } from '@/components/layout/page-header';
import { StaggerContainer, StaggerItem } from '@/components/motion/stagger';
import { BrainOrbIllustration } from '@/components/illustrations/glow-illustrations';
import { AutomationFlowCanvas } from '@/components/automation-builder/automation-flow-canvas';
import {
  createAutomationFlow,
  deleteAutomationFlow,
  generateFlowFromTestCase,
  generateFlowFromTestCaseWithCodex,
  getAutomationFlow,
  getPalette,
  listAutomationFlows,
  listTestCases,
} from '@/lib/api';
import { useApplicationContext } from '@/lib/application-context';
import { useAuth } from '@/lib/auth-context';
import { isAdmin } from '@/lib/roles';
import type { AutomationFramework } from '@/lib/types';

function blockerMessage(err: unknown, fallback: string) {
  if (isAxiosError(err) && err.response?.data?.reasons?.length) {
    return (err.response.data.reasons as string[]).join(' ');
  }
  return fallback;
}

export default function AutomationBuilderPage() {
  const { selectedApplication } = useApplicationContext();
  const { user } = useAuth();
  const showCodexEngine = isAdmin(user?.role);
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [openFlowId, setOpenFlowId] = useState<string | null>(null);
  const [manualFramework, setManualFramework] = useState<AutomationFramework>('PLAYWRIGHT');
  const [manualTestCaseId, setManualTestCaseId] = useState<string | null>(null);
  const [aiTestCaseId, setAiTestCaseId] = useState<string | null>(null);
  const [engine, setEngine] = useState<'LOCAL' | 'CODEX'>('LOCAL');

  const { data: flows = [], isLoading } = useQuery({
    queryKey: ['automation-flows', selectedApplication?.id],
    queryFn: () => listAutomationFlows(selectedApplication!.id),
    enabled: !!selectedApplication,
  });

  const { data: testCases = [] } = useQuery({
    queryKey: ['test-cases', selectedApplication?.id],
    queryFn: () => listTestCases(selectedApplication!.id),
    enabled: !!selectedApplication,
  });

  const { data: palette = [] } = useQuery({ queryKey: ['palette'], queryFn: getPalette });

  const { data: openFlow } = useQuery({
    queryKey: ['automation-flow', openFlowId],
    queryFn: () => getAutomationFlow(openFlowId!),
    enabled: !!openFlowId,
  });

  const createMutation = useMutation({
    mutationFn: (data: { name: string; description?: string; testCaseId?: string; framework: AutomationFramework }) =>
      createAutomationFlow(selectedApplication!.id, data),
    onSuccess: (flow) => {
      queryClient.invalidateQueries({ queryKey: ['automation-flows', selectedApplication?.id] });
      toast.success('Flow created');
      setDialogOpen(false);
      setManualTestCaseId(null);
      setOpenFlowId(flow.id);
    },
    onError: () => toast.error('Failed to create flow'),
  });

  const generateMutation = useMutation({
    mutationFn: (testCaseId: string) =>
      engine === 'CODEX'
        ? generateFlowFromTestCaseWithCodex(selectedApplication!.id, testCaseId)
        : generateFlowFromTestCase(selectedApplication!.id, testCaseId),
    onSuccess: (flow) => {
      queryClient.invalidateQueries({ queryKey: ['automation-flows', selectedApplication?.id] });
      toast.success(`${engine === 'CODEX' ? 'Codex' : 'AI'} generated a flow from the test case — review it before generating a script.`);
      if (flow.unmatchedReferences && flow.unmatchedReferences.length > 0) {
        toast.warning(
          `This test case mentions "${flow.unmatchedReferences.join('", "')}" — not found in the Object Library. Scan the screen(s) where these appear so the flow can bind to them.`,
        );
      }
      setOpenFlowId(flow.id);
    },
    onError: (err) => toast.error(blockerMessage(err, `${engine === 'CODEX' ? 'Codex' : 'AI'} flow generation failed`)),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteAutomationFlow,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['automation-flows', selectedApplication?.id] });
      toast.success('Flow deleted');
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    createMutation.mutate({
      name: String(form.get('name') ?? ''),
      description: String(form.get('description') ?? '') || undefined,
      testCaseId: manualTestCaseId ?? undefined,
      framework: manualFramework,
    });
  }

  if (!selectedApplication) {
    return (
      <div>
        <PageHeader title="Automation Builder" icon={Workflow} />
        <Card>
          <CardContent className="p-6 text-muted-foreground">
            Create an application first, then select it from the switcher in the top bar.
          </CardContent>
        </Card>
      </div>
    );
  }

  if (openFlowId && openFlow) {
    return (
      <AutomationFlowCanvas
        flow={openFlow}
        palette={palette}
        applicationId={selectedApplication.id}
        onBack={() => setOpenFlowId(null)}
      />
    );
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <PageHeader
          title="Automation Builder"
          icon={Workflow}
          description={`Flows for ${selectedApplication.name} — AI drafts them from a test case; the canvas below is there to review or fine-tune.`}
        />
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger render={<Button variant="outline" />}>
            <Plus className="mr-2 h-4 w-4" />
            New blank flow (manual)
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New Automation Flow</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="name">Name</Label>
                <Input id="name" name="name" required placeholder="OrangeHRM Login" />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="description">Description</Label>
                <Input id="description" name="description" placeholder="Open URL, enter credentials, login, verify dashboard" />
              </div>
              <div className="flex flex-col gap-2">
                <Label>Framework</Label>
                <Select value={manualFramework} onValueChange={(v) => v && setManualFramework(v as AutomationFramework)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PLAYWRIGHT">Playwright</SelectItem>
                    <SelectItem value="SELENIUM">Selenium (Java)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-2">
                <Label>Link to test case (optional)</Label>
                <Select value={manualTestCaseId ?? '__none'} onValueChange={(v) => setManualTestCaseId(v === '__none' ? null : v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="No test case" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">No test case</SelectItem>
                    {testCases.map((tc) => (
                      <SelectItem key={tc.id} value={tc.id} label={tc.title}>
                        {tc.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? 'Creating…' : 'Create Flow'}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="mb-6 border-primary/40 bg-gradient-to-br from-primary/[0.07] via-transparent to-transparent dark:shadow-[0_0_0_1px_color-mix(in_oklch,var(--primary)_40%,transparent),0_0_50px_-16px_var(--primary)]">
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
                  Pick a test case — {engine === 'CODEX' ? 'Codex' : 'AI'} reads its steps, the Object Library, Test
                  Data, and any Knowledge Base context, and drafts the flow for you.
                </CardDescription>
              </div>
              {showCodexEngine ? (
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
            <div className="flex flex-wrap items-center gap-2">
              <Select value={aiTestCaseId ?? ''} onValueChange={(v) => setAiTestCaseId(v || null)}>
                <SelectTrigger className="w-72">
                  <SelectValue placeholder="Select a test case…" />
                </SelectTrigger>
                <SelectContent>
                  {testCases.length === 0 ? (
                    <SelectItem value="__none" disabled>
                      No test cases yet
                    </SelectItem>
                  ) : (
                    testCases.map((tc) => (
                      <SelectItem key={tc.id} value={tc.id} label={tc.title}>
                        {tc.title}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              <Button
                disabled={!aiTestCaseId || generateMutation.isPending}
                onClick={() => aiTestCaseId && generateMutation.mutate(aiTestCaseId)}
              >
                {engine === 'CODEX' ? <Bot className="mr-2 h-4 w-4" /> : <Sparkles className="mr-2 h-4 w-4" />}
                {generateMutation.isPending ? 'Generating…' : 'Generate Flow'}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : flows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No flows yet. Create one to get started.</p>
      ) : (
        <StaggerContainer className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {flows.map((flow) => (
            <StaggerItem key={flow.id}>
              <Card className="cursor-pointer" onClick={() => setOpenFlowId(flow.id)}>
                <CardHeader className="flex flex-row items-start justify-between pb-2">
                  <CardTitle className="text-base">{flow.name}</CardTitle>
                  <AlertDialog>
                    <AlertDialogTrigger
                      render={<Button size="icon" variant="ghost" onClick={(e) => e.stopPropagation()} />}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </AlertDialogTrigger>
                    <AlertDialogContent onClick={(e) => e.stopPropagation()}>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete {flow.name}?</AlertDialogTitle>
                        <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => deleteMutation.mutate(flow.id)}>Delete</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </CardHeader>
                <CardContent>
                  <p className="mb-2 text-sm text-muted-foreground">{flow.description || 'No description'}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={flow.status === 'DRAFT' ? 'secondary' : 'success'}>{flow.status}</Badge>
                    <Badge variant="outline">{flow.framework === 'SELENIUM' ? 'Selenium' : 'Playwright'}</Badge>
                    {flow.testCaseId ? (
                      <Badge variant="info">
                        {testCases.find((tc) => tc.id === flow.testCaseId)?.title ?? 'Linked test case'}
                      </Badge>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            </StaggerItem>
          ))}
        </StaggerContainer>
      )}
    </div>
  );
}
