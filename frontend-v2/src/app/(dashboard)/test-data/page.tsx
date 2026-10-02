'use client';

import { ChangeEvent, FormEvent, MouseEvent, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { Bot, Database, Eye, Plus, Sparkles, Trash2, Upload } from 'lucide-react';
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
import { StaggerContainer, StaggerItem } from '@/components/motion/stagger';
import { BrainOrbIllustration } from '@/components/illustrations/glow-illustrations';
import {
  createTestDataItem,
  createTestDataSet,
  deleteTestDataItem,
  deleteTestDataSet,
  generateTestDataSetWithAi,
  generateTestDataSetWithCodex,
  getSupportedPlaceholders,
  getTestDataSet,
  importTestDataItems,
  listTestDataSets,
  resolveTestDataItem,
} from '@/lib/api';
import { useApplicationContext } from '@/lib/application-context';
import { useAuth } from '@/lib/auth-context';
import { isAdmin } from '@/lib/roles';

function blockerMessage(err: unknown, fallback: string) {
  if (isAxiosError(err) && err.response?.data?.reasons?.length) {
    return (err.response.data.reasons as string[]).join(' ');
  }
  return fallback;
}

function ResolvePreviewButton({ itemId }: { itemId: string }) {
  const mutation = useMutation({
    mutationFn: () => resolveTestDataItem(itemId),
    onSuccess: (data) => toast.info(`Resolved: ${data.resolvedValue}`),
    onError: () => toast.error('Failed to resolve'),
  });
  return (
    <Button size="icon" variant="ghost" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
      <Eye className="h-4 w-4" />
    </Button>
  );
}

function DataSetDetail({ setId }: { setId: string }) {
  const queryClient = useQueryClient();
  const [itemDialogOpen, setItemDialogOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: set, isLoading } = useQuery({
    queryKey: ['test-data-set', setId],
    queryFn: () => getTestDataSet(setId),
  });

  const addItemMutation = useMutation({
    mutationFn: (data: { key: string; value: string; isSensitive?: boolean }) => createTestDataItem(setId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['test-data-set', setId] });
      toast.success('Item added');
      setItemDialogOpen(false);
    },
  });

  const deleteItemMutation = useMutation({
    mutationFn: deleteTestDataItem,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['test-data-set', setId] });
    },
  });

  const importMutation = useMutation({
    mutationFn: (file: File) => importTestDataItems(setId, file),
    onSuccess: (result: { imported: number }) => {
      queryClient.invalidateQueries({ queryKey: ['test-data-set', setId] });
      toast.success(`Imported ${result.imported} item(s)`);
    },
    onError: () => toast.error('Import failed'),
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    addItemMutation.mutate({
      key: String(form.get('key') ?? ''),
      value: String(form.get('value') ?? ''),
      isSensitive: form.get('isSensitive') === 'on',
    });
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) importMutation.mutate(file);
    event.target.value = '';
  }

  if (isLoading || !set) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">{set.name} items</CardTitle>
        <div className="flex gap-2">
          <input ref={fileInputRef} type="file" accept=".csv,.json,.xlsx" className="hidden" onChange={handleFileChange} />
          <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()}>
            <Upload className="mr-2 h-4 w-4" />
            Import
          </Button>
          <Dialog open={itemDialogOpen} onOpenChange={setItemDialogOpen}>
            <DialogTrigger render={<Button size="sm" />}>
              <Plus className="mr-2 h-4 w-4" />
              Add item
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add data item</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="key">Key</Label>
                  <Input id="key" name="key" required placeholder="username" />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="value">Value</Label>
                  <Input id="value" name="value" required placeholder="Admin or Automation{{timestamp}}" />
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="isSensitive" className="h-4 w-4" />
                  Sensitive value (e.g. password)
                </label>
                <Button type="submit" disabled={addItemMutation.isPending}>
                  {addItemMutation.isPending ? 'Adding…' : 'Add item'}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Key</TableHead>
              <TableHead>Value</TableHead>
              <TableHead>Source</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <AnimatedTableBody>
            {(set.items ?? []).length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground">
                  No items yet.
                </TableCell>
              </TableRow>
            ) : (
              set.items!.map((item) => (
                <AnimatedTableRow key={item.id}>
                  <TableCell className="font-medium">{item.key}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {item.isSensitive ? '••••••••' : item.value}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{item.importedFrom}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <ResolvePreviewButton itemId={item.id} />
                      <AlertDialog>
                        <AlertDialogTrigger render={<Button size="icon" variant="ghost" />}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete {item.key}?</AlertDialogTitle>
                            <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => deleteItemMutation.mutate(item.id)}>
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
  );
}

