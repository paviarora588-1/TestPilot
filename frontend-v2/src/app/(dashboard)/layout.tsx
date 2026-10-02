import { AppShell } from '@/components/layout/app-shell';
import { RequireAuth } from '@/components/layout/require-auth';
import { ApplicationProvider } from '@/lib/application-context';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth>
      <ApplicationProvider>
        <AppShell>{children}</AppShell>
      </ApplicationProvider>
    </RequireAuth>
  );
}
