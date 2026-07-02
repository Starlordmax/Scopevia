import { describe, expect, it } from "vitest";
import { pickActiveTenant } from "../../src/lib/auth/pick-active-tenant";

const TENANT_A = { tenant_id: "aaaaaaaa-0000-0000-0000-000000000000", tenant_name: "Tenant A" };
const TENANT_B_FOREIGN = { tenant_id: "bbbbbbbb-0000-0000-0000-000000000000", tenant_name: "Tenant B (not mine)" };

describe("pickActiveTenant — cookie manipulation cannot grant access", () => {
  it("picks the tenant matching the cookie when it is in the authoritative list", () => {
    const result = pickActiveTenant([TENANT_A], TENANT_A.tenant_id);
    expect(result).toEqual(TENANT_A);
  });

  it("falls back to the first authoritative tenant when the cookie points at a tenant NOT in the list (manipulated/foreign id)", () => {
    // Simulates a user editing their cookie to Tenant B's id by hand while
    // only actually belonging to Tenant A.
    const result = pickActiveTenant([TENANT_A], TENANT_B_FOREIGN.tenant_id);
    expect(result).toEqual(TENANT_A);
    expect(result).not.toEqual(TENANT_B_FOREIGN);
  });

  it("never fabricates a tenant object for an id absent from the list", () => {
    const result = pickActiveTenant([TENANT_A], TENANT_B_FOREIGN.tenant_id);
    expect(result?.tenant_id).not.toBe(TENANT_B_FOREIGN.tenant_id);
  });

  it("returns null when the user has no tenants at all, regardless of cookie value", () => {
    expect(pickActiveTenant([], TENANT_B_FOREIGN.tenant_id)).toBeNull();
    expect(pickActiveTenant([], undefined)).toBeNull();
  });

  it("returns the (only) tenant when there is no cookie at all", () => {
    expect(pickActiveTenant([TENANT_A], undefined)).toEqual(TENANT_A);
  });

  it("an empty-string cookie value is treated as absent, not as a match attempt", () => {
    const result = pickActiveTenant([TENANT_A], "");
    expect(result).toEqual(TENANT_A);
  });
});
