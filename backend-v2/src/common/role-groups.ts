import { UserRole } from '../../generated/prisma/enums';

// Central policy for @Roles() across controllers — Viewer is read-only
// everywhere (no role list needed, RolesGuard allows all authenticated users
// when no @Roles() is present), QA Engineer does day-to-day operational work,
// QA Lead additionally approves higher-risk actions (auto-heal, deletions),
// Admin additionally manages credentials/integrations.
export const OPERATIONAL_ROLES = [UserRole.QA_ENGINEER, UserRole.QA_LEAD, UserRole.ADMIN];
export const APPROVAL_ROLES = [UserRole.QA_LEAD, UserRole.ADMIN];
export const ADMIN_ONLY = [UserRole.ADMIN];
