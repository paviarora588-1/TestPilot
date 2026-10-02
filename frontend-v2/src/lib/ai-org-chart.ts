import { Compass, Database, Eye, Palette, ShieldCheck, Server, type LucideIcon } from 'lucide-react';
import type { AiEngineeringTask, AiTaskArea, AiTaskStatus, AiTaskVerification } from './types';

// Presentational only — every "persona" here routes through the exact same
// triage+specialist pipeline in ai-engineering.service.ts. This file adds no
// new backend behavior; it only maps existing task fields (status/area/
// touchesSchema) to a human-friendly "who's working on this" view.
export interface AiPersona {
  id: string;
  name: string;
  role: string;
  icon: LucideIcon;
  isActive: (tasks: AiEngineeringTask[]) => boolean;
}

export const AI_PERSONAS: AiPersona[] = [
  {
    id: 'pm',
    name: 'Pavi',
    role: 'AI Project Manager',
    icon: Compass,
    isActive: (tasks) => tasks.some((t) => t.status === 'PENDING' || t.status === 'PLANNING'),
  },
  {
    id: 'backend',
    name: 'Dev',
    role: 'Backend Engineer',
    icon: Server,
    isActive: (tasks) => tasks.some((t) => t.status === 'IN_PROGRESS' && (t.area === 'BACKEND' || t.area === 'BOTH')),
  },
  {
    id: 'frontend',
    name: 'Fiona',
    role: 'Frontend Engineer',
    icon: Palette,
    isActive: (tasks) => tasks.some((t) => t.status === 'IN_PROGRESS' && (t.area === 'FRONTEND' || t.area === 'BOTH')),
  },
  {
    id: 'db',
    name: 'Sam',
    role: 'Database Engineer',
    icon: Database,
    isActive: (tasks) => tasks.some((t) => t.status === 'IN_PROGRESS' && t.touchesSchema),
  },
  // Surfaces the advisory AI review pass (aiReviewPassed/aiReviewSummary)
  // that already runs on every task as its own team member, rather than
  // leaving it buried inside the verification detail view. Advisory only —
  // same as everywhere else this field is used, it does not change who has
  // to approve a task; a human still signs off before anything reaches real
  // source (see TaskFullDetail's VerificationSection).
  {
    id: 'reviewer',
    name: 'Val',
    role: 'Senior Engineer',
    icon: Eye,
    isActive: (tasks) => tasks.some((t) => t.status === 'WAITING_REVIEW'),
  },
  {
    id: 'qa',
    name: 'Robo',
    role: 'QA Verifier',
    icon: ShieldCheck,
    isActive: (tasks) => tasks.some((t) => t.status === 'IN_PROGRESS'),
  },
];

// One row of "what this persona actually did" for the click-through popup —
// same underlying task fields as the main review card, just reshaped per
// persona so each one's popup only shows the work that was actually theirs.
export interface PersonaWorkItem {
  taskId: string;
  title: string;
  status: AiTaskStatus;
  assignedTo: string;
  tested: string;
  bugsFound: number;
  result: 'PASS' | 'FAIL' | 'PENDING';
}

function assignedToLabel(area: AiTaskArea | null): string {
  switch (area) {
    case 'BACKEND':
      return 'Dev (Backend)';
    case 'FRONTEND':
      return 'Fiona (Frontend)';
    case 'BOTH':
      return 'Dev + Fiona (Backend & Frontend)';
    case 'NEEDS_HUMAN':
      return 'Unassigned — needs a human';
    default:
      return 'Pending triage';
  }
}

// The stored `title` is often written in developer jargon (error codes, file
// paths, rule names) since it's usually the technical reporter's own words —
// friendlySummary is the one-sentence plain-English restatement generated at
// triage time. Older tasks (triaged before this field existed) fall back to
// the technical title, which is still better than nothing.
export function displayTitle(t: AiEngineeringTask): string {
  return t.friendlySummary?.trim() || t.title;
}

function verificationResult(v: AiTaskVerification | null): 'PASS' | 'FAIL' | 'PENDING' {
  if (!v) return 'PENDING';
  return v.tsc.passed && v.tests.passed ? 'PASS' : 'FAIL';
}

