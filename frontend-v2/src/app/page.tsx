'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { HomePage } from '@/components/marketing/home';

// "/" is the public marketing landing page — signed-out visitors land here
// (and logging out brings them back here). A signed-in visitor who hits "/"
// directly is sent on into the app's own Home page instead.
export default function RootPage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;
    if (user) router.replace('/home');
  }, [isLoading, user, router]);

  if (isLoading || user) return null;

  return <HomePage />;
}
