'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listApplications } from './api';
import type { Application } from './types';

const STORAGE_KEY = 'testpilot.selectedApplicationId';

interface ApplicationContextValue {
  applications: Application[];
  isLoading: boolean;
  selectedApplicationId: string | null;
  selectedApplication: Application | null;
  setSelectedApplicationId: (id: string | null) => void;
}

const ApplicationContext = createContext<ApplicationContextValue | undefined>(undefined);

export function ApplicationProvider({ children }: { children: ReactNode }) {
  const { data: applications = [], isLoading } = useQuery({
    queryKey: ['applications'],
    queryFn: listApplications,
  });
  const [storedApplicationId, setSelectedApplicationIdState] = useState<string | null>(null);

  useEffect(() => {
    // Intentional for SSR hydration safety: browser-only storage cannot be read during the initial shared render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedApplicationIdState(localStorage.getItem(STORAGE_KEY));
  }, []);

  const selectedApplicationId =
    !isLoading && applications.length > 0 && !applications.some((application) => application.id === storedApplicationId)
      ? applications[0].id
      : storedApplicationId;

  function setSelectedApplicationId(id: string | null) {
    setSelectedApplicationIdState(id);
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
  }

  const selectedApplication = applications.find((a) => a.id === selectedApplicationId) ?? null;

  return (
    <ApplicationContext.Provider
      value={{ applications, isLoading, selectedApplicationId, selectedApplication, setSelectedApplicationId }}
    >
      {children}
    </ApplicationContext.Provider>
  );
}

export function useApplicationContext() {
  const ctx = useContext(ApplicationContext);
  if (!ctx) throw new Error('useApplicationContext must be used within ApplicationProvider');
  return ctx;
}