function testedLabel(v: AiTaskVerification | null): string {
  if (!v) return '—';
  const parts = ['Typecheck'];
  if (v.tests.output !== 'No automated test suite for this area yet.') parts.push('Tests');
  return parts.join(' + ');
}

// "Bugs found" is repairAttempts — the number of times Robo's verification
// pass failed and sent the fix back for another try before it settled.
export function getPersonaWork(personaId: string, tasks: AiEngineeringTask[]): PersonaWorkItem[] {
  const items: PersonaWorkItem[] = [];

  for (const t of tasks) {
    const assignedTo = assignedToLabel(t.area);

    if (personaId === 'pm') {
      items.push({ taskId: t.id, title: displayTitle(t), status: t.status, assignedTo, tested: '—', bugsFound: 0, result: 'PENDING' });
      continue;
    }

    if (personaId === 'backend' && (t.area === 'BACKEND' || t.area === 'BOTH')) {
      items.push({
        taskId: t.id,
        title: displayTitle(t),
        status: t.status,
        assignedTo,
        tested: testedLabel(t.verificationJson),
        bugsFound: t.repairAttempts,
        result: verificationResult(t.verificationJson),
      });
    }

    if (personaId === 'frontend' && t.area === 'FRONTEND') {
      items.push({
        taskId: t.id,
        title: displayTitle(t),
        status: t.status,
        assignedTo,
        tested: testedLabel(t.verificationJson),
        bugsFound: t.repairAttempts,
        result: verificationResult(t.verificationJson),
      });
    } else if (personaId === 'frontend' && t.area === 'BOTH') {
      items.push({
        taskId: t.id,
        title: displayTitle(t),
        status: t.status,
        assignedTo,
        tested: testedLabel(t.secondaryVerificationJson),
        bugsFound: t.secondaryRepairAttempts,
        result: verificationResult(t.secondaryVerificationJson),
      });
    }

    if (personaId === 'db' && t.touchesSchema) {
      items.push({
        taskId: t.id,
        title: displayTitle(t),
        status: t.status,
        assignedTo,
        tested: t.migrationSql ? 'Schema diff drafted (never auto-applied)' : 'Schema review',
        bugsFound: t.repairAttempts,
        result: verificationResult(t.verificationJson),
      });
    }

    if (personaId === 'reviewer') {
      if (t.aiReviewSummary) {
        items.push({
          taskId: t.id,
          title: t.area === 'BOTH' ? `${displayTitle(t)} (backend)` : displayTitle(t),
          status: t.status,
          assignedTo,
          tested: 'Advisory code review',
          bugsFound: 0,
          result: t.aiReviewPassed == null ? 'PENDING' : t.aiReviewPassed ? 'PASS' : 'FAIL',
        });
      }
      if (t.area === 'BOTH' && t.secondaryAiReviewSummary) {
        items.push({
          taskId: t.id,
          title: `${displayTitle(t)} (frontend)`,
          status: t.status,
          assignedTo,
          tested: 'Advisory code review',
          bugsFound: 0,
          result: t.secondaryAiReviewPassed == null ? 'PENDING' : t.secondaryAiReviewPassed ? 'PASS' : 'FAIL',
        });
      }
    }

    if (personaId === 'qa') {
      if (t.verificationJson) {
        items.push({
          taskId: t.id,
          title: t.area === 'BOTH' ? `${displayTitle(t)} (backend)` : displayTitle(t),
          status: t.status,
          assignedTo,
          tested: testedLabel(t.verificationJson),
          bugsFound: t.repairAttempts,
          result: verificationResult(t.verificationJson),
        });
      }
      if (t.area === 'BOTH' && t.secondaryVerificationJson) {
        items.push({
          taskId: t.id,
          title: `${displayTitle(t)} (frontend)`,
          status: t.status,
          assignedTo,
          tested: testedLabel(t.secondaryVerificationJson),
          bugsFound: t.secondaryRepairAttempts,
          result: verificationResult(t.secondaryVerificationJson),
        });
      }
    }
  }

  return items;
}
