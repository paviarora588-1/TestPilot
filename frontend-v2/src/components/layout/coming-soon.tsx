import { Card, CardContent } from '@/components/ui/card';
import { PageHeader } from './page-header';

export function ComingSoon({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <PageHeader title={title} description={description} />
      <Card>
        <CardContent className="flex min-h-[240px] flex-col items-center justify-center gap-2 text-center text-muted-foreground">
          <p className="text-sm font-medium">This module is scheduled for a later build phase.</p>
          <p className="text-xs">See the TestPilot roadmap for delivery order.</p>
        </CardContent>
      </Card>
    </div>
  );
}
