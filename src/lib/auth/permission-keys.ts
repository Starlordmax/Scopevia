/**
 * Pure permission-key constants — deliberately has NO "server-only" import
 * and no dependency on Supabase/Next.js request context, so it can be
 * imported from anywhere, including plain unit tests (see
 * tests/unit/permissions.test.ts) and future Client Components that just
 * need to reference a key by name (e.g. to label a UI element), without
 * pulling in server-only code.
 *
 * Mirrors the `permissions.key` values seeded in the database — keep in
 * sync with supabase/migrations/20260701120900_seed_roles_and_permissions.sql.
 */
export const PERMISSIONS = {
  TENANT_VIEW: "tenant.view",
  TENANT_UPDATE: "tenant.update",
  MEMBERS_VIEW: "members.view",
  MEMBERS_INVITE: "members.invite",
  MEMBERS_UPDATE: "members.update",
  MEMBERS_REMOVE: "members.remove",
  ROLES_VIEW: "roles.view",
  ROLES_MANAGE: "roles.manage",
  AUDIT_VIEW: "audit.view",
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
