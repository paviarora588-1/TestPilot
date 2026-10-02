'use client';

import { ChangeEvent, FormEvent, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { BookOpen, FileCode2, FileText, Trash2, Upload } from 'lucide-react';
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
import { Table, TableCell, TableHead, TableHeader, TableRow, TableBody } from '@/components/ui/table';
import { PageHeader } from '@/components/layout/page-header';
import { StaggerContainer, StaggerItem } from '@/components/motion/stagger';
import {
  createJiraStoryImport,
  deleteKnowledgeSource,
  generateJiraStoryTestCases,
  getJiraStoryImport,
  getKnowledgeSource,
  listIntegrations,
  listJiraStoryImports,
  listKnowledgeSources,
  uploadKnowledgeSource,
} from '@/lib/api';
import { useApplicationContext } from '@/lib/application-context';
import { useAuth } from '@/lib/auth-context';
import { isAdmin } from '@/lib/roles';
import type { JiraStoryImport, JiraStoryPrompt, KnowledgeSourceStatus } from '@/lib/types';

const STATUS_VARIANT: Record<KnowledgeSourceStatus, 'success' | 'secondary' | 'destructive' | 'outline'> = {
  PENDING: 'outline',
  PROCESSING: 'secondary',
  PROCESSED: 'success',
  FAILED: 'destructive',
};

const JIRA_STATUS_VARIANT: Record<JiraStoryImport['status'], 'success' | 'secondary' | 'destructive' | 'outline' | 'info'> = {
  FETCHED: 'outline',
  GENERATING: 'info',
  COMPLETED: 'success',
  FAILED: 'destructive',
};

function jiraErrorMessage(err: unknown, fallback: string) {
  if (isAxiosError(err) && err.response?.data?.reasons?.length) return (err.response.data.reasons as string[]).join(' ');
  if (isAxiosError(err) && typeof err.response?.data?.message === 'string') return err.response.data.message as string;
  return fallback;
}

function JiraPromptDetail({ prompt }: { prompt: JiraStoryPrompt }) {
  return (
    <details className="rounded-md border p-3 text-sm">
      <summary className="cursor-pointer select-none font-medium">
        {prompt.stage}
        {prompt.label ? ` — ${prompt.label}` : ''}{' '}
        <Badge variant={prompt.succeeded ? 'success' : 'destructive'} className="ml-1">
          {prompt.succeeded ? 'succeeded' : 'failed'}
        </Badge>
      </summary>
      <div className="mt-3 flex flex-col gap-3">
        <div>
          <p className="text-xs font-medium text-muted-foreground">System prompt</p>
          <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 text-xs">{prompt.systemPrompt}</pre>
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground">User prompt (exactly what was sent to Codex)</p>
          <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 text-xs">{prompt.userPrompt}</pre>
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground">Raw response</p>
          <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 text-xs">{prompt.rawResponse ?? '(none)'}</pre>
        </div>
      </div>
    </details>
  );
}

function JiraStoryImportsSection({ appId }: { appId: string }) {
  const queryClient = useQueryClient();
  const [selectedImportId, setSelectedImportId] = useState<string | null>(null);
  const [integrationConfigId, setIntegrationConfigId] = useState<string>('');

  const { data: integrations = [] } = useQuery({
    queryKey: ['integrations', appId],
    queryFn: () => listIntegrations(appId),
  });
  const jiraIntegrations = integrations.filter((i) => i.type === 'JIRA');

  const { data: imports = [] } = useQuery({
    queryKey: ['jira-story-imports', appId],
    queryFn: () => listJiraStoryImports(appId),
    refetchInterval: (query) => ((query.state.data ?? []).some((i) => i.status === 'GENERATING') ? 1500 : false),
  });

  const { data: activeImport } = useQuery({
    queryKey: ['jira-story-import', selectedImportId],
    queryFn: () => getJiraStoryImport(selectedImportId!),
    enabled: !!selectedImportId,
    refetchInterval: (query) => (query.state.data?.status === 'GENERATING' ? 1500 : false),
  });

  const createMutation = useMutation({
    mutationFn: (storyUrlOrKey: string) => createJiraStoryImport(appId, { integrationConfigId, storyUrlOrKey }),
    onSuccess: (record) => {
      setSelectedImportId(record.id);
      queryClient.invalidateQueries({ queryKey: ['jira-story-imports', appId] });
      toast.success(record.storyAnalysisJson ? 'Story imported and analyzed' : 'Story imported, but analysis failed — see details below');
    },
    onError: (err) => toast.error(jiraErrorMessage(err, 'Failed to import story')),
  });

  const generateMutation = useMutation({
    mutationFn: (id: string) => generateJiraStoryTestCases(id),
    onSuccess: (record) => {
      queryClient.invalidateQueries({ queryKey: ['jira-story-imports', appId] });
      queryClient.invalidateQueries({ queryKey: ['jira-story-import', record.id] });
      toast.success(record.status === 'COMPLETED' ? 'Test cases generated' : 'Generation finished with no usable test cases — see prompts below');
    },
    onError: (err) => toast.error(jiraErrorMessage(err, 'Failed to generate test cases')),
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const storyUrlOrKey = String(form.get('storyUrlOrKey') ?? '');
    if (storyUrlOrKey && integrationConfigId) createMutation.mutate(storyUrlOrKey);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-2">
        <FileCode2 className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-lg font-semibold">Jira Story Imports</h2>
        <Badge variant="outline">Admin — internal tool</Badge>
      </div>
      <p className="-mt-4 text-sm text-muted-foreground">
        Pull a Jira story, track it in raw form, and optionally include it as one input when generating test cases
        via Codex on the Test Cases page. Not required — test case generation works with or without a linked story.
      </p>

      <Card>
        <CardHeader>
          <CardTitle>Import a story</CardTitle>
          <CardDescription>
            Paste a full story link or just the issue key. The story is fetched and stored in full, then analyzed by
            Codex in one call — the exact prompt and response are kept below, not hidden.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {jiraIntegrations.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No Jira integration connected for this application yet — connect one on the Zephyr / Jira page first.
            </p>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex flex-col gap-2">
                <Label>Jira connection</Label>
                <Select value={integrationConfigId} onValueChange={(value) => setIntegrationConfigId(value ?? '')}>
                  <SelectTrigger className="w-56">
                    <SelectValue placeholder="Choose a connection" />
                  </SelectTrigger>
                  <SelectContent>
                    {jiraIntegrations.map((i) => (
                      <SelectItem key={i.id} value={i.id}>
                        {i.baseUrl} {i.projectKey ? `(${i.projectKey})` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-1 flex-col gap-2">
                <Label>Story link or issue key</Label>
                <Input name="storyUrlOrKey" placeholder=".../browse/PN-217 or PN-217" required />
              </div>
              <Button type="submit" disabled={createMutation.isPending || !integrationConfigId}>
                {createMutation.isPending ? 'Importing…' : 'Import'}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Import history</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Issue</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Imported</TableHead>
                <TableHead className="w-28" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {imports.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground">
                    No imports yet.
                  </TableCell>
                </TableRow>
              ) : (
                imports.map((imp) => (
                  <TableRow key={imp.id} className="cursor-pointer" onClick={() => setSelectedImportId(imp.id)}>
                    <TableCell>{imp.issueKey}</TableCell>
                    <TableCell>
                      <Badge variant={JIRA_STATUS_VARIANT[imp.status]}>{imp.status}</Badge>
                    </TableCell>
                    <TableCell>{new Date(imp.createdAt).toLocaleString()}</TableCell>
                    <TableCell>
                      <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); setSelectedImportId(imp.id); }}>
                        View
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {activeImport ? (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>{activeImport.issueKey}</CardTitle>
              <CardDescription>{activeImport.storyUrl}</CardDescription>
            </div>
            <Badge variant={JIRA_STATUS_VARIANT[activeImport.status]}>{activeImport.status}</Badge>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {activeImport.errorMessage ? <p className="text-sm text-destructive">{activeImport.errorMessage}</p> : null}

            <details className="rounded-md border p-3 text-sm">
              <summary className="cursor-pointer select-none font-medium">Raw fetched content ({activeImport.rawContent.length} chars)</summary>
              <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 text-xs">{activeImport.rawContent}</pre>
            </details>

            {activeImport.storyAnalysisJson ? (
              <div className="rounded-md border p-3 text-sm">
                <p className="font-medium">Story analysis</p>
                <dl className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div>
                    <dt className="text-xs text-muted-foreground">Change type</dt>
                    <dd>{activeImport.storyAnalysisJson.changeType ?? 'n/a'}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">What&apos;s changing</dt>
                    <dd>{activeImport.storyAnalysisJson.whatIsChanging ?? 'n/a'}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Impacted modules</dt>
                    <dd>{(activeImport.storyAnalysisJson.impactedModules ?? []).join(', ') || 'n/a'}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Risk areas</dt>
                    <dd>{(activeImport.storyAnalysisJson.riskAreas ?? []).join(', ') || 'n/a'}</dd>
                  </div>
                </dl>
              </div>
            ) : null}

            <div className="flex gap-3">
              <Button
                onClick={() => generateMutation.mutate(activeImport.id)}
                disabled={generateMutation.isPending || !activeImport.storyAnalysisJson || activeImport.status === 'GENERATING'}
              >
                {generateMutation.isPending || activeImport.status === 'GENERATING' ? 'Generating…' : 'Generate Test Cases'}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              This generates directly from the story alone. To combine it with Knowledge Base content, Zephyr cases,
              or your own instructions, use &quot;Generate with Codex&quot; on the Test Cases page and select this
              story there instead.
            </p>

            {activeImport.prompts && activeImport.prompts.length > 0 ? (
              <div className="flex flex-col gap-2">
                <p className="text-sm font-medium">Prompts sent to Codex ({activeImport.prompts.length})</p>
                {activeImport.prompts.map((p) => (
                  <JiraPromptDetail key={p.id} prompt={p} />
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function SourceDetail({ sourceId }: { sourceId: string }) {
  const { data: source } = useQuery({
    queryKey: ['knowledge-source', sourceId],
    queryFn: () => getKnowledgeSource(sourceId),
    refetchInterval: (query) =>
      query.state.data?.status === 'PENDING' || query.state.data?.status === 'PROCESSING' ? 1500 : false,
  });

  if (!source) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const summary = source.summary;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">{source.fileName}</CardTitle>
        <div className="flex items-center gap-2">
          <Badge variant={STATUS_VARIANT[source.status]}>{source.status}</Badge>
          <span className="text-xs text-muted-foreground">{source.chunkCount} chunk(s)</span>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {source.status === 'FAILED' ? (
          <p className="text-sm text-destructive">{source.errorMessage}</p>
        ) : null}

        {summary ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <p className="text-xs font-medium text-muted-foreground">Modules</p>
              {summary.modules && summary.modules.length > 0 ? (
                <ul className="mt-1 list-disc pl-4 text-sm">
                  {Array.from(new Set(summary.modules)).map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-sm text-muted-foreground">—</p>
              )}
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">Validations</p>
              {summary.validations && summary.validations.length > 0 ? (
                <ul className="mt-1 list-disc pl-4 text-sm">
                  {Array.from(new Set(summary.validations)).map((v) => (
                    <li key={v}>{v}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-sm text-muted-foreground">—</p>
              )}
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">Gaps</p>
              {summary.gaps && summary.gaps.length > 0 ? (
                <ul className="mt-1 list-disc pl-4 text-sm">
                  {Array.from(new Set(summary.gaps)).map((g) => (
                    <li key={g}>{g}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-sm text-muted-foreground">—</p>
              )}
            </div>
          </div>
        ) : null}

        {summary && !summary.aiEnrichmentAvailable ? (
          <p className="text-xs text-muted-foreground">
            AI extraction unavailable (no local/cloud model reachable) — chunks were still indexed for retrieval where
            embeddings are available.
          </p>
        ) : null}

        {source.chunks && source.chunks.length > 0 ? (
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer select-none">Preview first chunks</summary>
            <div className="mt-2 flex flex-col gap-2">
              {source.chunks.map((c) => (
                <pre key={c.id} className="max-h-40 overflow-auto rounded-md bg-muted p-3 whitespace-pre-wrap">
                  {c.content}
                </pre>
              ))}
            </div>
          </details>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default function KnowledgeBasePage() {
  const { selectedApplication } = useApplicationContext();
  const { user } = useAuth();
  const appId = selectedApplication?.id;
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);

  const { data: sources = [] } = useQuery({
    queryKey: ['knowledge-sources', appId],
    queryFn: () => listKnowledgeSources(appId!),
    enabled: !!appId,
    refetchInterval: (query) =>
      (query.state.data ?? []).some((s) => s.status === 'PENDING' || s.status === 'PROCESSING') ? 1500 : false,
  });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => uploadKnowledgeSource(appId!, file),
    onSuccess: (source) => {
      queryClient.invalidateQueries({ queryKey: ['knowledge-sources', appId] });
      setSelectedSourceId(source.id);
      toast.success('Document uploaded — processing started');
    },
    onError: () => toast.error('Upload failed'),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteKnowledgeSource,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['knowledge-sources', appId] });
      setSelectedSourceId(null);
      toast.success('Document removed');
    },
    onError: () => toast.error('Failed to remove document'),
  });

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) uploadMutation.mutate(file);
    event.target.value = '';
  }

  if (!selectedApplication) {
    return (
      <div>
        <PageHeader title="Knowledge Base" icon={BookOpen} />
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
          title="Knowledge Base"
          icon={BookOpen}
          description={`Upload product docs for ${selectedApplication.name} — AI Test Case Generation reads these directly, so you can propose test cases from a requirements doc before the Scanner ever runs.`}
        />
        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.docx,.xlsx,.csv,.txt,.md"
            className="hidden"
            onChange={handleFileChange}
          />
          <Button size="sm" disabled={uploadMutation.isPending} onClick={() => fileInputRef.current?.click()}>
            <Upload className="mr-2 h-4 w-4" />
            {uploadMutation.isPending ? 'Uploading…' : 'Upload document'}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Documents</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {sources.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No documents yet. Upload a PDF, Word doc, Excel sheet, CSV, or text/markdown file describing this
              application.
            </p>
          ) : (
            <StaggerContainer className="flex flex-col gap-2">
              {sources.map((source) => (
                <StaggerItem key={source.id}>
                  <div
                    className="flex cursor-pointer items-center justify-between rounded-md border p-3 transition-colors hover:bg-muted/50"
                    onClick={() => setSelectedSourceId(source.id)}
                  >
                    <div className="flex items-center gap-3">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <p className="text-sm font-medium">{source.fileName}</p>
                        <p className="text-xs text-muted-foreground">
                          {source.chunkCount} chunk(s) · {new Date(source.createdAt).toLocaleString()}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={STATUS_VARIANT[source.status]}>{source.status}</Badge>
                      <AlertDialog>
                        <AlertDialogTrigger
                          render={<Button size="icon" variant="ghost" onClick={(e) => e.stopPropagation()} />}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete {source.fileName}?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This removes the document and its indexed chunks from retrieval.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => deleteMutation.mutate(source.id)}>Delete</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                </StaggerItem>
              ))}
            </StaggerContainer>
          )}
        </CardContent>
      </Card>

      {selectedSourceId ? <SourceDetail sourceId={selectedSourceId} /> : null}

      {isAdmin(user?.role) ? (
        <>
          <div className="border-t pt-6" />
          <JiraStoryImportsSection appId={selectedApplication.id} />
        </>
      ) : null}
    </div>
  );
}
