'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Settings as SettingsIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/layout/page-header';
import { StaggerContainer, StaggerItem } from '@/components/motion/stagger';
import { apiClient } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { useApplicationContext } from '@/lib/application-context';
import { getAutomationPolicy, listAiTasks, runQualityWatchNow, updateAutomationPolicy, type AutomationPolicy } from '@/lib/api';
import { computeAiEngineeringStats } from '@/lib/ai-engineering-stats';
import { canOperate, isAdmin } from '@/lib/roles';
import { cn } from '@/lib/utils';

interface AiHealth {
  provider: string;
  healthy: boolean;
  detail?: string;
}

function Toggle({ checked, disabled, onChange }: { checked: boolean; disabled?: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={onChange}
      className={cn(
        'relative h-[19px] w-[34px] shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-60',
        checked ? 'bg-emerald-500' : 'bg-muted-foreground/30',
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 h-[15px] w-[15px] rounded-full bg-white shadow transition-all',
          checked ? 'left-[17px]' : 'left-0.5',
        )}
      />
    </button>
  );
}

function PolicyField({
  label,
  hint,
  value,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-sm font-semibold">{label}</Label>
      <Input
        type="number"
        min={0}
        max={1}
        step={0.05}
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

function PolicyToggleRow({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  disabled: boolean;
  onChange: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-t border-border py-3 first:border-t-0 first:pt-0">
      <div>
        <p className="text-sm font-semibold">{label}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <Toggle checked={checked} disabled={disabled} onChange={onChange} />
    </div>
  );
}

function AutomationPolicyForm({
  initialPolicy,
  appId,
  canEdit,
  canRunNow,
}: {
  initialPolicy: AutomationPolicy;
  appId: string;
  canEdit: boolean;
  canRunNow: boolean;
}) {
  const [form, setForm] = useState(initialPolicy);
  const queryClient = useQueryClient();

  const saveMutation = useMutation({
    mutationFn: (patch: Partial<AutomationPolicy>) => updateAutomationPolicy(appId, patch),
    onSuccess: (updated) => {
      setForm(updated);
      queryClient.invalidateQueries({ queryKey: ['automation-policy', appId] });
      toast.success('Automation policy saved');
    },
    onError: () => toast.error('Failed to save automation policy'),
  });

  // Same live re-verification as the nightly 3am schedule, just fired right
  // now instead of waiting for it — e.g. right before a regression run.
  // Works even if the toggle above is off or hasn't been saved yet; clicking
  // this is explicit enough intent on its own.
  const runNowMutation = useMutation({
    mutationFn: () => runQualityWatchNow(appId),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['automation-policy', appId] });
      queryClient.invalidateQueries({ queryKey: ['auto-heal', appId] });
      queryClient.invalidateQueries({ queryKey: ['object-library', appId] });
      toast.success(`Checked ${result.checked} object${result.checked === 1 ? '' : 's'} live`);
    },
    onError: () => toast.error('Failed to run quality watch'),
  });

  return (
    <>
      <PolicyField
        label="Minimum mapping confidence"
        hint="Objects below this score are held for manual review."
        value={form.minimumMappingConfidence}
        disabled={!canEdit}
        onChange={(value) => setForm({ ...form, minimumMappingConfidence: value })}
      />
      <PolicyField
        label="Maximum allowed risk score"
        hint="Flows scoring above this are blocked from auto-run."
        value={form.maximumAllowedRiskScore}
        disabled={!canEdit}
        onChange={(value) => setForm({ ...form, maximumAllowedRiskScore: value })}
      />
      <div>
        <PolicyToggleRow
          label="Require AI review pass"
          hint="Block automation until AI review clears"
          checked={form.requireAiReviewPass}
          disabled={!canEdit}
          onChange={() => setForm({ ...form, requireAiReviewPass: !form.requireAiReviewPass })}
        />
        <PolicyToggleRow
          label="Require Knowledge Base processed"
          hint="App must be indexed before scanning"
          checked={form.requireKnowledgeProcessed}
          disabled={!canEdit}
          onChange={() => setForm({ ...form, requireKnowledgeProcessed: !form.requireKnowledgeProcessed })}
        />
        <PolicyToggleRow
          label="Require object verification"
          hint="Locators must be human-confirmed"
          checked={form.requireObjectVerification}
          disabled={!canEdit}
          onChange={() => setForm({ ...form, requireObjectVerification: !form.requireObjectVerification })}
        />
        <PolicyToggleRow
          label="Continuous Locator Health Watch"
          hint="Nightly, re-verifies every locator live and drafts an auto-heal suggestion for broken ones — never applies a fix without approval"
          checked={form.qualityWatchEnabled}
          disabled={!canEdit}
          onChange={() => setForm({ ...form, qualityWatchEnabled: !form.qualityWatchEnabled })}
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Last checked: {form.qualityWatchLastRunAt ? new Date(form.qualityWatchLastRunAt).toLocaleString() : 'Never yet'}
        </p>
        {canRunNow ? (
          <Button size="sm" variant="outline" disabled={runNowMutation.isPending} onClick={() => runNowMutation.mutate()}>
            {runNowMutation.isPending ? 'Checking…' : 'Run now'}
          </Button>
        ) : null}
      </div>
      {!canEdit ? (
        <p className="text-xs text-muted-foreground">Only Admins can change these thresholds.</p>
      ) : (
        <Button
          size="sm"
          className="self-start"
          disabled={saveMutation.isPending}
          onClick={() =>
            saveMutation.mutate({
              minimumMappingConfidence: form.minimumMappingConfidence,
              maximumAllowedRiskScore: form.maximumAllowedRiskScore,
              requireAiReviewPass: form.requireAiReviewPass,
              requireKnowledgeProcessed: form.requireKnowledgeProcessed,
              requireObjectVerification: form.requireObjectVerification,
              qualityWatchEnabled: form.qualityWatchEnabled,
            })
          }
        >
          {saveMutation.isPending ? 'Saving…' : 'Save'}
        </Button>
      )}
    </>
  );
}

