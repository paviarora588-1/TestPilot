'use client';

import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plug, RefreshCw, Trash2 } from 'lucide-react';
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
import { Table, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AnimatedTableBody, AnimatedTableRow } from '@/components/motion/animated-table';
import { StaggerContainer, StaggerItem } from '@/components/motion/stagger';
import {
  createIntegration,
  deleteIntegration,
  listIntegrations,
  listIntegrationSyncLogs,
  syncIntegration,
} from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { canApprove, isAdmin } from '@/lib/roles';
import type { IntegrationType, SyncStatus } from '@/lib/types';

const SYNC_STATUS_VARIANT: Record<SyncStatus, 'success' | 'secondary' | 'destructive' | 'outline' | 'info'> = {
  RUNNING: 'info',
  SUCCESS: 'success',
  FAILED: 'destructive',
  PARTIAL: 'outline',
};

const TYPE_LABEL: Record<IntegrationType, string> = { ZEPHYR: 'Zephyr Scale', JIRA: 'Jira Cloud' };

// Zephyr's API base URL is the same for every account on the planet — it's
// not something a user can look up or customize, so asking them to type it
// (with only a placeholder as a hint) was the single biggest source of
// confusion. Locking it in and explaining why removes that question
// entirely. Jira's is genuinely different per company, so it stays a real
// input — the two fields LOOK similar but mean opposite things, which is
// exactly what was confusing.
const ZEPHYR_FIXED_BASE_URL = 'https://api.zephyrscale.smartbear.com/v2';

const FIELD_HELP: Record<IntegrationType, { baseUrl: string; projectKey: string; token: string; email?: string }> = {
  ZEPHYR: {
    baseUrl: 'Fixed — every Zephyr Scale Cloud account uses this same address. Nothing to look up.',
    projectKey: "Your project's key as it appears in Jira (Zephyr Scale test cases live under a Jira project), e.g. RP. This is what scopes requests to YOUR project specifically.",
    token: 'Zephyr Scale → API Access Tokens (top-right menu). Not your Jira password.',
  },
  JIRA: {
    baseUrl: 'Your actual company Jira address — copy it from your browser bar while logged into Jira.',
    projectKey: 'The short project code shown in front of every issue number, e.g. the "RP" in RP-217.',
    token: 'id.atlassian.com → Security → API tokens. Not your Jira password.',
    email: 'The email you log into Jira with — Jira pairs this with the token above to authenticate.',
  },
};

