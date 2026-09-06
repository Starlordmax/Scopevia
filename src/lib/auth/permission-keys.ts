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
 * (Phase 0), supabase/migrations/20260702131100_seed_crm_permissions.sql
 * (Phase 1), supabase/migrations/20260706141600_seed_proposal_permissions.sql
 * (Phase 2A), supabase/migrations/20260708120200_seed_material_catalog_permissions.sql
 * (Phase 2B), supabase/migrations/20260709140300_measurements_rls_and_permissions.sql
 * (Phase 2C), supabase/migrations/20260715100200_client_portal_rls_and_permissions.sql
 * (Phase 3A), supabase/migrations/20260720100200_seed_proposal_revision_permission.sql
 * (Phase 3B.1), and supabase/migrations/20260819100600_seed_ai_permissions.sql
 * (AI-assisted proposal text).
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

  // Phase 2A: Proposal-centric pivot
  PROPOSALS_VIEW: "proposals.view",
  PROPOSALS_CREATE: "proposals.create",
  PROPOSALS_UPDATE: "proposals.update",
  PROPOSALS_ARCHIVE: "proposals.archive",
  PROPOSALS_RESTORE: "proposals.restore",
  PROPOSALS_MARK_READY: "proposals.mark_ready",
  PROPOSALS_MANAGE_PRICING: "proposals.manage_pricing",

  PROPOSAL_VERSIONS_CREATE: "proposal_versions.create",
  PROPOSAL_VERSIONS_VIEW: "proposal_versions.view",
  PROPOSALS_CREATE_REVISION: "proposals.create_revision",

  PORTFOLIO_VIEW: "portfolio.view",
  PORTFOLIO_CREATE: "portfolio.create",
  PORTFOLIO_UPDATE: "portfolio.update",
  PORTFOLIO_ARCHIVE: "portfolio.archive",
  PORTFOLIO_RESTORE: "portfolio.restore",

  MEDIA_VIEW: "media.view",
  MEDIA_UPLOAD: "media.upload",
  MEDIA_UPDATE: "media.update",
  MEDIA_ARCHIVE: "media.archive",

  PROPOSAL_SETTINGS_VIEW: "proposal_settings.view",
  PROPOSAL_SETTINGS_UPDATE: "proposal_settings.update",

  // Phase 2B: Material catalog & ZIP pricing
  MATERIALS_VIEW: "materials.view",
  MATERIALS_CREATE: "materials.create",
  MATERIALS_UPDATE: "materials.update",
  MATERIALS_ARCHIVE: "materials.archive",

  MATERIAL_PRICES_VIEW: "material_prices.view",
  MATERIAL_PRICES_CREATE: "material_prices.create",
  MATERIAL_PRICES_UPDATE: "material_prices.update",
  MATERIAL_PRICES_ARCHIVE: "material_prices.archive",

  // Phase 2C: Measurements / Takeoff builder
  MEASUREMENTS_VIEW: "measurements.view",
  MEASUREMENTS_CREATE: "measurements.create",
  MEASUREMENTS_UPDATE: "measurements.update",
  MEASUREMENTS_ARCHIVE: "measurements.archive",
  MEASUREMENTS_GENERATE_MATERIALS: "measurements.generate_materials",

  // Phase 3A: Client Portal
  PORTAL_LINKS_CREATE: "proposal_portal_links.create",
  PORTAL_LINKS_VIEW: "proposal_portal_links.view",
  PORTAL_LINKS_REVOKE: "proposal_portal_links.revoke",

  // AI-assisted proposal text (Terms/Exclusions/Notes). Business profile
  // itself has no dedicated permission -- it reuses TENANT_VIEW/TENANT_UPDATE
  // above, see docs/78-business-profile-ai-context.md.
  AI_GENERATE_PROPOSAL_TEXT: "ai.generate_proposal_text",
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
