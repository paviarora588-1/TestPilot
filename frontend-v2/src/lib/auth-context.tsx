'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from './api-client';
import { AuthUser, clearSession, loadSession, saveSession } from './auth-storage';

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    // Intentional for SSR hydration safety: browser-only storage cannot be read during the initial shared render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUser(loadSession()?.user ?? null);
    // Intentional for SSR hydration safety: browser-only storage cannot be read during the initial shared render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsLoading(false);
  }, []);

  async function login(email: string, password: string) {
    const res = await apiClient.post('/auth/login', { email, password });
    saveSession(res.data);
    setUser(res.data.user);
    router.push('/home');
  }

  async function logout() {
    const session = loadSession();
    if (session?.refreshToken) {
      try {
        await apiClient.post('/auth/logout', { refreshToken: session.refreshToken });
      } catch {
        // best-effort server-side revocation
      }
    }
    clearSession();
    setUser(null);
    router.push('/');
  }

  return <AuthContext.Provider value={{ user, isLoading, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