// Zephyr and Jira have different field requirements (Jira needs an account
// email alongside the API token, Zephyr doesn't) — each gets its own fixed-
// type dialog rather than one generic form with a type dropdown, so the
// fields shown always match the tool being configured.
function CreateIntegrationDialog({ applicationId, type }: { applicationId: string; type: IntegrationType }) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const help = FIELD_HELP[type];

  const mutation = useMutation({
    mutationFn: createIntegration.bind(null, applicationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['integrations', applicationId] });
      toast.success(`${TYPE_LABEL[type]} connected`);
      setOpen(false);
    },
    onError: () => toast.error('Failed to save integration — check the base URL and token'),
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    mutation.mutate({
      type,
      baseUrl: String(form.get('baseUrl') ?? ''),
      projectKey: String(form.get('projectKey') ?? '') || undefined,
      apiToken: String(form.get('apiToken') ?? ''),
      email: String(form.get('email') ?? '') || undefined,
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>
        <Plug className="mr-2 h-4 w-4" />
        Connect {TYPE_LABEL[type]}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Connect {TYPE_LABEL[type]}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${type}-baseUrl`}>Base URL</Label>
            {type === 'ZEPHYR' ? (
              <Input id={`${type}-baseUrl`} name="baseUrl" defaultValue={ZEPHYR_FIXED_BASE_URL} readOnly className="bg-muted text-muted-foreground" />
            ) : (
              <Input id={`${type}-baseUrl`} name="baseUrl" placeholder="https://your-company.atlassian.net" required />
            )}
            <p className="text-xs text-muted-foreground">{help.baseUrl}</p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${type}-projectKey`}>Project key</Label>
            <Input id={`${type}-projectKey`} name="projectKey" placeholder="RP" />
            <p className="text-xs text-muted-foreground">{help.projectKey}</p>
          </div>
          {type === 'JIRA' ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${type}-email`}>Account email</Label>
              <Input id={`${type}-email`} name="email" type="email" required />
              <p className="text-xs text-muted-foreground">{help.email}</p>
            </div>
          ) : null}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${type}-apiToken`}>API token</Label>
            <Input id={`${type}-apiToken`} name="apiToken" type="password" required />
            <p className="text-xs text-muted-foreground">{help.token}</p>
          </div>
          <p className="text-xs text-muted-foreground">
            Credentials are encrypted at rest (AES-256-GCM) and never displayed again after saving.
          </p>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? 'Connecting…' : 'Connect'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SyncLogTable({ configId }: { configId: string }) {
  const { data: logs = [] } = useQuery({
    queryKey: ['integration-sync-logs', configId],
    queryFn: () => listIntegrationSyncLogs(configId),
  });

  if (logs.length === 0) {
    return <p className="text-sm text-muted-foreground">No syncs run yet.</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Status</TableHead>
          <TableHead>Items</TableHead>
          <TableHead>Started</TableHead>
          <TableHead>Error</TableHead>
        </TableRow>
      </TableHeader>
      <AnimatedTableBody>
        {logs.map((log) => (
          <AnimatedTableRow key={log.id}>
            <TableCell>
              <Badge variant={SYNC_STATUS_VARIANT[log.status]}>{log.status}</Badge>
            </TableCell>
            <TableCell>{log.itemsProcessed}</TableCell>
            <TableCell className="text-muted-foreground">{new Date(log.startedAt).toLocaleString()}</TableCell>
            <TableCell className="max-w-sm truncate text-xs text-destructive">{log.errorMessage ?? '—'}</TableCell>
          </AnimatedTableRow>
        ))}
      </AnimatedTableBody>
    </Table>
  );
}

// One card per integration type — shows only that type's connected configs,
// with a fixed-type connect dialog. Used for both Zephyr and Jira, mounted
// side by side by IntegrationsSection below.
function IntegrationTypeCard({
  applicationId,
  applicationName,
  type,
  variant = 'full',
}: {
  applicationId: string;
  applicationName: string;
  type: IntegrationType;
  variant?: 'full' | 'compact';
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [expandedConfigId, setExpandedConfigId] = useState<string | null>(null);

  const { data: allConfigs = [] } = useQuery({
    queryKey: ['integrations', applicationId],
    queryFn: () => listIntegrations(applicationId),
  });
  const configs = allConfigs.filter((c) => c.type === type);

  const syncMutation = useMutation({
    mutationFn: syncIntegration,
    onSuccess: (log, configId) => {
      queryClient.invalidateQueries({ queryKey: ['integration-sync-logs', configId] });
      if (log.status === 'SUCCESS') toast.success(`Synced ${log.itemsProcessed} item(s)`);
      else toast.error(log.errorMessage ?? 'Sync failed');
    },
    onError: () => toast.error('Sync failed to start'),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteIntegration,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['integrations', applicationId] });
      toast.success('Integration removed');
    },
    onError: () => toast.error('Failed to remove integration'),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className={variant === 'compact' ? 'text-base' : undefined}>{TYPE_LABEL[type]}</CardTitle>
          <CardDescription>
            {type === 'JIRA'
              ? 'Pull stories into test cases, or push bugs back out.'
              : 'Pull existing Zephyr test cases into TestPilot.'}
          </CardDescription>
        </div>
        {isAdmin(user?.role) ? <CreateIntegrationDialog applicationId={applicationId} type={type} /> : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {configs.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Not connected yet — click <span className="font-medium text-foreground">Connect {TYPE_LABEL[type]}</span> above
            to set up credentials for {applicationName}.
          </p>
        ) : (
          <StaggerContainer className="flex flex-col gap-2">
            {configs.map((config) => (
              <StaggerItem key={config.id}>
                <div className="flex flex-col gap-2 rounded-md border p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-sm font-medium">{config.baseUrl}</span>
                      <p className="text-xs text-muted-foreground">
                        Project: {config.projectKey ?? '—'} · Connected {new Date(config.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {canApprove(user?.role) ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={syncMutation.isPending}
                          onClick={() => {
                            syncMutation.mutate(config.id);
                            setExpandedConfigId(config.id);
                          }}
                          title={`Imports every ${type === 'JIRA' ? 'story' : 'test case'} in project ${config.projectKey ?? '(not set)'} — for a single story instead, use "Analyze a Jira Story" below.`}
                        >
                          <RefreshCw className="mr-2 h-4 w-4" />
                          Import all from project
                        </Button>
                      ) : null}
                      <Button size="sm" variant="ghost" onClick={() => setExpandedConfigId(config.id)}>
                        History
                      </Button>
                      {isAdmin(user?.role) ? (
                        <AlertDialog>
                          <AlertDialogTrigger render={<Button size="icon" variant="ghost" />}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Remove this integration?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This deletes the stored credentials and sync history. Already-imported test cases are kept.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => deleteMutation.mutate(config.id)}>Remove</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      ) : null}
                    </div>
                  </div>
                  {expandedConfigId === config.id ? (
                    <div className="border-t pt-2">
                      <SyncLogTable configId={config.id} />
                    </div>
                  ) : null}
                </div>
              </StaggerItem>
            ))}
          </StaggerContainer>
        )}
      </CardContent>
    </Card>
  );
}

// Shared by both the per-application /integrations operational page and the
// Settings page's platform-configuration view — two clearly separate cards,
// one per tool, since Zephyr and Jira have different fields and are
// configured independently.
export function IntegrationManager({
  applicationId,
  applicationName,
  variant = 'full',
}: {
  applicationId: string;
  applicationName: string;
  variant?: 'full' | 'compact';
}) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <IntegrationTypeCard applicationId={applicationId} applicationName={applicationName} type="ZEPHYR" variant={variant} />
      <IntegrationTypeCard applicationId={applicationId} applicationName={applicationName} type="JIRA" variant={variant} />
    </div>
  );
}
