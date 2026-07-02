import { describe, expect, it } from "vitest";
import { PERMISSIONS } from "../../src/lib/auth/permission-keys";

// This list must stay byte-for-byte in sync with the `key` column seeded in
// supabase/migrations/20260701120900_seed_roles_and_permissions.sql. There is
// no automated cross-check against the live database in a unit test (that
// belongs to the RLS/integration suite), so this test exists to catch a
// TypeScript-side typo or rename that would otherwise silently desync from
// the database and make every permission check fail closed.
const EXPECTED_PERMISSION_KEYS = [
  "tenant.view",
  "tenant.update",
  "members.view",
  "members.invite",
  "members.update",
  "members.remove",
  "roles.view",
  "roles.manage",
  "audit.view",
].sort();

describe("PERMISSIONS", () => {
  it("matches the permission keys seeded in the database", () => {
    expect(Object.values(PERMISSIONS).sort()).toEqual(EXPECTED_PERMISSION_KEYS);
  });

  it("every key follows the '<noun>.<verb>' convention", () => {
    for (const key of Object.values(PERMISSIONS)) {
      expect(key).toMatch(/^[a-z]+\.[a-z_]+$/);
    }
  });
});
