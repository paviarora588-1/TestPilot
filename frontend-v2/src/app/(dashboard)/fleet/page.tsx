'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { Building2, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageHeader } from '@/components/layout/page-header';
import { AnimatedTableBody, AnimatedTableRow } from '@/components/motion/animated-table';
import { downloadFleetCsv, listFleetOverview } from '@/lib/api';
import { useApplicationContext } from '@/lib/application-context';
import { cn } from '@/lib/utils';

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

function scoreTone(value: number) {
  return value >= 70
    ? 'text-emerald-600 dark:text-emerald-400'
    : value >= 40
      ? 'text-[#A8660F] dark:text-[#DBA65B]'
      : 'text-rose-600 dark:text-rose-400';
}

function PctBar({ value }: { value: number | null }) {
  if (value == null) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-14 overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            'h-full rounded-full',
            value >= 70 ? 'bg-emerald-500' : value >= 40 ? 'bg-[#A8660F] dark:bg-[#DBA65B]' : 'bg-destructive',
          )}
          style={{ width: `${Math.round(value)}%` }}
        />
      </div>
      <span className="font-mono text-xs text-muted-foreground">{Math.round(value)}%</span>
    </div>
  );
}

export default function FleetPage() {
  const router = useRouter();
  const { setSelectedApplicationId } = useApplicationContext();
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['fleet-overview'],
    queryFn: listFleetOverview,
  });

  function openDashboard(applicationId: string) {
    setSelectedApplicationId(applicationId);
    router.push('/dashboard');
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageHeader
          title="Fleet"
          icon={Building2}
          description="Portfolio-wide quality across every application under test."
        />
        <Button variant="outline" onClick={() => downloadFleetCsv()}>
          <Download className="mr-2 h-4 w-4" />
          Export CSV
        </Button>
      </div>

      <Card>
        <CardContent className="pt-6">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : rows.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
              No applications yet. Register one to see it here.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Application</TableHead>
                  <TableHead>Quality score</TableHead>
                  <TableHead>Coverage</TableHead>
                  <TableHead>Object health</TableHead>
                  <TableHead>Pass rate</TableHead>
                  <TableHead>Last scan</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <AnimatedTableBody>
                {rows.map((row) => (
                  <AnimatedTableRow key={row.id}>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell>
                      {row.qualityScore.score == null ? (
                        <span className="text-muted-foreground">Not enough data</span>
                      ) : (
                        <span className={cn('font-mono text-sm font-semibold', scoreTone(row.qualityScore.score))}>
                          {row.qualityScore.score}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <PctBar value={row.automationCoverage} />
                    </TableCell>
                    <TableCell>
                      <PctBar value={row.objectHealthPct} />
                    </TableCell>
                    <TableCell>
                      <PctBar value={row.passRate} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">{relativeTime(row.lastScanAt)}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm" onClick={() => openDashboard(row.id)}>
                        View
                      </Button>
                    </TableCell>
                  </AnimatedTableRow>
                ))}
              </AnimatedTableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
