'use client';

import { useQuery } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { listObjectLibrary, listTestDataSets } from '@/lib/api';
import type { PaletteItem } from '@/lib/types';
import type { StepNodeData } from './step-node';

interface StepInspectorProps {
  applicationId: string;
  paletteItem: PaletteItem | undefined;
  data: StepNodeData;
  onChange: (next: Partial<StepNodeData>) => void;
  onDelete: () => void;
}

const NONE_VALUE = '__none__';

// Some apps reuse the same locator on every screen (e.g. a generic
// "iconImage" logo button on every page), so objectName alone can't tell
// three entries apart in this picker — always show the disambiguating
// label (or objectName if none was set) plus the screen it lives on.
function objectPickerLabel(obj: { objectName: string; displayLabel: string | null; screenName: string | null }) {
  const label = obj.displayLabel || obj.objectName;
  return obj.screenName ? `${label} — ${obj.screenName}` : label;
}

export function StepInspector({ applicationId, paletteItem, data, onChange, onDelete }: StepInspectorProps) {
  const { data: objects = [] } = useQuery({
    queryKey: ['object-library', applicationId],
    queryFn: () => listObjectLibrary(applicationId),
    enabled: !!paletteItem?.requiresObject,
  });
  const { data: dataSets = [] } = useQuery({
    queryKey: ['test-data-sets', applicationId],
    queryFn: () => listTestDataSets(applicationId),
    enabled: !!paletteItem?.requiresData,
  });

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{data.stepLabel}</h3>
        <Button size="icon" variant="ghost" onClick={onDelete}>
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </div>

      {paletteItem?.requiresObject ? (
        <div className="flex flex-col gap-2">
          <Label>Object</Label>
          <Select
            value={data.objectId ?? NONE_VALUE}
            onValueChange={(value) => {
              if (!value || value === NONE_VALUE) {
                onChange({ objectId: undefined, objectName: undefined });
                return;
              }
              const obj = objects.find((o) => o.id === value);
              onChange({ objectId: value, objectName: obj?.objectName });
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select object">
                {(value: string | null) => {
                  if (!value || value === NONE_VALUE) return 'Select object';
                  const obj = objects.find((o) => o.id === value);
                  return obj ? objectPickerLabel(obj) : 'Select object';
                }}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE_VALUE}>None</SelectItem>
              {objects.map((obj) => (
                <SelectItem key={obj.id} value={obj.id}>
                  {objectPickerLabel(obj)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {paletteItem?.requiresData ? (
        <div className="flex flex-col gap-2">
          <Label>Test data item</Label>
          <Select
            value={data.testDataItemId ?? NONE_VALUE}
            onValueChange={(value) => {
              if (!value || value === NONE_VALUE) {
                onChange({ testDataItemId: undefined, testDataKey: undefined });
                return;
              }
              for (const set of dataSets) {
                const item = (set.items ?? []).find((i) => i.id === value);
                if (item) {
                  onChange({ testDataItemId: item.id, testDataKey: `${set.name} / ${item.key}` });
                  return;
                }
              }
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select data item">{() => data.testDataKey ?? 'Select data item'}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE_VALUE}>None (use inline value)</SelectItem>
              {dataSets.flatMap((set) =>
                (set.items ?? []).map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {set.name} / {item.key}
                  </SelectItem>
                )),
              )}
            </SelectContent>
          </Select>
          <Label className="mt-2">Or inline value</Label>
          <Input
            value={data.inlineValue ?? ''}
            placeholder="Literal value or {{timestamp}}"
            disabled={!!data.testDataItemId}
            onChange={(e) => onChange({ inlineValue: e.target.value || undefined })}
          />
        </div>
      ) : null}

      {data.stepType === 'OPEN_URL' ? (
        <div className="flex flex-col gap-2">
          <Label>URL</Label>
          <Input
            value={(data.config?.url as string) ?? ''}
            placeholder="https://…"
            onChange={(e) => onChange({ config: { ...data.config, url: e.target.value } })}
          />
        </div>
      ) : null}

      {data.stepType === 'WAIT' ? (
        <div className="flex flex-col gap-2">
          <Label>Duration (ms)</Label>
          <Input
            type="number"
            value={(data.config?.durationMs as number) ?? 1000}
            onChange={(e) => onChange({ config: { ...data.config, durationMs: Number(e.target.value) } })}
          />
        </div>
      ) : null}

      {data.stepType === 'API_CALL' ? (
        <div className="flex flex-col gap-2">
          <Label>Method</Label>
          <Input
            value={(data.config?.method as string) ?? 'GET'}
            onChange={(e) => onChange({ config: { ...data.config, method: e.target.value } })}
          />
          <Label className="mt-2">URL</Label>
          <Input
            value={(data.config?.url as string) ?? ''}
            onChange={(e) => onChange({ config: { ...data.config, url: e.target.value } })}
          />
        </div>
      ) : null}

      {paletteItem?.description ? <p className="text-xs text-muted-foreground">{paletteItem.description}</p> : null}
    </div>
  );
}
