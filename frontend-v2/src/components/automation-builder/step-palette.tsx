'use client';

import type { DragEvent } from 'react';
import { CheckSquare, Compass, MousePointerClick, Plug, Settings2, type LucideIcon } from 'lucide-react';
import type { PaletteItem } from '@/lib/types';

const CATEGORY_ORDER: PaletteItem['category'][] = ['Navigation', 'Interaction', 'Assertion', 'Control', 'Integration'];

const CATEGORY_ICON: Record<PaletteItem['category'], LucideIcon> = {
  Navigation: Compass,
  Interaction: MousePointerClick,
  Assertion: CheckSquare,
  Control: Settings2,
  Integration: Plug,
};

export function StepPalette({ items }: { items: PaletteItem[] }) {
  function onDragStart(event: DragEvent<HTMLDivElement>, item: PaletteItem) {
    event.dataTransfer.setData('application/testpilot-step', JSON.stringify(item));
    event.dataTransfer.effectAllowed = 'move';
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-3">
      {CATEGORY_ORDER.map((category) => {
        const categoryItems = items.filter((item) => item.category === category);
        if (categoryItems.length === 0) return null;
        const CategoryIcon = CATEGORY_ICON[category];
        return (
          <div key={category}>
            <p className="mb-1.5 flex items-center gap-1.5 px-1 text-xs font-semibold uppercase text-muted-foreground">
              <CategoryIcon className="h-3.5 w-3.5" />
              {category}
            </p>
            <div className="flex flex-col gap-1">
              {categoryItems.map((item) => (
                <div
                  key={item.stepType}
                  draggable
                  onDragStart={(e) => onDragStart(e, item)}
                  title={item.description}
                  className="flex cursor-grab items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground active:cursor-grabbing"
                >
                  <CategoryIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  {item.label}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
