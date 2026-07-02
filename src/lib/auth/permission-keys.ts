/**
 * Pure permission-key constants — deliberately has NO "server-only" import
 * and no dependency on Supabase/Next.js request context, so it can be
 * imported from anywhere, including plain unit tests (see
 * tests/unit/permissions.test.ts) and future Client Components that just
 * need to reference a key by name (e.g. to label a UI element), without
 * pulling in server-only code.
 *
 * Mirrors the `permissions.key` values seeded in the database — keep in
 * sync with supabase/migrations/20260701120900_seed_roles_and_permissions.sql
 * (Phase 0) and supabase/migrations/20260702131100_seed_crm_permissions.sql
 * (Phase 1).
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

  // Phase 1: CRM & Projects
  CLIENTS_VIEW: "clients.view",
  CLIENTS_CREATE: "clients.create",
  CLIENTS_UPDATE: "clients.update",
  CLIENTS_ARCHIVE: "clients.archive",
  CLIENTS_RESTORE: "clients.restore",

  CONTACTS_VIEW: "contacts.view",
  CONTACTS_CREATE: "contacts.create",
  CONTACTS_UPDATE: "contacts.update",
  CONTACTS_ARCHIVE: "contacts.archive",
  CONTACTS_RESTORE: "contacts.restore",

  OPPORTUNITIES_VIEW: "opportunities.view",
  OPPORTUNITIES_CREATE: "opportunities.create",
  OPPORTUNITIES_UPDATE: "opportunities.update",
  OPPORTUNITIES_CHANGE_STATUS: "opportunities.change_status",
  OPPORTUNITIES_ARCHIVE: "opportunities.archive",
  OPPORTUNITIES_RESTORE: "opportunities.restore",
  OPPORTUNITIES_CONVERT_TO_PROJECT: "opportunities.convert_to_project",

  PROJECTS_VIEW: "projects.view",
  PROJECTS_CREATE: "projects.create",
  PROJECTS_UPDATE: "projects.update",
  PROJECTS_ARCHIVE: "projects.archive",
  PROJECTS_RESTORE: "projects.restore",

  NOTES_VIEW: "notes.view",
  NOTES_CREATE: "notes.create",
  NOTES_UPDATE: "notes.update",
  NOTES_ARCHIVE: "notes.archive",

  ACTIVITIES_VIEW: "activities.view",
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
