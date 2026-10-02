'use client';

import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { ScanSearch, Trash2 } from 'lucide-react';
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageHeader } from '@/components/layout/page-header';
import { AnimatedTableBody, AnimatedTableRow } from '@/components/motion/animated-table';
import { StaggerContainer, StaggerItem } from '@/components/motion/stagger';
import {
  addUnsafeClickWord,
  assetUrl,
  deleteScanSession,
  getScanSession,
  launchCaptureBrowser,
  listOpenTabs,
  listSapGuiSessions,
  listScanSessions,
  listUnsafeClickWords,
  promoteAllScanObjects,
  promoteManyScanObjects,
  promoteScanObject,
  removeUnsafeClickWord,
  startCurrentPageScan,
  startSapGuiScan,
  startScan,
  type OpenTab,
  type SapGuiOpenSession,
} from '@/lib/api';
import { useApplicationContext } from '@/lib/application-context';
import { useAuth } from '@/lib/auth-context';
import { canApprove } from '@/lib/roles';
import type { ScanObject, ScanStatus } from '@/lib/types';

const STATUS_VARIANT: Record<ScanStatus, 'success' | 'secondary' | 'destructive' | 'outline' | 'info'> = {
  QUEUED: 'outline',
  RUNNING: 'info',
  COMPLETED: 'success',
  FAILED: 'destructive',
};

function blockerMessage(err: unknown, fallback: string) {
  if (isAxiosError(err) && err.response?.data?.reasons?.length) {
    return (err.response.data.reasons as string[]).join(' ');
  }
  return fallback;
}

function errorMessage(err: unknown, fallback: string) {
  if (isAxiosError(err) && typeof err.response?.data?.message === 'string') {
    return err.response.data.message as string;
  }
  return fallback;
}

// The scanner titles a page "{App} — {Tab label}" for anything beyond the
// base screen (see scanner.service.ts's saveScanPage/runScan) — split on
// that same delimiter so Module/Feature/Screen start pre-filled with a
// real, meaningful value instead of forcing the same manual typing for
// every single object promoted off the same page.
function deriveDefaults(pageTitle: string | null | undefined, appName: string) {
  const title = (pageTitle ?? '').trim();
  if (title.includes(' — ')) {
    const [app, screen] = title.split(' — ');
    return { moduleName: app.trim() || appName, featureName: screen.trim(), screenName: screen.trim() };
  }
  const fallback = title || appName;
  return { moduleName: appName, featureName: fallback, screenName: fallback };
}

// Some apps reuse the exact same element id/name on every screen (e.g. a
// generic "iconImage" logo button) — objectName ends up identical across
// screens, which makes the Automation Builder's object picker unusable.
// Prefer the element's own real accessible text if the scan captured any,
// otherwise fall back to "<screen> <type>" so every promoted object gets a
// human-distinguishable label regardless of how generic its locator is.
function deriveLabelDefault(scanObject: ScanObject, screenName: string) {
  const realText = scanObject.buttonText || scanObject.ariaLabel || scanObject.nearbyLabelText || scanObject.placeholder;
  if (realText?.trim()) return realText.trim();
  return screenName ? `${screenName} ${scanObject.objectType}`.trim() : '';
}

