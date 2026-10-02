'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { Plug, Sparkles, KeyRound, RefreshCw, FileSearch } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PageHeader } from '@/components/layout/page-header';
import { StaggerContainer, StaggerItem } from '@/components/motion/stagger';
import { IntegrationManager } from '@/components/integrations/integration-manager';
import { analyzeJiraStory, listIntegrations } from '@/lib/api';
import { useApplicationContext } from '@/lib/application-context';

const STEPS = [
  {
    icon: KeyRound,
    title: '1. Connect',
    body: 'Save your Zephyr and/or Jira credentials once, below. Zephyr\'s address is fixed — only the project key and token are yours to fill in.',
  },
  {
    icon: RefreshCw,
    title: '2. Import all',
    body: '"Import all from project" pulls every test case (Zephyr) or story (Jira) from your whole project in one go.',
  },
  {
    icon: FileSearch,
    title: '3. Or analyze one story',
    body: 'Have a single Jira story ready, like RP-217? Use the panel at the bottom instead — faster, and AI-drafts categorized test cases just for that story.',
  },
];

function HowThisWorks() {
  return (
    <Card className="border-dashed">
      <CardContent className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-3">
        {STEPS.map((step) => (
          <div key={step.title} className="flex gap-3">
            <step.icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <div>
              <p className="text-sm font-medium">{step.title}</p>
              <p className="text-xs text-muted-foreground">{step.body}</p>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function blockerMessage(err: unknown, fallback: string) {
  if (isAxiosError(err) && err.response?.data?.reasons?.length) {
    return (err.response.data.reasons as string[]).join(' ');
  }
  return fallback;
}

function StoryAnalysisPanel({ applicationId }: { applicationId: string }) {
  const queryClient = useQueryClient();
  const { data: configs = [] } = useQuery({
    queryKey: ['integrations', applicationId],
    queryFn: () => listIntegrations(applicationId),
  });
  const jiraConfigs = configs.filter((c) => c.type === 'JIRA');
  const [configId, setConfigId] = useState<string>('');
  const [issueKey, setIssueKey] = useState('');
  const [count, setCount] = useState(6);
  const [result, setResult] = useState<Awaited<ReturnType<typeof analyzeJiraStory>> | null>(null);

  const activeConfigId = configId || jiraConfigs[0]?.id || '';

  const mutation = useMutation({
    mutationFn: () => analyzeJiraStory(activeConfigId, { issueKey, count }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['test-cases', applicationId] });
      setResult(data);
      toast.success(`AI created ${data.created} test case(s) from ${issueKey}`);
    },
    onError: (err) => toast.error(blockerMessage(err, 'Story analysis failed')),
  });

  if (jiraConfigs.length === 0) {
    return null;
  }

  return (
    <Card className="border-primary/40 bg-gradient-to-br from-primary/[0.07] via-transparent to-transparent dark:shadow-[0_0_0_1px_color-mix(in_oklch,var(--primary)_40%,transparent),0_0_50px_-16px_var(--primary)]">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-4 w-4 text-primary" />
          Analyze one Jira story
          <Badge variant="info" className="ml-1">
            AI
          </Badge>
        </CardTitle>
        <CardDescription>
          Using the Jira connection above — type a single story&apos;s key (e.g. the RP in RP-217) and AI reads its
          description and acceptance criteria, identifies impacted modules and risk areas, and drafts categorized
          test cases (positive/negative/boundary/UI/integration/regression/smoke) with an automation-candidate
          recommendation for each. For your whole project at once, use &quot;Import all from project&quot; above instead.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-3">
          {jiraConfigs.length > 1 ? (
            <div className="flex flex-col gap-2">
              <Label>Jira connection</Label>
              <Select value={activeConfigId} onValueChange={(v) => v && setConfigId(v)}>
                <SelectTrigger className="w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {jiraConfigs.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.baseUrl}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          <div className="flex flex-col gap-2">
            <Label htmlFor="issue-key">Story key</Label>
            <Input
              id="issue-key"
              placeholder="e.g. RP-217"
              className="w-40"
              value={issueKey}
              onChange={(e) => setIssueKey(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="story-count">Test cases to draft</Label>
            <Input
              id="story-count"
              type="number"
              min={1}
              max={15}
              className="w-24"
              value={count}
              onChange={(e) => setCount(Number(e.target.value) || 1)}
            />
          </div>
          <Button disabled={!issueKey || mutation.isPending} onClick={() => mutation.mutate()}>
            <Sparkles className="mr-2 h-4 w-4" />
            {mutation.isPending ? 'Analyzing…' : 'Analyze Story'}
          </Button>
        </div>

        {result ? (
          <div className="flex flex-col gap-3 border-t pt-3">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>Analyzed:</span>
              <Badge variant="outline">{result.issue.labels.length} label(s)</Badge>
              <Badge variant="outline">{result.issue.components.length} component(s)</Badge>
              <Badge variant="outline">{result.contextGathered.commentsAnalyzed} comment(s)</Badge>
              <Badge variant="outline">{result.contextGathered.attachmentsAnalyzed} attachment(s)</Badge>
              {result.issue.priority ? <Badge variant="outline">Priority: {result.issue.priority}</Badge> : null}
              {result.issue.status ? <Badge variant="outline">Status: {result.issue.status}</Badge> : null}
              {result.storyAnalysis.changeType ? <Badge variant="info">{result.storyAnalysis.changeType.replace('_', ' ')}</Badge> : null}
            </div>
            {result.storyAnalysis.whatIsChanging ? (
              <p className="text-sm italic text-muted-foreground">&quot;{result.storyAnalysis.whatIsChanging}&quot;</p>
            ) : null}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <p className="text-xs font-medium text-muted-foreground">Impacted modules</p>
                <p className="text-sm">{result.storyAnalysis.impactedModules?.join(', ') || '—'}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">Risk areas</p>
                <p className="text-sm">{result.storyAnalysis.riskAreas?.join(', ') || '—'}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">Acceptance criteria</p>
                <p className="text-sm">{result.storyAnalysis.acceptanceCriteria?.join('; ') || '—'}</p>
              </div>
            </div>
            <StaggerContainer className="flex flex-col gap-2">
              {result.testCases.map((tc) => (
                <StaggerItem key={tc.id}>
                  <div className="flex items-center justify-between rounded-md border p-2 text-sm">
                    <span>{tc.title}</span>
                    <div className="flex items-center gap-2">
                      {tc.testType ? <Badge variant="outline">{tc.testType}</Badge> : null}
                      {tc.automationRecommended ? <Badge>Automation recommended</Badge> : null}
                    </div>
                  </div>
                </StaggerItem>
              ))}
            </StaggerContainer>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default function IntegrationsPage() {
  const { selectedApplication } = useApplicationContext();

  if (!selectedApplication) {
    return (
      <div>
        <PageHeader title="Zephyr / Jira Integration" icon={Plug} />
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
        title="Zephyr / Jira Integration"
        icon={Plug}
        description={`Real test case sync with encrypted credentials for ${selectedApplication.name}.`}
      />
      <HowThisWorks />
      <IntegrationManager applicationId={selectedApplication.id} applicationName={selectedApplication.name} />
      <StoryAnalysisPanel applicationId={selectedApplication.id} />
    </div>
  );
}
