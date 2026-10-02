'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Bot, CheckCircle2, HelpCircle, MousePointerClick, Save, Sparkles, Workflow } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import {
  generateScript,
  generateScriptWithCodex,
  getTestCase,
  listObjectLibrary,
  listTestDataSets,
  updateFlowGraph,
  validateFlow,
} from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { isAdmin } from '@/lib/roles';
import type { AutomationFlow, ObjectRepositoryItem, PaletteItem, TestDataSet } from '@/lib/types';
import { NODE_TYPES, type StepNodeData } from './step-node';
import { StepInspector } from './step-inspector';
import { StepPalette } from './step-palette';
import { TestCaseReferencePanel } from './test-case-reference-panel';

const HELP_STEPS = [
  'Drag a step from the palette on the left and drop it anywhere on the canvas.',
  'Steps run top-to-bottom by their vertical position on the canvas, not by the order you added them — drag a step up or down to reorder it.',
  'Click a step to configure it in the panel on the right: pick the Object it acts on and, if needed, a Test Data value.',
  'If this flow is linked to a test case, follow its steps in the reference panel on the right (visible when no step is selected).',
  'When the flow looks right, click Validate to catch missing objects or data before generating the script.',
];

function HowToBuildAFlow() {
  return (
    <div className="flex flex-col gap-3 text-sm">
      <ol className="list-decimal space-y-2 pl-5">
        {HELP_STEPS.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
    </div>
  );
}

// The canvas only persists objectId/testDataItemId (see updateGraph in the
// backend) — objectName/testDataKey are display-only convenience fields on
// the node's data that must be re-resolved against the live Object
// Library/Test Data every time a flow loads, otherwise every node (AI
// generated or loaded fresh from the DB) shows a blank/stale summary and
// every CLICK step looks visually identical regardless of which object it's
// actually bound to.
function hydrateNode(node: Node, objects: ObjectRepositoryItem[], dataSets: TestDataSet[]): Node {
  const data = node.data as StepNodeData;
  const obj = data.objectId ? objects.find((o) => o.id === data.objectId) : undefined;
  let testDataKey = data.testDataKey;
  if (data.testDataItemId) {
    for (const set of dataSets) {
      const item = (set.items ?? []).find((i) => i.id === data.testDataItemId);
      if (item) {
        testDataKey = `${set.name} / ${item.key}`;
        break;
      }
    }
  }
  return {
    ...node,
    data: {
      ...data,
      objectName: obj ? (obj.displayLabel || obj.objectName) + (obj.screenName ? ` — ${obj.screenName}` : '') : data.objectName,
      testDataKey,
    },
  };
}

function computeChainEdges(nodes: Node[]): Edge[] {
  const sorted = [...nodes].sort((a, b) => a.position.y - b.position.y);
  const edges: Edge[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    edges.push({ id: `${sorted[i].id}->${sorted[i + 1].id}`, source: sorted[i].id, target: sorted[i + 1].id });
  }
  return edges;
}

function initialNodesFromGraph(flow: AutomationFlow): Node[] {
  const rawNodes = (flow.graphJson?.nodes ?? []) as Node[];
  return rawNodes.map((n) => ({ ...n, type: 'step' }));
}

function CanvasInner({
  flow,
  palette,
  applicationId,
  onBack,
}: {
  flow: AutomationFlow;
  palette: PaletteItem[];
  applicationId: string;
  onBack: () => void;
}) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const showCodexEngine = isAdmin(user?.role);
  const [scriptEngine, setScriptEngine] = useState<'LOCAL' | 'CODEX'>('LOCAL');
  const wrapperRef = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition } = useReactFlow();
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(initialNodesFromGraph(flow));
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const { data: objects = [], isSuccess: objectsLoaded } = useQuery({
    queryKey: ['object-library', applicationId],
    queryFn: () => listObjectLibrary(applicationId),
  });
  const { data: dataSets = [], isSuccess: dataSetsLoaded } = useQuery({
    queryKey: ['test-data-sets', applicationId],
    queryFn: () => listTestDataSets(applicationId),
  });
  // The list query that feeds the flow cards doesn't include steps — fetch
  // full detail so the reference panel has something to actually show.
  const { data: linkedTestCase } = useQuery({
    queryKey: ['test-case', flow.testCaseId],
    queryFn: () => getTestCase(flow.testCaseId!),
    enabled: !!flow.testCaseId,
  });
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (hydratedRef.current || !objectsLoaded || !dataSetsLoaded) return;
    hydratedRef.current = true;
    setNodes((nds) => nds.map((n) => hydrateNode(n, objects, dataSets)));
  }, [objectsLoaded, dataSetsLoaded, objects, dataSets, setNodes]);
  const [blockers, setBlockers] = useState<{ blocked: boolean; reasons: string[]; nextActions: string[] } | null>(null);

  const paletteByType = useMemo(
    () => new Map<string, PaletteItem>(palette.map((p) => [p.stepType, p])),
    [palette],
  );
  const edges = useMemo(() => computeChainEdges(nodes), [nodes]);
  const selectedNode = nodes.find((n) => n.id === selectedNodeId);
  // Render-only — step numbers are derived fresh from current Y position on
  // every render (the same ordering computeChainEdges/saveMutation already
  // use), never persisted, so dragging a node instantly renumbers it instead
  // of going stale until the next save.
  const displayNodes = useMemo(() => {
    const orderById = new Map([...nodes].sort((a, b) => a.position.y - b.position.y).map((n, i) => [n.id, i + 1]));
    return nodes.map((n) => ({ ...n, data: { ...n.data, stepOrder: orderById.get(n.id) } }));
  }, [nodes]);

  const saveMutation = useMutation({
    mutationFn: () => {
      const sorted = [...nodes].sort((a, b) => a.position.y - b.position.y);
      return updateFlowGraph(flow.id, {
        nodes: sorted,
        edges: computeChainEdges(sorted),
        viewport: { x: 0, y: 0, zoom: 1 },
      });
    },
    onSuccess: () => {
      toast.success('Flow saved');
      queryClient.invalidateQueries({ queryKey: ['automation-flows', applicationId] });
      setBlockers(null);
    },
    onError: () => toast.error('Failed to save flow'),
  });

  const validateMutation = useMutation({
    mutationFn: async () => {
      await saveMutation.mutateAsync();
      return validateFlow(flow.id);
    },
    onSuccess: (result) => {
      setBlockers(result);
      if (result.blocked) toast.error('Flow has blockers — see details below');
      else toast.success('Flow is valid and ready to generate');
    },
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      await saveMutation.mutateAsync();
      return scriptEngine === 'CODEX' ? generateScriptWithCodex(flow.id) : generateScript(flow.id);
    },
    onSuccess: () => {
      toast.success(
        `${scriptEngine === 'CODEX' ? 'Codex' : 'Script'} generated — view it in Script Generator`,
      );
      setBlockers(null);
    },
    onError: (err: unknown) => {
      const response = (err as { response?: { data?: { blocked?: boolean; reasons?: string[]; nextActions?: string[] } } })
        .response;
      if (response?.data?.blocked) {
        setBlockers({ blocked: true, reasons: response.data.reasons ?? [], nextActions: response.data.nextActions ?? [] });
        toast.error('Generation blocked — see details below');
      } else {
        toast.error(`Failed to generate script${scriptEngine === 'CODEX' ? ' with Codex' : ''}`);
      }
    },
  });

  const onDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const raw = event.dataTransfer.getData('application/testpilot-step');
      if (!raw) return;
      const item: PaletteItem = JSON.parse(raw);
      const bounds = wrapperRef.current!.getBoundingClientRect();
      const position = screenToFlowPosition({ x: event.clientX - bounds.left, y: event.clientY - bounds.top });
      const newNode: Node = {
        id: `node-${Date.now()}`,
        type: 'step',
        position,
        data: {
          stepType: item.stepType,
          stepLabel: item.label,
          requiresObject: item.requiresObject,
          config: {},
        } satisfies StepNodeData,
      };
      setNodes((nds) => nds.concat(newNode));
    },
    [screenToFlowPosition, setNodes],
  );

  function updateSelectedNodeData(patch: Partial<StepNodeData>) {
    if (!selectedNodeId) return;
    setNodes((nds) =>
      nds.map((n) => (n.id === selectedNodeId ? { ...n, data: { ...(n.data as StepNodeData), ...patch } } : n)),
    );
  }

  function deleteSelectedNode() {
    if (!selectedNodeId) return;
    setNodes((nds) => nds.filter((n) => n.id !== selectedNodeId));
    setSelectedNodeId(null);
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col rounded-md border bg-card">
      <div className="flex items-center justify-between border-b px-4 py-2">
        <div className="flex items-center gap-3">
          <Button size="icon" variant="ghost" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <p className="text-sm font-semibold">{flow.name}</p>
            <p className="text-xs text-muted-foreground">{nodes.length} step(s)</p>
          </div>
          <Badge variant="outline">{flow.status}</Badge>
        </div>
        <div className="flex gap-2">
          <Dialog>
            <DialogTrigger render={<Button size="sm" variant="ghost" />}>
              <HelpCircle className="mr-2 h-4 w-4" />
              Help
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>How to build a flow</DialogTitle>
              </DialogHeader>
              <HowToBuildAFlow />
            </DialogContent>
          </Dialog>
          <Button size="sm" variant="outline" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            <Save className="mr-2 h-4 w-4" />
            Save
          </Button>
          <Button size="sm" variant="outline" onClick={() => validateMutation.mutate()} disabled={validateMutation.isPending}>
            <CheckCircle2 className="mr-2 h-4 w-4" />
            Validate
          </Button>
          {showCodexEngine ? (
            <div className="flex items-center gap-1 rounded-md border p-0.5">
              <Button
                type="button"
                size="sm"
                variant={scriptEngine === 'LOCAL' ? 'secondary' : 'ghost'}
                className="h-7 px-2.5"
                onClick={() => setScriptEngine('LOCAL')}
              >
                Deterministic
              </Button>
              <Button
                type="button"
                size="sm"
                variant={scriptEngine === 'CODEX' ? 'secondary' : 'ghost'}
                className="h-7 px-2.5"
                onClick={() => setScriptEngine('CODEX')}
              >
                <Bot className="mr-1.5 h-3.5 w-3.5" />
                Codex
              </Button>
            </div>
          ) : null}
          <Button size="sm" onClick={() => generateMutation.mutate()} disabled={generateMutation.isPending}>
            {scriptEngine === 'CODEX' ? <Bot className="mr-2 h-4 w-4" /> : <Sparkles className="mr-2 h-4 w-4" />}
            {generateMutation.isPending ? 'Generating…' : 'Generate Script'}
          </Button>
        </div>
      </div>

      {blockers?.blocked ? (
        <div className="border-b bg-destructive/10 px-4 py-2 text-sm">
          <p className="font-medium text-destructive">Blocked:</p>
          <ul className="list-disc pl-5 text-destructive">
            {blockers.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          {blockers.nextActions.length > 0 ? (
            <>
              <p className="mt-1 font-medium">Next actions:</p>
              <ul className="list-disc pl-5 text-muted-foreground">
                {blockers.nextActions.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-1 overflow-hidden">
        <div className="w-56 shrink-0 border-r">
          <StepPalette items={palette} />
        </div>
        <div ref={wrapperRef} className="relative flex-1" onDrop={onDrop} onDragOver={(e) => e.preventDefault()}>
          {nodes.length === 0 ? (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-6">
              <div className="pointer-events-auto max-w-sm rounded-lg border bg-card p-5 shadow-sm">
                <div className="mb-2 flex items-center gap-2">
                  <Workflow className="h-4 w-4 text-primary" />
                  <p className="text-sm font-semibold">Build your flow</p>
                </div>
                <p className="mb-3 text-sm text-muted-foreground">
                  This canvas is empty. Start by dragging a step from the palette on the left.
                </p>
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <MousePointerClick className="h-3.5 w-3.5 shrink-0" />
                  Steps run top-to-bottom by position on the canvas, not drop order.
                </p>
              </div>
            </div>
          ) : null}
          <ReactFlow
            nodes={displayNodes}
            edges={edges}
            onNodesChange={onNodesChange}
            nodeTypes={NODE_TYPES}
            onNodeClick={(_, node) => setSelectedNodeId(node.id)}
            onPaneClick={() => setSelectedNodeId(null)}
            fitView
          >
            <Background />
            <Controls />
            <MiniMap pannable zoomable />
          </ReactFlow>
        </div>
        {selectedNode ? (
          <div className="w-72 shrink-0 border-l">
            <StepInspector
              applicationId={applicationId}
              paletteItem={paletteByType.get((selectedNode.data as StepNodeData).stepType)}
              data={selectedNode.data as StepNodeData}
              onChange={updateSelectedNodeData}
              onDelete={deleteSelectedNode}
            />
          </div>
        ) : linkedTestCase ? (
          <div className="w-72 shrink-0 border-l">
            <TestCaseReferencePanel testCase={linkedTestCase} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function AutomationFlowCanvas(props: {
  flow: AutomationFlow;
  palette: PaletteItem[];
  applicationId: string;
  onBack: () => void;
}) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}
