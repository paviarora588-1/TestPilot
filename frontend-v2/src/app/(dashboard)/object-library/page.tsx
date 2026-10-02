'use client';

import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Library, Pencil, Trash2, Wrench } from 'lucide-react';
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
import { PageHeader } from '@/components/layout/page-header';
import { AnimatedTableBody, AnimatedTableRow } from '@/components/motion/animated-table';
import { approveAutoHeal, deleteObject, listAutoHealSuggestions, listObjectLibrary, rejectAutoHeal, updateObject } from '@/lib/api';
import { useApplicationContext } from '@/lib/application-context';
import { useAuth } from '@/lib/auth-context';
import { canApprove } from '@/lib/roles';
import { cn } from '@/lib/utils';
import type { ObjectRepositoryItem, WorkingStatus } from '@/lib/types';

function relativeTime(iso: string | null): string {
  if (!iso) return 'Never';
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

// The Continuous Locator Health Watch's proactive suggestions (createdAt via
// a nightly cron, no executionId) land here — the only frontend surface for
// them, since the Executions page only ever shows suggestions scoped to one
// specific run. Reuses the exact same approveAutoHeal/rejectAutoHeal calls
// and rendering shape as that page, not a reimplementation.
function AutoHealSuggestionsCard({ applicationId }: { applicationId: string }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: suggestions = [] } = useQuery({
    queryKey: ['auto-heal', applicationId],
    queryFn: () => listAutoHealSuggestions(applicationId),
  });

  const decideMutation = useMutation({
    mutationFn: ({ id, approve }: { id: string; approve: boolean }) => (approve ? approveAutoHeal(id) : rejectAutoHeal(id)),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['auto-heal', applicationId] });
      queryClient.invalidateQueries({ queryKey: ['object-library', applicationId] });
      toast.success(vars.approve ? 'Auto-heal applied to Object Library' : 'Suggestion rejected');
    },
    onError: () => toast.error('Failed to record decision'),
  });

  if (suggestions.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Wrench className="h-4 w-4" />
          Auto-heal suggestions
        </CardTitle>
        <CardDescription>
          Locators the continuous quality watch (or a failed run) flagged as no longer resolving, with a
          re-verified replacement to review.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {suggestions.map((s) => (
          <div key={s.id} className="flex flex-col gap-1 rounded-md border p-3 text-sm">
            <p className="font-medium">{s.object?.objectName ?? 'Object'}</p>
            <p>{s.reason}</p>
            <p className="font-mono text-xs text-muted-foreground">
              {s.oldPath} → {s.suggestedPath}
            </p>
            <div className="mt-1 flex items-center gap-2">
              <Badge variant={s.status === 'APPROVED' ? 'success' : s.status === 'REJECTED' ? 'destructive' : 'secondary'}>
                {s.status}
              </Badge>
              {s.autoApproved ? <Badge variant="info">Auto-applied by AI</Badge> : null}
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
            {s.status !== 'PENDING' ? (
              <p className="text-xs text-muted-foreground">
                {s.autoApproved ? 'Applied automatically — no human review' : `Decided by ${s.decidedByName ?? 'System'}`}
                {s.decidedAt ? ` · ${relativeTime(s.decidedAt)}` : ''}
              </p>
            ) : null}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

const STATUS_DOT: Record<WorkingStatus, string> = {
  WORKING: 'bg-emerald-500',
  BROKEN: 'bg-destructive',
  UNKNOWN: 'bg-muted-foreground',
};

const STATUS_BADGE: Record<WorkingStatus, 'success' | 'destructive' | 'secondary'> = {
  WORKING: 'success',
  BROKEN: 'destructive',
  UNKNOWN: 'secondary',
};

function ConfidenceCell({ score }: { score: number | null }) {
  if (score == null) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-14 overflow-hidden rounded-full bg-muted">
        <div
          className={cn('h-full rounded-full', score >= 0.7 ? 'bg-emerald-500' : score >= 0.4 ? 'bg-[#A8660F] dark:bg-[#DBA65B]' : 'bg-destructive')}
          style={{ width: `${Math.round(score * 100)}%` }}
        />
      </div>
      <span className="font-mono text-xs text-muted-foreground">{score.toFixed(2)}</span>
    </div>
  );
}

function EditObjectDialog({ object }: { object: ObjectRepositoryItem }) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (data: Partial<ObjectRepositoryItem>) => updateObject(object.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['object-library', object.applicationId] });
      toast.success('Object updated');
      setOpen(false);
    },
    onError: () => toast.error('Failed to update object'),
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    mutation.mutate({
      objectName: String(form.get('objectName') ?? ''),
      displayLabel: String(form.get('displayLabel') ?? '') || undefined,
      moduleName: String(form.get('moduleName') ?? '') || undefined,
      featureName: String(form.get('featureName') ?? '') || undefined,
      screenName: String(form.get('screenName') ?? '') || undefined,
      technicalPath: String(form.get('technicalPath') ?? ''),
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="icon" variant="ghost" />}>
        <Pencil className="h-4 w-4" />
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit object</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="objectName">Object name</Label>
            <Input id="objectName" name="objectName" defaultValue={object.objectName} required />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="displayLabel">Label (shown in Automation Builder&apos;s object picker)</Label>
            <Input id="displayLabel" name="displayLabel" defaultValue={object.displayLabel ?? ''} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="moduleName">Module</Label>
              <Input id="moduleName" name="moduleName" defaultValue={object.moduleName ?? ''} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="featureName">Feature</Label>
              <Input id="featureName" name="featureName" defaultValue={object.featureName ?? ''} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="screenName">Screen</Label>
              <Input id="screenName" name="screenName" defaultValue={object.screenName ?? ''} />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="technicalPath">Locator</Label>
            <Input id="technicalPath" name="technicalPath" defaultValue={object.technicalPath} className="font-mono text-xs" />
          </div>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? 'Saving…' : 'Save changes'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function ObjectLibraryPage() {
  const { selectedApplication } = useApplicationContext();
  const queryClient = useQueryClient();

  const { data: objects = [], isLoading } = useQuery({
    queryKey: ['object-library', selectedApplication?.id],
    queryFn: () => listObjectLibrary(selectedApplication!.id),
    enabled: !!selectedApplication,
  });

  const deleteMutation = useMutation({
    mutationFn: deleteObject,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['object-library', selectedApplication?.id] });
      toast.success('Object deleted');
    },
    onError: () => toast.error('Failed to delete object'),
  });

  if (!selectedApplication) {
    return (
      <div>
        <PageHeader title="Object Library" icon={Library} />
        <Card>
          <CardContent className="p-6 text-muted-foreground">
            Create an application first, then select it from the switcher in the top bar.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Object Library"
        icon={Library}
        description={`Curated, page-wise object repository for ${selectedApplication.name}.`}
      />
      <AutoHealSuggestionsCard applicationId={selectedApplication.id} />

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Object</TableHead>
                <TableHead>Label</TableHead>
                <TableHead>Screen</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Locator</TableHead>
                <TableHead>Confidence</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last verified</TableHead>
                <TableHead>Usage</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <AnimatedTableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={10} className="text-center text-muted-foreground">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : objects.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="text-center text-muted-foreground">
                    No objects yet. Promote some from the Scanner.
                  </TableCell>
                </TableRow>
              ) : (
                objects.map((obj: ObjectRepositoryItem) => (
                  <AnimatedTableRow key={obj.id}>
                    <TableCell className="font-medium">{obj.objectName}</TableCell>
                    <TableCell>{obj.displayLabel ?? <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {[obj.moduleName, obj.featureName, obj.screenName].filter(Boolean).join(' / ') || '—'}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{obj.objectType}</Badge>
                    </TableCell>
                    <TableCell className="max-w-xs truncate font-mono text-xs">{obj.technicalPath}</TableCell>
                    <TableCell>
                      <ConfidenceCell score={obj.confidenceScore} />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', STATUS_DOT[obj.verificationStatus])} />
                        <Badge variant={STATUS_BADGE[obj.verificationStatus]}>{obj.verificationStatus}</Badge>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{relativeTime(obj.lastValidatedAt)}</TableCell>
                    <TableCell>{obj.usageCount}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <EditObjectDialog object={obj} />
                        <AlertDialog>
                          <AlertDialogTrigger render={<Button size="icon" variant="ghost" />}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete {obj.objectName}?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This cannot be undone. Any automation flows referencing this object will need remapping.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => deleteMutation.mutate(obj.id)}>
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
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
