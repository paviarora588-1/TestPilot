'use client';

import { Handle, Position, type NodeProps } from '@xyflow/react';
import { cn } from '@/lib/utils';

export interface StepNodeData extends Record<string, unknown> {
  stepType: string;
  stepLabel: string;
  requiresObject: boolean;
  objectId?: string;
  objectName?: string;
  testDataItemId?: string;
  testDataKey?: string;
  inlineValue?: string;
  config?: Record<string, unknown>;
  // Render-only, computed fresh each render from canvas Y position — see
  // AutomationFlowCanvas's displayNodes. Never persisted.
  stepOrder?: number;
}

// Older generated flows could persist the literal string "null" instead of
// a real empty value (a small local AI model quirk) — treat it the same as
// absent rather than displaying the word "null" on every step that has no
// value, which made every CLICK step look identical regardless of which
// object it was actually bound to.
function cleanDisplayValue(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed.toLowerCase() !== 'null' ? trimmed : null;
}

export function StepNode({ data, selected }: NodeProps) {
  const nodeData = data as StepNodeData;
  const needsObject = nodeData.requiresObject && !nodeData.objectId;
  const summary =
    cleanDisplayValue(nodeData.objectName) ??
    cleanDisplayValue(nodeData.testDataKey) ??
    (nodeData.stepType === 'OPEN_URL' ? cleanDisplayValue(nodeData.config?.url as string) : null) ??
    cleanDisplayValue(nodeData.inlineValue) ??
    null;

  return (
    <div
      className={cn(
        'flex min-w-[200px] items-center gap-2.5 rounded-md border-2 bg-card px-3 py-2 text-card-foreground shadow-sm',
        selected ? 'border-primary' : needsObject ? 'border-destructive' : 'border-border',
      )}
    >
      <Handle type="target" position={Position.Top} className="!bg-muted-foreground" />
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent text-[10px] font-bold text-accent-foreground">
        {nodeData.stepOrder ?? '–'}
      </span>
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{nodeData.stepLabel || nodeData.stepType}</div>
        <div className="truncate text-xs text-muted-foreground">
          {summary ?? (needsObject ? 'Needs an object' : '—')}
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-muted-foreground" />
    </div>
  );
}

export const NODE_TYPES = { step: StepNode };
