import { describe, expect, it } from "vitest";
import { PERMISSIONS } from "../../src/lib/auth/permission-keys";

// This list must stay byte-for-byte in sync with the `key` column seeded in
// supabase/migrations/20260701120900_seed_roles_and_permissions.sql (Phase 0),
// supabase/migrations/20260702131100_seed_crm_permissions.sql (Phase 1),
// supabase/migrations/20260706141600_seed_proposal_permissions.sql (Phase 2A),
// supabase/migrations/20260708120200_seed_material_catalog_permissions.sql (Phase 2B), and
// supabase/migrations/20260709140300_measurements_rls_and_permissions.sql (Phase 2C), and
// supabase/migrations/20260715100200_client_portal_rls_and_permissions.sql (Phase 3A), and
// supabase/migrations/20260720100200_seed_proposal_revision_permission.sql (Phase 3B.1), and
// supabase/migrations/20260819100600_seed_ai_permissions.sql (AI-assisted proposal text).
// There is no automated cross-check against the live database in a unit test
// (that belongs to the RLS/integration suite), so this test exists to catch a
// TypeScript-side typo or rename that would otherwise silently desync from
// the database and make every permission check fail closed.
const EXPECTED_PERMISSION_KEYS = [
  // Phase 0
  "tenant.view",
  "tenant.update",
  "members.view",
  "members.invite",
  "members.update",
  "members.remove",
  "roles.view",
  "roles.manage",
  "audit.view",
  // Phase 1
  "clients.view",
  "clients.create",
  "clients.update",
  "clients.archive",
  "clients.restore",
  "contacts.view",
  "contacts.create",
  "contacts.update",
  "contacts.archive",
  "contacts.restore",
  "opportunities.view",
  "opportunities.create",
  "opportunities.update",
  "opportunities.change_status",
  "opportunities.archive",
  "opportunities.restore",
  "opportunities.convert_to_project",
  "projects.view",
  "projects.create",
  "projects.update",
  "projects.archive",
  "projects.restore",
  "notes.view",
  "notes.create",
  "notes.update",
  "notes.archive",
  "activities.view",
  // Phase 2A
  "proposals.view",
  "proposals.create",
  "proposals.update",
  "proposals.archive",
  "proposals.restore",
  "proposals.mark_ready",
  "proposals.manage_pricing",
  "proposal_versions.create",
  "proposal_versions.view",
  "portfolio.view",
  "portfolio.create",
  "portfolio.update",
  "portfolio.archive",
  "portfolio.restore",
  "media.view",
  "media.upload",
  "media.update",
  "media.archive",
  "proposal_settings.view",
  "proposal_settings.update",
  // Phase 2B
  "materials.view",
  "materials.create",
  "materials.update",
  "materials.archive",
  "material_prices.view",
  "material_prices.create",
  "material_prices.update",
  "material_prices.archive",
  // Phase 2C
  "measurements.view",
  "measurements.create",
  "measurements.update",
  "measurements.archive",
  "measurements.generate_materials",
  // Phase 3A
  "proposal_portal_links.create",
  "proposal_portal_links.view",
  "proposal_portal_links.revoke",
  // Phase 3B.1
  "proposals.create_revision",
  // AI-assisted proposal text
  "ai.generate_proposal_text",
].sort();

describe("PERMISSIONS", () => {
  it("matches the permission keys seeded in the database", () => {
    expect(Object.values(PERMISSIONS).sort()).toEqual(EXPECTED_PERMISSION_KEYS);
  });

  it("every key follows the '<noun>.<verb>' convention", () => {
    for (const key of Object.values(PERMISSIONS)) {
      expect(key).toMatch(/^[a-z_]+\.[a-z_]+$/);
    }
  });
});
