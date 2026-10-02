'use client';

import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  // resolvedTheme is always undefined on the server (it depends on
  // localStorage/matchMedia, neither of which exist there), so rendering it
  // directly renders Sun server-side and then Moon client-side whenever the
  // real resolved theme is dark — a real hydration mismatch, not a false
  // positive. Rendering a fixed icon until mounted keeps server and client
  // output identical for the one render that matters for hydration.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // Intentional for SSR hydration safety, same pattern as auth-context.tsx/
    // application-context.tsx: this can only become true once mounted on the
    // client, by definition — there's no external state to synchronize with.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
      aria-label="Toggle theme"
    >
      {mounted && resolvedTheme === 'dark' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
    </Button>
  );
}
