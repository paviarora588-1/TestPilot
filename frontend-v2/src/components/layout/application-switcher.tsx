'use client';

import Link from 'next/link';
import { Plus } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useApplicationContext } from '@/lib/application-context';

export function ApplicationSwitcher() {
  const { applications, isLoading, selectedApplicationId, setSelectedApplicationId } = useApplicationContext();

  if (isLoading) return null;

  if (applications.length === 0) {
    return (
      <Link
        href="/applications"
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <Plus className="h-3.5 w-3.5" />
        No applications yet — create one
      </Link>
    );
  }

  return (
    <Select value={selectedApplicationId ?? ''} onValueChange={setSelectedApplicationId}>
      <SelectTrigger className="w-[150px] sm:w-[200px]">
        <SelectValue placeholder="Select application">
          {(value: string | null) => applications.find((app) => app.id === value)?.name ?? 'Select application'}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {applications.map((app) => (
          <SelectItem key={app.id} value={app.id}>
            {app.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