function PromoteDialog({
  scanObject,
  pageTitle,
  appName,
  onPromoted,
}: {
  scanObject: ScanObject;
  pageTitle: string | null | undefined;
  appName: string;
  onPromoted: () => void;
}) {
  const [open, setOpen] = useState(false);
  const defaults = deriveDefaults(pageTitle, appName);
  const labelDefault = deriveLabelDefault(scanObject, defaults.screenName);
  const mutation = useMutation({
    mutationFn: (data: {
      objectName: string;
      moduleName?: string;
      featureName?: string;
      screenName?: string;
      displayLabel?: string;
    }) => promoteScanObject(scanObject.id, data),
    onSuccess: () => {
      toast.success('Promoted to Object Library');
      setOpen(false);
      onPromoted();
    },
    onError: () => toast.error('Failed to promote object'),
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    mutation.mutate({
      objectName: String(form.get('objectName') ?? ''),
      moduleName: String(form.get('moduleName') ?? '') || undefined,
      featureName: String(form.get('featureName') ?? '') || undefined,
      screenName: String(form.get('screenName') ?? '') || undefined,
      displayLabel: String(form.get('displayLabel') ?? '') || undefined,
    });
  }

  if (scanObject.promoted) {
    return <Badge variant="secondary">Promoted</Badge>;
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline" />}>Promote</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Promote to Object Library</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="objectName">Object name</Label>
            <Input id="objectName" name="objectName" required defaultValue={scanObject.label ?? ''} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="displayLabel">Label (shown in Automation Builder&apos;s object picker)</Label>
            <Input id="displayLabel" name="displayLabel" defaultValue={labelDefault} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="moduleName">Module</Label>
              <Input id="moduleName" name="moduleName" defaultValue={defaults.moduleName} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="featureName">Feature</Label>
              <Input id="featureName" name="featureName" defaultValue={defaults.featureName} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="screenName">Screen</Label>
              <Input id="screenName" name="screenName" defaultValue={defaults.screenName} />
            </div>
          </div>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? 'Promoting…' : 'Promote'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function ScannerPage() {
  const { selectedApplication } = useApplicationContext();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const [pageSearch, setPageSearch] = useState('');
  const [cdpUrl, setCdpUrl] = useState('');
  const [openTabs, setOpenTabs] = useState<OpenTab[] | null>(null);
  const [sapSessions, setSapSessions] = useState<SapGuiOpenSession[] | null>(null);

  const { data: sessions = [] } = useQuery({
    queryKey: ['scan-sessions', selectedApplication?.id],
    queryFn: () => listScanSessions(selectedApplication!.id),
    enabled: !!selectedApplication,
    refetchInterval: (query) =>
      (query.state.data ?? []).some((s) => s.status === 'RUNNING' || s.status === 'QUEUED') ? 1500 : false,
  });

  const { data: activeSession } = useQuery({
    queryKey: ['scan-session', activeSessionId],
    queryFn: () => getScanSession(activeSessionId!),
    enabled: !!activeSessionId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'RUNNING' || status === 'QUEUED' ? 1500 : false;
    },
  });

  const { data: unsafeClickWords = [] } = useQuery({
    queryKey: ['scan-unsafe-words', selectedApplication?.id],
    queryFn: () => listUnsafeClickWords(selectedApplication!.id),
    enabled: !!selectedApplication,
  });

  const addUnsafeWordMutation = useMutation({
    mutationFn: (word: string) => addUnsafeClickWord(selectedApplication!.id, word),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scan-unsafe-words', selectedApplication?.id] });
      toast.success('Added to the drill-down safety list');
    },
    onError: () => toast.error('Failed to add word'),
  });

  const removeUnsafeWordMutation = useMutation({
    mutationFn: (id: string) => removeUnsafeClickWord(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scan-unsafe-words', selectedApplication?.id] });
    },
    onError: () => toast.error('Failed to remove word'),
  });

  function handleAddUnsafeWord(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const word = String(form.get('unsafeWord') ?? '').trim();
    if (word) addUnsafeWordMutation.mutate(word);
    event.currentTarget.reset();
  }

  const startMutation = useMutation({
    mutationFn: (input: { targetUrl: string; loginUsername?: string; loginPassword?: string }) =>
      startScan(selectedApplication!.id, input.targetUrl, input.loginUsername, input.loginPassword),
    onSuccess: (session) => {
      setActiveSessionId(session.id);
      setActivePageId(null);
      queryClient.invalidateQueries({ queryKey: ['scan-sessions', selectedApplication?.id] });
      toast.success('Scan started');
    },
    onError: () => toast.error('Failed to start scan'),
  });

  const startSapMutation = useMutation({
    mutationFn: (target?: { connectionIndex: number; sessionIndex: number }) =>
      startSapGuiScan(selectedApplication!.id, target?.connectionIndex, target?.sessionIndex),
    onSuccess: (session) => {
      setActiveSessionId(session.id);
      setActivePageId(null);
      queryClient.invalidateQueries({ queryKey: ['scan-sessions', selectedApplication?.id] });
      toast.success('SAP GUI scan started');
    },
    onError: () => toast.error('Failed to start SAP GUI scan'),
  });

  const listSapSessionsMutation = useMutation({
    mutationFn: () => listSapGuiSessions(),
    onSuccess: (found) => {
      setSapSessions(found);
      if (found.length === 0) toast.info('No open SAP GUI sessions found.');
    },
    onError: (err) => toast.error(errorMessage(err, "Couldn't reach SAP GUI — is a session open and scripting enabled?")),
  });

  const startCurrentPageMutation = useMutation({
    mutationFn: (pageIndex?: number) => startCurrentPageScan(selectedApplication!.id, cdpUrl || undefined, pageIndex),
    onSuccess: (session) => {
      setActiveSessionId(session.id);
      setActivePageId(null);
      setOpenTabs(null);
      queryClient.invalidateQueries({ queryKey: ['scan-sessions', selectedApplication?.id] });
      toast.success('Scanning the current browser page…');
    },
    onError: () => toast.error('Failed to start scan'),
  });

  const listTabsMutation = useMutation({
    // Accepts an explicit override so launchBrowserMutation can chain straight
    // into it with the just-launched URL, without waiting on a re-render to
    // see the new cdpUrl state.
    mutationFn: (overrideUrl?: string) => listOpenTabs(overrideUrl ?? cdpUrl ?? undefined),
    onSuccess: (tabs) => {
      setOpenTabs(tabs);
      if (tabs.length === 0) toast.info('No open tabs found in that browser.');
    },
    onError: () => toast.error("Couldn't reach that browser — is it running with remote debugging enabled?"),
  });

  const launchBrowserMutation = useMutation({
    mutationFn: () => launchCaptureBrowser(),
    onSuccess: ({ cdpUrl: launchedUrl }) => {
      setCdpUrl(launchedUrl);
      toast.success('Capture browser is open — pick a tab below.');
      listTabsMutation.mutate(launchedUrl);
    },
    onError: (err) => toast.error(errorMessage(err, 'Failed to open a capture browser.')),
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const targetUrl = String(form.get('targetUrl') ?? '');
    const loginUsername = String(form.get('loginUsername') ?? '') || undefined;
    const loginPassword = String(form.get('loginPassword') ?? '') || undefined;
    if (targetUrl) startMutation.mutate({ targetUrl, loginUsername, loginPassword });
  }

  // A HYBRID app has both a web frontend and a SAP GUI backend, so it needs
  // both scan cards shown at once — these are independent flags, not a
  // single either/or toggle, precisely so HYBRID can satisfy both at once.
  const showSapGuiScan = selectedApplication?.appType === 'SAP_GUI' || selectedApplication?.appType === 'HYBRID';
  const showWebScan = selectedApplication?.appType !== 'SAP_GUI';

  function refreshActive() {
    if (activeSessionId) queryClient.invalidateQueries({ queryKey: ['scan-session', activeSessionId] });
  }

  const promoteAllMutation = useMutation({
    // The synthetic "Common (shared across pages)" tab (id '__common__') has
    // no real ScanPage to promote-all against — its objects were pulled out
    // of several different real pages — so it goes through the by-ids
    // endpoint instead of the page-scoped one.
    mutationFn: (target: { pageId: string; scanObjectIds: string[] }) =>
      target.pageId === '__common__' ? promoteManyScanObjects(target.scanObjectIds) : promoteAllScanObjects(target.pageId),
    onSuccess: (result) => {
      toast.success(result.promoted > 0 ? `Promoted ${result.promoted} object${result.promoted === 1 ? '' : 's'}` : 'Nothing left to promote');
      refreshActive();
    },
    onError: () => toast.error('Failed to promote objects'),
  });

  const deleteSessionMutation = useMutation({
    mutationFn: deleteScanSession,
    onSuccess: (_data, deletedId) => {
      queryClient.invalidateQueries({ queryKey: ['scan-sessions', selectedApplication?.id] });
      if (activeSessionId === deletedId) {
        setActiveSessionId(null);
        setActivePageId(null);
      }
      toast.success('Scan deleted');
    },
    onError: (err) => toast.error(blockerMessage(err, 'Failed to delete scan')),
  });

  if (!selectedApplication) {
    return (
      <div>
        <PageHeader title="Application Scanner" icon={ScanSearch} />
        <Card>
          <CardContent className="p-6 text-muted-foreground">
            Create an application first, then select it from the switcher in the top bar.
          </CardContent>
        </Card>
      </div>
    );
  }

  const realPages = activeSession?.pages ?? [];
  const commonObjects = activeSession?.commonObjects ?? [];
  // Objects that appear identically on 2+ pages (menu bars, toolbars, nav
  // tabs — the same physical control captured again from whichever page was
  // active) are split out server-side into commonObjects rather than
  // repeated on every page. Surfaced here as one extra, synthetic tab
  // ahead of the real pages, rather than folded into any single real page.
  const commonPage =
    commonObjects.length > 0
      ? { id: '__common__', url: '', title: 'Common (shared across pages)', screenshotPath: null, htmlSnapshotPath: null, objects: commonObjects }
      : null;
  const pages = commonPage ? [commonPage, ...realPages] : realPages;
  const page = pages.find((p) => p.id === activePageId) ?? realPages[0] ?? commonPage ?? undefined;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Application Scanner"
        icon={ScanSearch}
        description={`Scan a live page of ${selectedApplication.name} and capture its objects.`}
      />

      {showWebScan ? (
        <Card>
          <CardHeader>
            <CardTitle>Start a scan</CardTitle>
            <CardDescription>Opens a real, visible browser and scans the given URL.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="flex flex-col gap-3">
              <div className="flex gap-3">
                <Input
                  name="targetUrl"
                  placeholder="https://…"
                  defaultValue={selectedApplication.entryUrl ?? ''}
                  required
                  className="flex-1"
                />
                <Button type="submit" disabled={startMutation.isPending}>
                  {startMutation.isPending ? 'Starting…' : 'Start Scan'}
                </Button>
              </div>
              <details className="text-sm text-muted-foreground">
                <summary className="cursor-pointer select-none">Does this app require a login first?</summary>
                <div className="mt-2 flex flex-col gap-2">
                  <p>
                    Provide a test account and the scan will try to sign in automatically before scanning —
                    covers a plain username/password form and a common two-step (identifier, then password)
                    login. Nothing is saved; these are used only for this one scan.
                  </p>
                  <div className="flex gap-3">
                    <Input name="loginUsername" placeholder="Test username" className="flex-1" autoComplete="off" />
                    <Input
                      name="loginPassword"
                      type="password"
                      placeholder="Test password"
                      className="flex-1"
                      autoComplete="off"
                    />
                  </div>
                </div>
              </details>
            </form>

            <details className="mt-3 text-sm text-muted-foreground">
              <summary className="cursor-pointer select-none">
                Drill-down safety list{unsafeClickWords.length > 0 ? ` (${unsafeClickWords.length} custom)` : ''}
              </summary>
              <div className="mt-2 flex flex-col gap-3">
                <p>
                  While exploring beyond tabs and tiles, the scan only auto-clicks a button if its label and id
                  clear a safety check — a built-in list of action words (delete, save, submit, execute, finish,
                  confirm, yes, and similar) is always screened for. That list can&apos;t know this specific
                  app&apos;s own dangerous-action wording in advance — add any of your own below and they&apos;ll be
                  checked the same way, for this application only.
                </p>
                <form onSubmit={handleAddUnsafeWord} className="flex gap-3">
                  <Input
                    name="unsafeWord"
                    placeholder="e.g. Deactivate Permanently"
                    className="flex-1"
                    autoComplete="off"
                  />
                  <Button type="submit" size="sm" variant="outline" disabled={addUnsafeWordMutation.isPending}>
                    {addUnsafeWordMutation.isPending ? 'Adding…' : 'Add'}
                  </Button>
                </form>
                {unsafeClickWords.length > 0 ? (
                  <ul className="flex flex-wrap gap-2">
                    {unsafeClickWords.map((w) => (
                      <li key={w.id}>
                        <Badge variant="secondary" className="gap-1.5 pr-1">
                          {w.word}
                          <button
                            type="button"
                            onClick={() => removeUnsafeWordMutation.mutate(w.id)}
                            aria-label={`Remove "${w.word}" from the drill-down safety list`}
                            className="rounded-sm p-0.5 hover:bg-muted-foreground/20"
                          >
                            <Trash2 className="size-3" />
                          </button>
                        </Badge>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs">No custom words yet for this application — just the built-in list.</p>
                )}
              </div>
            </details>
          </CardContent>
        </Card>
      ) : null}

      {showSapGuiScan ? (
        <Card>
          <CardHeader>
            <CardTitle>Scan a SAP GUI session</CardTitle>
            <CardDescription>
              Attaches to a SAP GUI session already open and logged in on this machine, via the SAP GUI
              Scripting API — read-only, no clicks or navigation beyond switching tabs to capture them. If you
              have more than one SAP GUI window open, list them below and pick which one to scan — otherwise
              just scan the first one directly.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex gap-3">
              <Button onClick={() => startSapMutation.mutate(undefined)} disabled={startSapMutation.isPending}>
                {startSapMutation.isPending ? 'Scanning…' : 'Scan First SAP GUI Session'}
              </Button>
              <Button
                variant="outline"
                onClick={() => listSapSessionsMutation.mutate()}
                disabled={listSapSessionsMutation.isPending}
              >
                {listSapSessionsMutation.isPending ? 'Looking…' : 'List Open SAP GUI Sessions'}
              </Button>
            </div>

            {sapSessions ? (
              sapSessions.length === 0 ? (
                <p className="text-sm text-muted-foreground">No open SAP GUI sessions found.</p>
              ) : (
                <StaggerContainer className="flex flex-col divide-y rounded-md border">
                  {sapSessions.map((s) => (
                    <StaggerItem key={`${s.connectionIndex}-${s.sessionIndex}`}>
                      <div className="flex items-center justify-between gap-3 p-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {s.connectionDescription || `Connection ${s.connectionIndex}`} — {s.systemName}/{s.client}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            User {s.user} · {s.transaction || 'no transaction'}
                            {s.title ? ` — ${s.title}` : ''}
                          </p>
                        </div>
                        <Button
                          size="sm"
                          disabled={startSapMutation.isPending}
                          onClick={() => startSapMutation.mutate({ connectionIndex: s.connectionIndex, sessionIndex: s.sessionIndex })}
                        >
                          Scan This Session
                        </Button>
                      </div>
                    </StaggerItem>
                  ))}
                </StaggerContainer>
              )
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {showWebScan ? (
        <Card>
          <CardHeader>
            <CardTitle>Scan the current browser page</CardTitle>
            <CardDescription>
              Attaches to a page already open in a browser and captures it exactly as-is — no navigation,
              nothing clicked. Use this for a state that&apos;s impractical to reach by scripting a fresh visit: deep
              in a login-gated flow, reached via SSO, a page you just navigated to after submitting a form, etc.
              Click &quot;Open Chrome for Capture&quot; below to launch a dedicated browser window for it, with its
              own separate profile (this works even with your regular Chrome already open — no need to close
              anything). Keep that window dedicated to the app you&apos;re testing so there&apos;s never any
              ambiguity about which tab to capture.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex gap-3">
              <Button onClick={() => launchBrowserMutation.mutate()} disabled={launchBrowserMutation.isPending}>
                {launchBrowserMutation.isPending ? 'Opening…' : 'Open Chrome for Capture'}
              </Button>
            </div>
            <details className="text-sm text-muted-foreground">
              <summary className="cursor-pointer select-none">
                Already have a debug-enabled browser running elsewhere?
              </summary>
              <div className="mt-2 flex flex-col gap-2">
                <p>
                  Point at it directly instead of launching a new one:
                  <br />
                  <code className="mt-1 inline-block rounded bg-muted px-1 py-0.5">
                    chrome.exe --remote-debugging-port=9222 --user-data-dir=%TEMP%\testpilot-chrome-profile
                  </code>
                </p>
                <div className="flex gap-3">
                  <Input
                    value={cdpUrl}
                    onChange={(e) => setCdpUrl(e.target.value)}
                    placeholder="http://127.0.0.1:9222"
                    className="flex-1"
                  />
                  <Button variant="outline" onClick={() => listTabsMutation.mutate(undefined)} disabled={listTabsMutation.isPending}>
                    {listTabsMutation.isPending ? 'Looking…' : 'List Open Tabs'}
                  </Button>
                </div>
              </div>
            </details>

            {openTabs ? (
              openTabs.length === 0 ? (
                <p className="text-sm text-muted-foreground">No open tabs found in that browser.</p>
              ) : (
                <StaggerContainer className="flex flex-col divide-y rounded-md border">
                  {openTabs.map((tab) => (
                    <StaggerItem key={tab.index}>
                      <div className="flex items-center justify-between gap-3 p-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{tab.title || `Tab ${tab.index + 1}`}</p>
                          <p className="truncate text-xs text-muted-foreground">{tab.url}</p>
                        </div>
                        <Button
                          size="sm"
                          disabled={startCurrentPageMutation.isPending}
                          onClick={() => startCurrentPageMutation.mutate(tab.index)}
                        >
                          Scan This Tab
                        </Button>
                      </div>
                    </StaggerItem>
                  ))}
                </StaggerContainer>
              )
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {activeSessionId && activeSession ? (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Scan results</CardTitle>
              <CardDescription>
                {activeSession.targetUrl} — {pages.length} page{pages.length === 1 ? '' : 's'} scanned,{' '}
                {activeSession.objectsFound} object{activeSession.objectsFound === 1 ? '' : 's'} found
              </CardDescription>
            </div>
            <Badge variant={STATUS_VARIANT[activeSession.status]}>{activeSession.status}</Badge>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {activeSession.status === 'FAILED' ? (
              <p className="text-sm text-destructive">{activeSession.errorMessage}</p>
            ) : null}
            {(activeSession.status === 'QUEUED' || activeSession.status === 'RUNNING') ? (
              <p className="text-sm text-muted-foreground">
                Crawling same-origin pages from the entry URL… this updates automatically.
              </p>
            ) : null}
            {pages.length > 1 ? (
              // A tab strip stopped scaling once a real crawl covers dozens
              // of pages — confirmed live: even after fixing the layout
              // itself (see git history), a wall of same-weight pills with
              // long "Screen — Page" labels is still something you have to
              // read top to bottom to find anything in. A searchable,
              // sortable table is the same shape this app already uses for
              // scan history just below — findable by name, and object
              // count is visible before you even click into a page.
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-3">
                  <Input
                    placeholder="Search pages by name…"
                    value={pageSearch}
                    onChange={(e) => setPageSearch(e.target.value)}
                    className="max-w-sm"
                  />
                  <p className="text-xs text-muted-foreground">
                    {pages.length} page{pages.length === 1 ? '' : 's'}
                  </p>
                </div>
                <div className="max-h-72 overflow-y-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Page</TableHead>
                        <TableHead className="text-right">Objects</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pages
                        .map((p, index) => ({ page: p, label: p.title || `Page ${index + 1}` }))
                        .filter(({ label }) => label.toLowerCase().includes(pageSearch.trim().toLowerCase()))
                        // Most-populated pages first — the ones actually worth
                        // looking at — with genuinely empty ones (dead-end
                        // navigation clicks that rendered nothing) sinking to
                        // the bottom instead of sitting at equal weight.
                        .sort((a, b) => b.page.objects.length - a.page.objects.length)
                        .map(({ page: p, label }) => (
                          <TableRow
                            key={p.id}
                            data-state={page?.id === p.id ? 'selected' : undefined}
                            className="cursor-pointer"
                            onClick={() => setActivePageId(p.id)}
                          >
                            <TableCell className="max-w-md truncate" title={label}>
                              {label}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">{p.objects.length}</TableCell>
                          </TableRow>
                        ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            ) : null}
            {page ? (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-[300px_1fr]">
                <div className="col-span-full flex items-center justify-between gap-3">
                  <p className="truncate text-xs text-muted-foreground">{page.url}</p>
                  {page.objects.some((o) => !o.promoted) ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        promoteAllMutation.mutate({
                          pageId: page.id,
                          scanObjectIds: page.objects.filter((o) => !o.promoted).map((o) => o.id),
                        })
                      }
                      disabled={promoteAllMutation.isPending}
                    >
                      {promoteAllMutation.isPending ? 'Promoting…' : 'Promote All'}
                    </Button>
                  ) : null}
                </div>
                {page.screenshotPath ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={assetUrl(page.screenshotPath) ?? undefined}
                    alt={page.title ?? 'Scanned page'}
                    className="w-full rounded-md border"
                  />
                ) : null}
                <div className={`overflow-x-auto ${page.screenshotPath ? '' : 'lg:col-span-2'}`}>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Label</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Locator</TableHead>
                        <TableHead>Confidence</TableHead>
                        <TableHead className="w-28" />
                      </TableRow>
                    </TableHeader>
                    <AnimatedTableBody>
                      {page.objects.map((obj) => (
                        <AnimatedTableRow key={obj.id}>
                          <TableCell>{obj.label ?? <span className="text-muted-foreground">—</span>}</TableCell>
                          <TableCell>
                            <Badge variant="outline">{obj.objectType}</Badge>
                          </TableCell>
                          <TableCell className="max-w-xs truncate font-mono text-xs">
                            {obj.recommendedLocator}
                          </TableCell>
                          <TableCell>{Math.round(obj.confidenceScore * 100)}%</TableCell>
                          <TableCell>
                            <PromoteDialog
                              scanObject={obj}
                              pageTitle={page.title}
                              appName={selectedApplication.name}
                              onPromoted={refreshActive}
                            />
                          </TableCell>
                        </AnimatedTableRow>
                      ))}
                    </AnimatedTableBody>
                  </Table>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Scan history</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>URL</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Objects found</TableHead>
                <TableHead>Started</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <AnimatedTableBody>
              {sessions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    No scans yet.
                  </TableCell>
                </TableRow>
              ) : (
                sessions.map((session) => (
                  <AnimatedTableRow
                    key={session.id}
                    className="cursor-pointer"
                    onClick={() => {
                      setActiveSessionId(session.id);
                      setActivePageId(null);
                    }}
                  >
                    <TableCell className="max-w-sm truncate">{session.targetUrl}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[session.status]}>{session.status}</Badge>
                    </TableCell>
                    <TableCell>{session.objectsFound}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {session.startedAt ? new Date(session.startedAt).toLocaleString() : '—'}
                    </TableCell>
                    <TableCell>
                      {canApprove(user?.role) ? (
                        <AlertDialog>
                          <AlertDialogTrigger
                            render={<Button size="icon" variant="ghost" onClick={(e) => e.stopPropagation()} />}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </AlertDialogTrigger>
                          <AlertDialogContent onClick={(e) => e.stopPropagation()}>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete this scan?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This removes the scan session and its captured pages/screenshots. Any objects already
                                promoted to the Object Library are unaffected. This cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => deleteSessionMutation.mutate(session.id)}>
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      ) : null}
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
