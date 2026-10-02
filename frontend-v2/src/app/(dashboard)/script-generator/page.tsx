'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileCode2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageHeader } from '@/components/layout/page-header';
import { AnimatedTableBody, AnimatedTableRow } from '@/components/motion/animated-table';
import { getScript, listAutomationFlows, listScriptsForFlow, reviewScript } from '@/lib/api';
import { useApplicationContext } from '@/lib/application-context';

function ScriptDetail({ scriptId }: { scriptId: string }) {
  const queryClient = useQueryClient();
  const [activeFileId, setActiveFileId] = useState<string | null>(null);

  const { data: script, isLoading } = useQuery({
    queryKey: ['script', scriptId],
    queryFn: () => getScript(scriptId),
  });

  const reviewMutation = useMutation({
    mutationFn: () => reviewScript(scriptId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['script', scriptId] });
      toast.success('Review complete');
    },
    onError: () => toast.error('Review failed'),
  });

  if (isLoading || !script) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const activeFile = script.files.find((f) => f.id === activeFileId) ?? script.files[0];
  const review = script.reviewJson;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-base">Generated script</CardTitle>
          <p className="text-xs text-muted-foreground">{script.command}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline">{script.framework}</Badge>
          <Badge variant={script.status === 'REVIEWED' ? 'success' : 'secondary'}>{script.status}</Badge>
          <Button size="sm" variant="outline" onClick={() => reviewMutation.mutate()} disabled={reviewMutation.isPending}>
            <Sparkles className="mr-2 h-4 w-4" />
            {reviewMutation.isPending ? 'Reviewing…' : 'AI Review'}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {review ? (
          <div className="rounded-md border p-3 text-sm">
            {review.aiReviewAvailable ? (
              <>
                {(() => {
                  // approved:false with zero findings contradicts the
                  // review's own scoring contract (a real safety concern
                  // should show up as a finding) — showing a precise-looking
                  // "0%" in that case reads as "safe" when the review itself
                  // says otherwise. Surfaced as "n/a" instead of a number we
                  // don't actually trust.
                  const unreliable = review.approved === false && !review.findings?.length;
                  return (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">Risk score:</span>
                      <Badge
                        variant={
                          unreliable || review.approved === false || (script.riskScore != null && script.riskScore > 0.5)
                            ? 'destructive'
                            : 'success'
                        }
                      >
                        {unreliable ? 'n/a' : script.riskScore != null ? Math.round(script.riskScore * 100) + '%' : 'n/a'}
                      </Badge>
                      <span className="font-medium">Approved:</span>
                      <Badge variant={review.approved ? 'success' : 'destructive'}>{review.approved ? 'Yes' : 'No'}</Badge>
                      {unreliable ? (
                        <span className="text-xs text-muted-foreground">
                          (not approved, but the review gave no specific finding — treat this result as inconclusive)
                        </span>
                      ) : null}
                      <span className="font-medium">Knowledge base context:</span>
                      <Badge variant={review.ragContextUsed ? 'info' : 'outline'}>
                        {review.ragContextUsed ? 'Used' : 'None retrieved'}
                      </Badge>
                    </div>
                  );
                })()}
                {review.findings && review.findings.length > 0 ? (
                  <div className="mt-2">
                    <p className="text-xs font-medium text-destructive">Execution-safety findings</p>
                    <ul className="list-disc pl-5 text-muted-foreground">
                      {review.findings.map((f) => (
                        <li key={f}>{f}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {review.coverageSuggestions && review.coverageSuggestions.length > 0 ? (
                  <div className="mt-2">
                    <p className="text-xs font-medium">Coverage suggestions (informational — doesn&apos;t affect risk)</p>
                    <ul className="list-disc pl-5 text-muted-foreground">
                      {review.coverageSuggestions.map((f) => (
                        <li key={f}>{f}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </>
            ) : (
              <p className="text-muted-foreground">
                AI review unavailable (no local/cloud model reachable). Generation still succeeded — the deterministic
                compiler doesn&apos;t depend on AI. See Settings for provider status.
              </p>
            )}
          </div>
        ) : null}

        <div className="overflow-hidden rounded-md border border-border">
          <div className="border-b border-border bg-muted/60 px-2 pt-2">
            <Tabs value={activeFile?.id} onValueChange={setActiveFileId}>
              <TabsList className="flex-wrap bg-transparent">
                {script.files.map((file) => (
                  <TabsTrigger key={file.id} value={file.id} className="font-mono text-xs">
                    {file.fileName}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>
          {activeFile ? (
            <div className="flex max-h-[500px] overflow-auto bg-[#1B1F27] text-xs">
              <div className="select-none border-r border-white/10 px-3 py-4 text-right font-mono text-[#6D6C67]">
                {activeFile.code.split('\n').map((_, i) => (
                  <div key={i}>{i + 1}</div>
                ))}
              </div>
              <pre className="flex-1 px-4 py-4">
                <code className="font-mono text-[#E9E7DE]">{activeFile.code}</code>
              </pre>
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

export default function ScriptGeneratorPage() {
  const { selectedApplication } = useApplicationContext();
  const [selectedFlowId, setSelectedFlowId] = useState<string | null>(null);
  const [selectedScriptId, setSelectedScriptId] = useState<string | null>(null);

  const { data: flows = [] } = useQuery({
    queryKey: ['automation-flows', selectedApplication?.id],
    queryFn: () => listAutomationFlows(selectedApplication!.id),
    enabled: !!selectedApplication,
  });

  const { data: scripts = [] } = useQuery({
    queryKey: ['flow-scripts', selectedFlowId],
    queryFn: () => listScriptsForFlow(selectedFlowId!),
    enabled: !!selectedFlowId,
  });

  if (!selectedApplication) {
    return (
      <div>
        <PageHeader title="Script Generator" icon={FileCode2} />
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
        title="Script Generator"
        icon={FileCode2}
        description={`Generated Playwright/Selenium/Cypress code for ${selectedApplication.name}.`}
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
                  <AnimatedTableRow
                    key={flow.id}
                    className="cursor-pointer"
                    onClick={() => {
                      setSelectedFlowId(flow.id);
                      setSelectedScriptId(null);
                    }}
                  >
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
          <CardHeader>
            <CardTitle className="text-base">Generation history</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Generated</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Risk</TableHead>
                </TableRow>
              </TableHeader>
              <AnimatedTableBody>
                {scripts.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-muted-foreground">
                      No scripts generated yet for this flow.
                    </TableCell>
                  </TableRow>
                ) : (
                  scripts.map((s) => (
                    <AnimatedTableRow key={s.id} className="cursor-pointer" onClick={() => setSelectedScriptId(s.id)}>
                      <TableCell>{new Date(s.createdAt).toLocaleString()}</TableCell>
                      <TableCell>
                        <Badge variant={s.status === 'REVIEWED' ? 'success' : 'secondary'}>{s.status}</Badge>
                      </TableCell>
                      <TableCell>{s.riskScore != null ? Math.round(s.riskScore * 100) + '%' : '—'}</TableCell>
                    </AnimatedTableRow>
                  ))
                )}
              </AnimatedTableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      {selectedScriptId ? <ScriptDetail scriptId={selectedScriptId} /> : null}
    </div>
  );
}