function AutomationPolicyCard() {
  const { user } = useAuth();
  const { selectedApplication } = useApplicationContext();
  const appId = selectedApplication?.id;

  const { data: policy, isLoading } = useQuery({
    queryKey: ['automation-policy', appId],
    queryFn: () => getAutomationPolicy(appId!),
    enabled: !!appId,
  });

  if (!appId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Automation Policy</CardTitle>
          <CardDescription>Select an application to configure its thresholds.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const canEdit = isAdmin(user?.role);
  const canRunNow = canOperate(user?.role);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Automation Policy</CardTitle>
        <CardDescription>
          Thresholds for {selectedApplication?.name} — how confident an object match or how safe an AI review must be
          before generation/execution is allowed to proceed.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        {isLoading || !policy ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : (
          <AutomationPolicyForm
            key={`${appId}:${JSON.stringify(policy)}`}
            initialPolicy={policy}
            appId={appId}
            canEdit={canEdit}
            canRunNow={canRunNow}
          />
        )}
      </CardContent>
    </Card>
  );
}

function AiEngineeringSettingsCard() {
  const { data: tasks = [], isLoading } = useQuery({
    // Same query key the AI Engineering page itself uses — cache-shared,
    // not an extra network round trip if both pages are open in a session.
    queryKey: ['ai-tasks'],
    queryFn: listAiTasks,
  });
  const stats = computeAiEngineeringStats(tasks);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <span>AI Engineering</span>
          <Badge variant="outline">Admin — internal tool</Badge>
        </CardTitle>
        <CardDescription>Bugs reported against TestPilot itself, triaged and drafted by Codex CLI</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {isLoading ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : (
          <>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Awaiting your review</span>
              <Badge variant={stats.awaitingReview > 0 ? 'warning' : 'secondary'}>{stats.awaitingReview}</Badge>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Success rate</span>
              <span>{stats.successRatePct !== null ? `${Math.round(stats.successRatePct)}%` : '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Total reports</span>
              <span>{stats.total}</span>
            </div>
          </>
        )}
        <Link href="/ai-engineering" className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-primary hover:underline">
          Open AI Engineering <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </CardContent>
    </Card>
  );
}

