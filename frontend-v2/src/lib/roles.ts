import type { AuthUser } from './auth-storage';

// Mirrors the backend's role-groups.ts policy (Viewer read-only, QA Lead
// approvals, Admin credential/integration management) so the UI can hide
// actions a role would just get a 403 for, rather than surprise the user.
export function canOperate(role: AuthUser['role'] | undefined): boolean {
  return role === 'QA_ENGINEER' || role === 'QA_LEAD' || role === 'ADMIN';
}

export function canApprove(role: AuthUser['role'] | undefined): boolean {
  return role === 'QA_LEAD' || role === 'ADMIN';
}

export function isAdmin(role: AuthUser['role'] | undefined): boolean {
  return role === 'ADMIN';
}
