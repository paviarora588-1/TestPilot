'use client';

import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { AppWindow, Globe, Layers, Pencil, Plus, Server, Smartphone, Trash2, Webhook, type LucideIcon } from 'lucide-react';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { PageHeader } from '@/components/layout/page-header';
import { createApplication, deleteApplication, listApplications, listObjectLibrary, listTestCases, updateApplication } from '@/lib/api';
import type { Application, ApplicationType, AutomationFramework } from '@/lib/types';

const APP_TYPES: ApplicationType[] = ['WEB', 'SAP_GUI', 'HYBRID', 'API', 'DESKTOP', 'MOBILE'];
const FRAMEWORKS: AutomationFramework[] = ['PLAYWRIGHT', 'SELENIUM', 'CYPRESS', 'SAP_VBSCRIPT'];

const EASE = [0.16, 1, 0.3, 1] as const;

const TYPE_ICON: Record<ApplicationType, LucideIcon> = {
  WEB: Globe,
  SAP_GUI: Server,
  HYBRID: Layers,
  API: Webhook,
  DESKTOP: AppWindow,
  MOBILE: Smartphone,
};

function ApplicationCard({ app, index }: { app: Application; index: number }) {
  const queryClient = useQueryClient();
  const TypeIcon = TYPE_ICON[app.appType] ?? AppWindow;
  const [editOpen, setEditOpen] = useState(false);

  const updateMutation = useMutation({
    mutationFn: (data: Partial<Application>) => updateApplication(app.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['applications'] });
      toast.success('Application updated');
      setEditOpen(false);
    },
    onError: (err) => toast.error(errorMessage(err, 'Failed to update application')),
  });

  function handleEditSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    updateMutation.mutate({
      name: String(form.get('name') ?? ''),
      appType: (form.get('appType') as ApplicationType) || undefined,
      entryUrl: String(form.get('entryUrl') ?? '') || undefined,
      entryTransactionCode: String(form.get('entryTransactionCode') ?? '') || undefined,
      defaultFramework: (form.get('defaultFramework') as AutomationFramework) || undefined,
      owner: String(form.get('owner') ?? '') || undefined,
      description: String(form.get('description') ?? '') || undefined,
    });
  }

  // Reuses the same endpoints Object Library / Test Cases already call for
  // this app — just fired once per card here, not a new backend capability.
  const { data: objects = [] } = useQuery({
    queryKey: ['object-library', app.id],
    queryFn: () => listObjectLibrary(app.id),
  });
  const { data: testCases = [] } = useQuery({
    queryKey: ['test-cases', app.id],
    queryFn: () => listTestCases(app.id),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteApplication,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['applications'] });
      toast.success('Application deleted');
    },
    onError: (err) => toast.error(errorMessage(err, 'Failed to delete application')),
  });

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: index * 0.05, ease: EASE }}
    >
      <Card className="flex h-full flex-col gap-4 p-5 transition-transform hover:-translate-y-0.5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground">
              <TypeIcon className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="truncate font-semibold">{app.name}</p>
              <p className="truncate text-xs text-muted-foreground">{app.owner || 'No owner set'}</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Dialog open={editOpen} onOpenChange={setEditOpen}>
              <DialogTrigger render={<Button variant="ghost" size="icon" />}>
                <Pencil className="h-4 w-4" />
              </DialogTrigger>
              <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                  <DialogTitle>Edit {app.name}</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleEditSubmit} className="flex flex-col gap-4">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor={`edit-name-${app.id}`}>Name</Label>
                    <Input id={`edit-name-${app.id}`} name="name" required defaultValue={app.name} />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="flex flex-col gap-2">
                      <Label>Application type</Label>
                      <Select name="appType" defaultValue={app.appType}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {APP_TYPES.map((type) => (
                            <SelectItem key={type} value={type}>
                              {type}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex flex-col gap-2">
                      <Label>Default framework</Label>
                      <Select name="defaultFramework" defaultValue={app.defaultFramework}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {FRAMEWORKS.map((fw) => (
                            <SelectItem key={fw} value={fw}>
                              {fw}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor={`edit-entryUrl-${app.id}`}>Entry URL</Label>
                    <Input id={`edit-entryUrl-${app.id}`} name="entryUrl" defaultValue={app.entryUrl ?? ''} />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor={`edit-entryTransactionCode-${app.id}`}>Entry transaction code (SAP GUI)</Label>
                    <Input
                      id={`edit-entryTransactionCode-${app.id}`}
                      name="entryTransactionCode"
                      placeholder="/n/demo/start"
                      defaultValue={app.entryTransactionCode ?? ''}
                    />
                    <p className="text-xs text-muted-foreground">
                      Auto-run as the first step of every generated flow for SAP GUI/Hybrid apps.
                    </p>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor={`edit-owner-${app.id}`}>Owner</Label>
                    <Input id={`edit-owner-${app.id}`} name="owner" defaultValue={app.owner ?? ''} />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor={`edit-description-${app.id}`}>Description</Label>
                    <Textarea id={`edit-description-${app.id}`} name="description" rows={3} defaultValue={app.description ?? ''} />
                  </div>
                  <Button type="submit" disabled={updateMutation.isPending}>
                    {updateMutation.isPending ? 'Saving…' : 'Save Changes'}
                  </Button>
                </form>
              </DialogContent>
            </Dialog>
            <AlertDialog>
              <AlertDialogTrigger render={<Button variant="ghost" size="icon" />}>
                <Trash2 className="h-4 w-4 text-destructive" />
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete {app.name}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This removes the application and everything scoped to it (scans, object library entries). This
                    cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => deleteMutation.mutate(app.id)}>Delete</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{app.appType}</Badge>
          <Badge variant="outline">{app.defaultFramework}</Badge>
        </div>
        {app.description ? <p className="line-clamp-2 text-sm text-muted-foreground">{app.description}</p> : null}
        {app.entryUrl ? (
          <p className="truncate rounded-md bg-muted px-2.5 py-1.5 font-mono text-xs text-muted-foreground">
            {app.entryUrl}
          </p>
        ) : null}
        {app.entryTransactionCode ? (
          <p className="truncate rounded-md bg-muted px-2.5 py-1.5 font-mono text-xs text-muted-foreground">
            {app.entryTransactionCode}
          </p>
        ) : null}
        <div className="mt-auto flex items-center gap-4 border-t border-border pt-3 text-xs text-muted-foreground">
          <span>
            <span className="font-semibold text-foreground">{objects.length}</span> objects
          </span>
          <span>
            <span className="font-semibold text-foreground">{testCases.length}</span> test case{testCases.length === 1 ? '' : 's'}
          </span>
        </div>
      </Card>
    </motion.div>
  );
}

function errorMessage(err: unknown, fallback: string) {
  if (isAxiosError(err)) {
    const data = err.response?.data;
    // Conflict responses (e.g. duplicate name) use {reasons: string[]}, same
    // shape as blockerMessage() elsewhere in the app — this page's own
    // duplicate-name check used that shape but this helper only read
    // .message, so the user saw a generic "Failed to create application"
    // instead of "An application named X already exists" (confirmed via a
    // real UI run: toast showed the fallback text, not the actual reason).
    if (Array.isArray(data?.reasons) && data.reasons.length) return data.reasons.join(' ');
    if (Array.isArray(data?.message)) return data.message.join(' ');
    if (typeof data?.message === 'string') return data.message;
  }
  return fallback;
}

export default function ApplicationsPage() {
  const queryClient = useQueryClient();
  const { data: applications = [], isLoading } = useQuery({ queryKey: ['applications'], queryFn: listApplications });
  const [dialogOpen, setDialogOpen] = useState(false);

  const createMutation = useMutation({
    mutationFn: createApplication,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['applications'] });
      toast.success('Application created');
      setDialogOpen(false);
    },
    onError: (err) => toast.error(errorMessage(err, 'Failed to create application')),
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    createMutation.mutate({
      name: String(form.get('name') ?? ''),
      appType: (form.get('appType') as ApplicationType) || undefined,
      entryUrl: String(form.get('entryUrl') ?? '') || undefined,
      entryTransactionCode: String(form.get('entryTransactionCode') ?? '') || undefined,
      defaultFramework: (form.get('defaultFramework') as AutomationFramework) || undefined,
      owner: String(form.get('owner') ?? '') || undefined,
      description: String(form.get('description') ?? '') || undefined,
    });
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <PageHeader
          title="Applications"
          icon={AppWindow}
          description="Register applications under test and their automation defaults."
        />
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger render={<Button />}>
            <Plus className="mr-2 h-4 w-4" />
            New Application
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>New Application</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="name">Name</Label>
                <Input id="name" name="name" required placeholder="OrangeHRM" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-2">
                  <Label>Application type</Label>
                  <Select name="appType" defaultValue="WEB">
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {APP_TYPES.map((type) => (
                        <SelectItem key={type} value={type}>
                          {type}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-2">
                  <Label>Default framework</Label>
                  <Select name="defaultFramework" defaultValue="PLAYWRIGHT">
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FRAMEWORKS.map((fw) => (
                        <SelectItem key={fw} value={fw}>
                          {fw}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="entryUrl">Entry URL</Label>
                <Input id="entryUrl" name="entryUrl" placeholder="https://opensource-demo.orangehrmlive.com/web/index.php/auth/login" />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="entryTransactionCode">Entry transaction code (SAP GUI)</Label>
                <Input id="entryTransactionCode" name="entryTransactionCode" placeholder="/n/demo/start" />
                <p className="text-xs text-muted-foreground">
                  For SAP GUI/Hybrid apps — auto-run as the first step of every generated flow, so it doesn&apos;t
                  assume you&apos;re already inside the transaction.
                </p>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="owner">Owner</Label>
                <Input id="owner" name="owner" placeholder="QA Team" />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="description">Description</Label>
                <Textarea id="description" name="description" rows={3} />
              </div>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? 'Creating…' : 'Create Application'}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : applications.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
          No applications yet. Create one to get started.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {applications.map((app: Application, i) => (
            <ApplicationCard key={app.id} app={app} index={i} />
          ))}
        </div>
      )}
    </div>
  );
}