export default function TestDataPage() {
  const { selectedApplication } = useApplicationContext();
  const { user } = useAuth();
  const showCodexEngine = isAdmin(user?.role);
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedSetId, setSelectedSetId] = useState<string | null>(null);
  const [aiFocus, setAiFocus] = useState('');
  const [engine, setEngine] = useState<'LOCAL' | 'CODEX'>('LOCAL');

  const { data: sets = [], isLoading } = useQuery({
    queryKey: ['test-data-sets', selectedApplication?.id],
    queryFn: () => listTestDataSets(selectedApplication!.id),
    enabled: !!selectedApplication,
  });

  const { data: placeholders = [] } = useQuery({
    queryKey: ['placeholder-tokens'],
    queryFn: getSupportedPlaceholders,
  });

  const createSetMutation = useMutation({
    mutationFn: (data: { name: string; environment?: string; description?: string }) =>
      createTestDataSet(selectedApplication!.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['test-data-sets', selectedApplication?.id] });
      toast.success('Data set created');
      setDialogOpen(false);
    },
  });

  const deleteSetMutation = useMutation({
    mutationFn: deleteTestDataSet,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['test-data-sets', selectedApplication?.id] });
      if (selectedSetId) setSelectedSetId(null);
    },
  });

  const generateSetMutation = useMutation({
    mutationFn: () =>
      engine === 'CODEX'
        ? generateTestDataSetWithCodex(selectedApplication!.id, { focus: aiFocus || undefined })
        : generateTestDataSetWithAi(selectedApplication!.id, { focus: aiFocus || undefined }),
    onSuccess: (set) => {
      queryClient.invalidateQueries({ queryKey: ['test-data-sets', selectedApplication?.id] });
      toast.success(`${engine === 'CODEX' ? 'Codex' : 'AI'} created "${set.name}" with ${set.items?.length ?? 0} item(s)`);
      setSelectedSetId(set.id);
    },
    onError: (err) =>
      toast.error(blockerMessage(err, `${engine === 'CODEX' ? 'Codex' : 'AI'} test data generation failed`)),
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    createSetMutation.mutate({
      name: String(form.get('name') ?? ''),
      environment: String(form.get('environment') ?? '') || undefined,
      description: String(form.get('description') ?? '') || undefined,
    });
  }

  if (!selectedApplication) {
    return (
      <div>
        <PageHeader title="Test Data" icon={Database} />
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
          title="Test Data"
          icon={Database}
          description={`Reusable, environment-scoped data sets for ${selectedApplication.name}.`}
        />
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger render={<Button />}>
            <Plus className="mr-2 h-4 w-4" />
            New Data Set
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New Test Data Set</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="name">Name</Label>
                <Input id="name" name="name" required placeholder="QA Environment" />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="environment">Environment</Label>
                <Input id="environment" name="environment" placeholder="QA" />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="description">Description</Label>
                <Input id="description" name="description" placeholder="OrangeHRM QA credentials" />
              </div>
              <Button type="submit" disabled={createSetMutation.isPending}>
                {createSetMutation.isPending ? 'Creating…' : 'Create Data Set'}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
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
                  {engine === 'CODEX' ? 'Codex' : 'AI'} reads the scanned input fields for{' '}
                  {selectedApplication.name} (and Knowledge Base rules, if any) and builds a realistic data set —
                  using placeholder tokens for values that must be unique per run.
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
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-1 min-w-48 flex-col gap-2">
                <Label htmlFor="ai-data-focus">Focus (optional)</Label>
                <Input
                  id="ai-data-focus"
                  placeholder="e.g. valid registration data"
                  value={aiFocus}
                  onChange={(e) => setAiFocus(e.target.value)}
                />
              </div>
              <Button disabled={generateSetMutation.isPending} onClick={() => generateSetMutation.mutate()}>
                {engine === 'CODEX' ? <Bot className="mr-2 h-4 w-4" /> : <Sparkles className="mr-2 h-4 w-4" />}
                {generateSetMutation.isPending ? 'Generating…' : 'Generate Data Set'}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-wrap gap-2 p-4 text-xs text-muted-foreground">
          <span className="font-medium">Supported placeholders:</span>
          {placeholders.map((token) => (
            <Badge key={token} variant="outline" className="font-mono">
              {token}
            </Badge>
          ))}
        </CardContent>
      </Card>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : sets.length === 0 ? (
        <p className="text-sm text-muted-foreground">No data sets yet.</p>
      ) : (
        <StaggerContainer className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {sets.map((set) => (
            <StaggerItem key={set.id}>
              <Card
                className={`cursor-pointer p-5 transition-transform hover:-translate-y-0.5 ${selectedSetId === set.id ? 'border-primary' : ''}`}
                onClick={() => setSelectedSetId(set.id)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground">
                      <Database className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{set.name}</p>
                      {set.environment ? (
                        <Badge variant="secondary" className="mt-1">
                          {set.environment}
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                  <AlertDialog>
                    <AlertDialogTrigger
                      render={
                        <Button
                          size="icon"
                          variant="ghost"
                          className="shrink-0"
                          onClick={(e: MouseEvent) => e.stopPropagation()}
                        />
                      }
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </AlertDialogTrigger>
                    <AlertDialogContent onClick={(e) => e.stopPropagation()}>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete {set.name}?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This removes the data set and all {set._count?.items ?? 0} item(s) in it. This cannot be
                          undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => deleteSetMutation.mutate(set.id)}>Delete</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
                {set.description ? (
                  <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">{set.description}</p>
                ) : null}
                <p className="mt-3 text-sm text-muted-foreground">{set._count?.items ?? 0} item(s)</p>
              </Card>
            </StaggerItem>
          ))}
        </StaggerContainer>
      )}

      {selectedSetId ? <DataSetDetail setId={selectedSetId} /> : null}
    </div>
  );
}