export default function SettingsPage() {
  const { user } = useAuth();
  const { data: aiHealth, isLoading } = useQuery({
    queryKey: ['ai-health'],
    queryFn: async () => (await apiClient.get<AiHealth>('/health/ai')).data,
    refetchInterval: 15000,
  });
  const canSeeCodex = isAdmin(user?.role);
  const {
    data: codexHealth,
    isLoading: codexLoading,
    refetch: refetchCodexHealth,
    isFetching: codexChecking,
  } = useQuery({
    queryKey: ['codex-health'],
    queryFn: async () => (await apiClient.get<AiHealth>('/health/codex')).data,
    enabled: canSeeCodex,
    // No refetchInterval — unlike the local AI provider, a real check here
    // is a live `codex exec` round trip (several seconds, uses a Codex
    // call), so it only runs on mount or when explicitly re-checked.
    staleTime: Infinity,
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Settings" icon={SettingsIcon} description="Account and platform configuration." />
      <StaggerContainer className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <StaggerItem>
          <Card>
            <CardHeader>
              <CardTitle>Account</CardTitle>
              <CardDescription>Your TestPilot profile</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Name</span>
                <span>{user?.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Email</span>
                <span>{user?.email}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Role</span>
                <Badge variant="secondary">{user?.role}</Badge>
              </div>
            </CardContent>
          </Card>
        </StaggerItem>

        <StaggerItem>
          <Card>
            <CardHeader>
              <CardTitle>AI Provider</CardTitle>
              <CardDescription>Local/cloud AI backend status</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {isLoading ? (
                <p className="text-muted-foreground">Checking…</p>
              ) : (
                <>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Provider</span>
                    <span>{aiHealth?.provider}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Status</span>
                    <Badge variant={aiHealth?.healthy ? 'success' : 'destructive'}>
                      {aiHealth?.healthy ? 'Healthy' : 'Unreachable'}
                    </Badge>
                  </div>
                  {aiHealth?.detail ? (
                    <p className="text-xs text-muted-foreground">{aiHealth.detail}</p>
                  ) : null}
                </>
              )}
            </CardContent>
          </Card>
        </StaggerItem>

        {canSeeCodex ? (
          <StaggerItem>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between gap-2">
                  <span>Codex CLI</span>
                  <Badge variant="outline">Admin — internal tool</Badge>
                </CardTitle>
                <CardDescription>
                  Connection used by every &quot;Generate with Codex&quot; option across the app
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {codexLoading ? (
                  <p className="text-muted-foreground">Checking…</p>
                ) : (
                  <>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Status</span>
                      <Badge variant={codexHealth?.healthy ? 'success' : 'destructive'}>
                        {codexHealth?.healthy ? 'Linked' : 'Not linked'}
                      </Badge>
                    </div>
                    {codexHealth?.detail ? (
                      <p className="text-xs text-muted-foreground">{codexHealth.detail}</p>
                    ) : null}
                  </>
                )}
                <Button size="sm" variant="outline" disabled={codexChecking} onClick={() => refetchCodexHealth()}>
                  {codexChecking ? 'Verifying…' : 'Verify linking'}
                </Button>
              </CardContent>
            </Card>
          </StaggerItem>
        ) : null}

        {canSeeCodex ? (
          <StaggerItem>
            <AiEngineeringSettingsCard />
          </StaggerItem>
        ) : null}

        <StaggerItem>
          <AutomationPolicyCard />
        </StaggerItem>
      </StaggerContainer>
    </div>
  );
}
