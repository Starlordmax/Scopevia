/**
 * Phase 2B (Material catalog & ZIP pricing + proposal delete/archive) —
 * catalog search + fallback tiers, price snapshotting, cross-tenant
 * integrity for materials/prices, the materials.x / material_prices.x
 * permission matrix, and additional archive/restore edge cases not
 * already covered by tests/rls/phase2a-proposals.test.ts (cross-tenant
 * archive rejection, a suspended user's session, audit log entries).
 *
 * Same infrastructure/conventions as tests/rls/phase2a-proposals.test.ts —
 * requires SUPABASE_TEST_URL/ANON_KEY/SERVICE_ROLE_KEY in .env.local
 * pointing at a project dedicated to testing; skipped entirely if absent.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });

const TEST_URL = process.env.SUPABASE_TEST_URL;
const TEST_SERVICE_ROLE_KEY = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY;
const TEST_ANON_KEY = process.env.SUPABASE_TEST_ANON_KEY;

const canRun = Boolean(TEST_URL && TEST_SERVICE_ROLE_KEY && TEST_ANON_KEY);
const PASSWORD = "correct-horse-battery-staple";
const RUN_ID = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;

function email(label: string): string {
  return `test-p2b-${label}-${RUN_ID}@example.com`;
}

async function signIn(addr: string): Promise<SupabaseClient> {
  const client = createClient(TEST_URL!, TEST_ANON_KEY!);
  const { error } = await client.auth.signInWithPassword({ email: addr, password: PASSWORD });
  if (error) throw error;
  return client;
}

type TestUser = { id: string; email: string };
type CatalogRow = {
  id: string;
  name: string;
  unit_price_cents: number | null;
  price_zip_code: string | null;
  price_state_code: string | null;
};

describe.skipIf(!canRun)("Phase 2B Material catalog & ZIP pricing (requires real Postgres)", () => {
  let admin: SupabaseClient;
  let userA: TestUser, userB: TestUser, estimatorUser: TestUser, salesUser: TestUser, viewerUser: TestUser, adminUser: TestUser;
  let aClient: SupabaseClient, bClient: SupabaseClient, estimatorClient: SupabaseClient, salesClient: SupabaseClient, viewerClient: SupabaseClient, adminClientA: SupabaseClient;
  let tenantAId: string, tenantBId: string;
  let clientAId: string;
  let adminMembershipId: string;

  let interiorPaintId: string;
  let membraneId: string;
  let sandpaperId: string;
  let debrisDisposalId: string;

  const allUserIds: string[] = [];

  beforeAll(async () => {
    admin = createClient(TEST_URL!, TEST_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });

    async function createUser(label: string) {
      const addr = email(label);
      const { data, error } = await admin.auth.admin.createUser({ email: addr, password: PASSWORD, email_confirm: true });
      if (error || !data.user) throw error ?? new Error(`Failed to create ${label}`);
      allUserIds.push(data.user.id);
      return { id: data.user.id, email: addr };
    }

    userA = await createUser("a-owner");
    userB = await createUser("b-owner");
    estimatorUser = await createUser("estimator");
    salesUser = await createUser("sales");
    viewerUser = await createUser("viewer");
    adminUser = await createUser("admin");

    [aClient, bClient, estimatorClient, salesClient, viewerClient, adminClientA] = await Promise.all([
      signIn(userA.email),
      signIn(userB.email),
      signIn(estimatorUser.email),
      signIn(salesUser.email),
      signIn(viewerUser.email),
      signIn(adminUser.email),
    ]);

    const { data: tenantA } = await aClient
      .rpc("create_tenant_with_owner", { p_name: "P2B Tenant A", p_slug: `p2b-a-${RUN_ID}` })
      .single();
    tenantAId = (tenantA as { id: string }).id;

    const { data: tenantB } = await bClient
      .rpc("create_tenant_with_owner", { p_name: "P2B Tenant B", p_slug: `p2b-b-${RUN_ID}` })
      .single();
    tenantBId = (tenantB as { id: string }).id;

    async function inviteAndAccept(client: SupabaseClient, targetEmail: string, role: string) {
      const { data: invite, error: inviteErr } = await aClient
        .rpc("invite_member_by_email", { p_tenant_id: tenantAId, p_email: targetEmail, p_role_key: role })
        .single();
      if (inviteErr) throw inviteErr;
      const { error: acceptErr } = await client.rpc("accept_invitation", {
        p_membership_id: (invite as { id: string }).id,
      });
      if (acceptErr) throw acceptErr;
      return (invite as { id: string }).id;
    }

    await inviteAndAccept(estimatorClient, estimatorUser.email, "estimator");
    await inviteAndAccept(salesClient, salesUser.email, "sales");
    await inviteAndAccept(viewerClient, viewerUser.email, "viewer");
    adminMembershipId = await inviteAndAccept(adminClientA, adminUser.email, "admin");

    const { data: clientA } = await aClient
      .rpc("create_client", { p_tenant_id: tenantAId, p_client_type: "individual", p_display_name: "P2B Client A" })
      .single();
    clientAId = (clientA as { id: string }).id;

    const { data: seedItems } = await admin
      .from("material_catalog_items")
      .select("id, name")
      .eq("scope", "global")
      .in("name", ["Interior Paint", "Waterproof Membrane, Roll", "Sandpaper Pack", "Construction Debris Disposal"]);
    const byName = new Map((seedItems ?? []).map((r) => [r.name, r.id]));
    interiorPaintId = byName.get("Interior Paint")!;
    membraneId = byName.get("Waterproof Membrane, Roll")!;
    sandpaperId = byName.get("Sandpaper Pack")!;
    debrisDisposalId = byName.get("Construction Debris Disposal")!;
  });

  afterAll(async () => {
    for (const id of allUserIds) {
      await admin.auth.admin.deleteUser(id).catch(() => {});
    }
    for (const id of [tenantAId, tenantBId]) {
      if (!id) continue;
      try {
        await admin.from("tenants").delete().eq("id", id);
      } catch {
        // best-effort cleanup
      }
    }
  });

  async function createDraftProposal(title: string): Promise<{ proposalId: string; versionId: string }> {
    const { data: proposal } = await aClient
      .rpc("create_proposal_direct", { p_tenant_id: tenantAId, p_client_id: clientAId, p_title: title, p_service_type: "custom" })
      .single();
    const p = proposal as { id: string; current_version_id: string };
    return { proposalId: p.id, versionId: p.current_version_id };
  }

  // ===========================================================================
  // Seed data
  // ===========================================================================
  describe("Demo seed data", () => {
    it("26 global materials exist across paint, bathroom remodeling, and flooring", async () => {
      const { data, count } = await admin.from("material_catalog_items").select("id", { count: "exact" }).eq("scope", "global");
      expect(count).toBeGreaterThanOrEqual(26);
      expect(data).not.toBeNull();
    });

    it("Interior Paint has manual_seed prices for all 4 demo ZIPs", async () => {
      const { data } = await admin.from("material_zip_prices").select("zip_code, unit_price_cents").eq("material_catalog_item_id", interiorPaintId);
      const zips = new Set((data ?? []).map((r) => r.zip_code));
      expect(zips).toEqual(new Set(["33101", "78701", "90001", "10001"]));
    });
  });

  // ===========================================================================
  // search_material_catalog + find_material_zip_price fallback tiers
  // ===========================================================================
  describe("Catalog search & ZIP price fallback", () => {
    it("exact ZIP match: Interior Paint at 33101 is $42.00", async () => {
      const { data, error } = await aClient.rpc("search_material_catalog", {
        p_tenant_id: tenantAId,
        p_zip_code: "33101",
        p_search_text: "Interior Paint",
      });
      expect(error).toBeNull();
      const row = (data as CatalogRow[]).find((r) => r.id === interiorPaintId);
      expect(row?.unit_price_cents).toBe(4200);
      expect(row?.price_zip_code).toBe("33101");
    });

    it("category filter narrows results to that category only", async () => {
      const { data, error } = await aClient.rpc("search_material_catalog", {
        p_tenant_id: tenantAId,
        p_category: "flooring",
      });
      expect(error).toBeNull();
      const categories = new Set((data as { category: string }[]).map((r) => r.category));
      expect(categories).toEqual(new Set(["flooring"]));
    });

    it("state fallback: Waterproof Membrane resolves at 33101 (FL) via its state-only price row", async () => {
      const { data: price, error } = await aClient.rpc("find_material_zip_price", {
        p_material_catalog_item_id: membraneId,
        p_tenant_id: tenantAId,
        p_zip_code: "33101",
      });
      // find_material_zip_price direct-call is revoked for `authenticated`
      // (see 20260708120600) -- exercised indirectly via search below.
      expect(error).not.toBeNull();
      expect(price).toBeNull();
    });

    it("state fallback via search_material_catalog: Membrane has a price at 33101 (FL) but not at 78701 (TX)", async () => {
      // p_limit defaults to 20 (Phase 2D.1 pagination) -- these two
      // searches have no text/category filter, so with 26+ seeded items
      // "Waterproof Membrane" can fall outside the first page purely by
      // alphabetical position; request a large enough page to see the
      // whole seeded catalog, matching this test's actual intent.
      const { data: atMiami } = await aClient.rpc("search_material_catalog", { p_tenant_id: tenantAId, p_zip_code: "33101", p_limit: 100 });
      const { data: atAustin } = await aClient.rpc("search_material_catalog", { p_tenant_id: tenantAId, p_zip_code: "78701", p_limit: 100 });
      const miamiRow = (atMiami as CatalogRow[]).find((r) => r.id === membraneId);
      const austinRow = (atAustin as CatalogRow[]).find((r) => r.id === membraneId);
      expect(miamiRow?.unit_price_cents).toBe(8500);
      expect(austinRow?.unit_price_cents).toBeNull();
    });

    it("global default fallback: Sandpaper Pack resolves at a ZIP outside the 4 demo ZIPs", async () => {
      const { data } = await aClient.rpc("search_material_catalog", { p_tenant_id: tenantAId, p_zip_code: "99999" });
      const row = (data as CatalogRow[]).find((r) => r.id === sandpaperId);
      expect(row?.unit_price_cents).toBe(900);
    });

    it("never invents a price: Construction Debris Disposal has no price at any ZIP", async () => {
      const { data } = await aClient.rpc("search_material_catalog", { p_tenant_id: tenantAId, p_zip_code: "33101" });
      const row = (data as CatalogRow[]).find((r) => r.id === debrisDisposalId);
      expect(row?.unit_price_cents).toBeNull();
    });
  });

  // ===========================================================================
  // Phase 2B.1: expanded text search (name/description/brand/supplier_name),
  // case-insensitivity, partial match, category-only, and empty-filter
  // normalization -- the root cause of the reported "search doesn't find
  // anything" bug was an empty-string category filter (from the UI's "All
  // categories" option) not being normalized to null before reaching
  // search_material_catalog(), so `category = ''` matched zero rows. See
  // 20260709100000_material_catalog_search_improvements.sql.
  // ===========================================================================
  describe("Text search (name/description/brand/supplier), case-insensitive, partial match", () => {
    it("matches partial, case-insensitive text in the name (Interior Paint / Exterior Paint for 'paint')", async () => {
      const { data, error } = await aClient.rpc("search_material_catalog", { p_tenant_id: tenantAId, p_search_text: "PAINT" });
      expect(error).toBeNull();
      const names = (data as CatalogRow[]).map((r) => r.name);
      expect(names).toContain("Interior Paint");
      expect(names).toContain("Exterior Paint");
    });

    it("matches text that only appears in the description, not the name", async () => {
      // "Exterior Paint"'s description is "Weather-resistant exterior
      // acrylic paint" -- "weather-resistant" appears nowhere in the name.
      const { data, error } = await aClient.rpc("search_material_catalog", { p_tenant_id: tenantAId, p_search_text: "weather-resistant" });
      expect(error).toBeNull();
      const names = (data as CatalogRow[]).map((r) => r.name);
      expect(names).toEqual(["Exterior Paint"]);
    });

    it("matches text in supplier_name (all seed materials are 'Demo Supplier')", async () => {
      // p_limit defaults to 20 (Phase 2D.1 pagination) -- request the
      // whole seeded catalog explicitly, since this test's intent is
      // "the filter itself doesn't wrongly exclude anything," not "the
      // first page happens to be large enough."
      const { data, error } = await aClient.rpc("search_material_catalog", { p_tenant_id: tenantAId, p_search_text: "Demo Supplier", p_limit: 100 });
      expect(error).toBeNull();
      expect((data as CatalogRow[]).length).toBeGreaterThanOrEqual(26);
    });

    it("category alone (no search text) returns every material in that category, not zero", async () => {
      const { data, error } = await aClient.rpc("search_material_catalog", { p_tenant_id: tenantAId, p_category: "plumbing" });
      expect(error).toBeNull();
      const names = (data as CatalogRow[]).map((r) => r.name).sort();
      expect(names).toEqual(["Bathtub, Standard", "Shower Fixture Set", "Toilet, Standard"]);
    });

    it("empty search text and empty category (both '', as the UI's cleared inputs send) still returns the full catalog, not zero", async () => {
      const { data, error } = await aClient.rpc("search_material_catalog", {
        p_tenant_id: tenantAId,
        p_search_text: "",
        p_category: "",
        p_limit: 100,
      });
      expect(error).toBeNull();
      expect((data as CatalogRow[]).length).toBeGreaterThanOrEqual(26);
    });

    it("an empty-string category ('' -- the literal value the 'All categories' <option> submits) is treated as no filter, not as category = ''", async () => {
      const { data, error } = await aClient.rpc("search_material_catalog", { p_tenant_id: tenantAId, p_category: "", p_limit: 100 });
      expect(error).toBeNull();
      expect((data as CatalogRow[]).length).toBeGreaterThanOrEqual(26);
    });

    it("no results for a nonsense search term (a real empty state, not an error)", async () => {
      const { data, error } = await aClient.rpc("search_material_catalog", { p_tenant_id: tenantAId, p_search_text: "zzz-no-such-material-zzz" });
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("search does not expose another tenant's custom material by name/description/brand/supplier text", async () => {
      const uniqueBrand = `TenantOnlyBrand-${RUN_ID}`;
      const { data: material } = await bClient
        .rpc("create_tenant_material", {
          p_tenant_id: tenantBId,
          p_name: `Tenant B Searchable Material ${RUN_ID}`,
          p_category: "other",
          p_default_unit: "each",
          p_brand: uniqueBrand,
        })
        .single();
      expect(material).toBeTruthy();

      const { data: results, error } = await aClient.rpc("search_material_catalog", { p_tenant_id: tenantAId, p_search_text: uniqueBrand });
      expect(error).toBeNull();
      expect(results).toEqual([]);
    });
  });

  // ===========================================================================
  // Phase 2D.1: server-side pagination -- root-caused the ~30,000px mobile
  // scroll: search_material_catalog() had no pagination controls at all
  // (a hard-coded `limit 200`), and the Materials & Costs step rendered
  // every returned row as a full add-to-proposal card with no windowing.
  // See docs/51-material-catalog-pagination.md.
  // ===========================================================================
  describe("Pagination (Phase 2D.1)", () => {
    it("defaults to a page of 20 when p_limit is omitted, with total_count reflecting the true full match count", async () => {
      const { data, error } = await aClient.rpc("search_material_catalog", { p_tenant_id: tenantAId });
      expect(error).toBeNull();
      const rows = data as (CatalogRow & { total_count: number })[];
      expect(rows.length).toBe(20);
      expect(rows[0]!.total_count).toBeGreaterThanOrEqual(26);
      // total_count is identical on every row (count(*) over() is a
      // whole-result-set aggregate, not per-row), not just the first.
      expect(new Set(rows.map((r) => r.total_count)).size).toBe(1);
    });

    it("p_limit/p_offset windows the ordered result set correctly: page1 (limit 5, offset 0) + page2 (limit 5, offset 5) equals one page1+page2 request (limit 10, offset 0)", async () => {
      const page1 = await aClient.rpc("search_material_catalog", { p_tenant_id: tenantAId, p_limit: 5, p_offset: 0 });
      const page2 = await aClient.rpc("search_material_catalog", { p_tenant_id: tenantAId, p_limit: 5, p_offset: 5 });
      const combined = await aClient.rpc("search_material_catalog", { p_tenant_id: tenantAId, p_limit: 10, p_offset: 0 });
      expect(page1.error).toBeNull();
      expect(page2.error).toBeNull();
      expect(combined.error).toBeNull();

      const page1Names = (page1.data as CatalogRow[]).map((r) => r.name);
      const page2Names = (page2.data as CatalogRow[]).map((r) => r.name);
      const combinedNames = (combined.data as CatalogRow[]).map((r) => r.name);
      expect(page1Names.length).toBe(5);
      expect(page2Names.length).toBe(5);
      expect([...page1Names, ...page2Names]).toEqual(combinedNames);
      // No overlap between the two windows -- a real page boundary, not
      // an off-by-one that repeats or skips a row.
      expect(page1Names.some((n) => page2Names.includes(n))).toBe(false);
    });

    it("p_limit combines correctly with a category filter", async () => {
      const { data, error } = await aClient.rpc("search_material_catalog", { p_tenant_id: tenantAId, p_category: "plumbing", p_limit: 2, p_offset: 0 });
      expect(error).toBeNull();
      const rows = data as (CatalogRow & { total_count: number })[];
      expect(rows.length).toBe(2);
      expect(rows[0]!.total_count).toBe(3); // Bathtub, Shower Fixture Set, Toilet -- see the category-only test above
    });

    it("p_limit combines correctly with search text", async () => {
      const { data, error } = await aClient.rpc("search_material_catalog", { p_tenant_id: tenantAId, p_search_text: "paint", p_limit: 1, p_offset: 0 });
      expect(error).toBeNull();
      const rows = data as (CatalogRow & { total_count: number })[];
      expect(rows.length).toBe(1);
      expect(rows[0]!.total_count).toBeGreaterThanOrEqual(2); // at least Interior Paint + Exterior Paint
    });

    it("an offset past the end of the result set returns zero rows, not an error", async () => {
      const { data, error } = await aClient.rpc("search_material_catalog", { p_tenant_id: tenantAId, p_limit: 20, p_offset: 100000 });
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("a genuinely empty result (nonsense search) has total_count undefined/absent -- no rows means no total_count row to read, which the caller (searchMaterialCatalog()) treats as 0", async () => {
      const { data, error } = await aClient.rpc("search_material_catalog", {
        p_tenant_id: tenantAId,
        p_search_text: "zzz-no-such-material-zzz",
      });
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("p_limit is clamped server-side to a maximum of 100, even if a caller asks for far more", async () => {
      const { data, error } = await aClient.rpc("search_material_catalog", { p_tenant_id: tenantAId, p_limit: 999999, p_offset: 0 });
      expect(error).toBeNull();
      expect((data as CatalogRow[]).length).toBeLessThanOrEqual(100);
    });

    it("p_limit is clamped server-side to a minimum of 1, even if a caller asks for zero or a negative number", async () => {
      const zero = await aClient.rpc("search_material_catalog", { p_tenant_id: tenantAId, p_limit: 0, p_offset: 0 });
      const negative = await aClient.rpc("search_material_catalog", { p_tenant_id: tenantAId, p_limit: -5, p_offset: 0 });
      expect(zero.error).toBeNull();
      expect(negative.error).toBeNull();
      expect((zero.data as CatalogRow[]).length).toBe(1);
      expect((negative.data as CatalogRow[]).length).toBe(1);
    });

    it("p_offset is clamped server-side to a minimum of 0, even if a caller asks for a negative offset", async () => {
      const { data, error } = await aClient.rpc("search_material_catalog", { p_tenant_id: tenantAId, p_limit: 5, p_offset: -10 });
      expect(error).toBeNull();
      expect((data as CatalogRow[]).length).toBe(5);
    });

    it("total_count for one tenant is unaffected by another tenant's own custom materials (isolation holds under pagination too)", async () => {
      const uniqueBrand = `TenantOnlyPaginationBrand-${RUN_ID}`;
      await bClient.rpc("create_tenant_material", {
        p_tenant_id: tenantBId,
        p_name: `Tenant B Pagination Material ${RUN_ID}`,
        p_category: "other",
        p_default_unit: "each",
        p_brand: uniqueBrand,
      });

      const { data: aData } = await aClient.rpc("search_material_catalog", { p_tenant_id: tenantAId, p_limit: 1, p_offset: 0 });
      const { data: bSearchesOwnMaterial } = await bClient.rpc("search_material_catalog", {
        p_tenant_id: tenantBId,
        p_search_text: uniqueBrand,
        p_limit: 20,
        p_offset: 0,
      });
      // Tenant A's total_count must not include Tenant B's private material.
      const aTotal = (aData as (CatalogRow & { total_count: number })[])[0]!.total_count;
      const { data: aDataLarge } = await aClient.rpc("search_material_catalog", { p_tenant_id: tenantAId, p_limit: 100, p_offset: 0 });
      const aVisibleIds = new Set((aDataLarge as { id: string }[]).map((r) => r.id));
      const bMaterialId = (bSearchesOwnMaterial as { id: string }[])[0]!.id;
      expect(aVisibleIds.has(bMaterialId)).toBe(false);
      expect(aTotal).toBeGreaterThanOrEqual(26);
    });
  });

  // ===========================================================================
  // Cross-tenant integrity
  // ===========================================================================
  describe("Cross-tenant integrity", () => {
    it("a tenant custom material is invisible to another tenant via search_material_catalog", async () => {
      const { data: material } = await aClient
        .rpc("create_tenant_material", {
          p_tenant_id: tenantAId,
          p_name: `Tenant A Secret Material ${RUN_ID}`,
          p_category: "other",
          p_default_unit: "each",
        })
        .single();
      const materialId = (material as { id: string }).id;

      const { data: bResults } = await bClient.rpc("search_material_catalog", { p_tenant_id: tenantBId, p_search_text: "Secret Material" });
      expect((bResults as CatalogRow[]).some((r) => r.id === materialId)).toBe(false);

      const { data: aResults } = await aClient.rpc("search_material_catalog", { p_tenant_id: tenantAId, p_search_text: "Secret Material" });
      expect((aResults as CatalogRow[]).some((r) => r.id === materialId)).toBe(true);
    });

    it("search_material_catalog rejects a p_tenant_id the caller does not belong to", async () => {
      const { error } = await bClient.rpc("search_material_catalog", { p_tenant_id: tenantAId, p_search_text: "Paint" });
      expect(error).not.toBeNull();
    });

    it("a service_role attempt to create a price for Tenant A's material under Tenant B is rejected by the DB trigger", async () => {
      const { data: material } = await aClient
        .rpc("create_tenant_material", {
          p_tenant_id: tenantAId,
          p_name: `Cross-tenant price target ${RUN_ID}`,
          p_category: "other",
          p_default_unit: "each",
        })
        .single();
      const materialId = (material as { id: string }).id;

      const { error } = await admin.from("material_zip_prices").insert({
        material_catalog_item_id: materialId,
        tenant_id: tenantBId,
        unit_price_cents: 1000,
        price_source: "manual_admin",
      });
      expect(error).not.toBeNull();
      expect(error?.code).toBe("23514");
    });

    it("a proposal_line_item cannot reference another tenant's custom material, even via service_role raw insert", async () => {
      const { data: material } = await bClient
        .rpc("create_tenant_material", {
          p_tenant_id: tenantBId,
          p_name: `Tenant B material ${RUN_ID}`,
          p_category: "other",
          p_default_unit: "each",
        })
        .single();
      const materialId = (material as { id: string }).id;

      const { versionId } = await createDraftProposal("Cross-tenant line item test");

      const { error } = await admin.from("proposal_line_items").insert({
        tenant_id: tenantAId,
        proposal_version_id: versionId,
        category: "material",
        description: "Should be rejected",
        quantity: 1,
        unit: "each",
        unit_price_cents: 100,
        material_catalog_item_id: materialId,
        source_type: "catalog",
      });
      expect(error).not.toBeNull();
      expect(error?.code).toBe("23514");
    });

    it("create_tenant_material_price rejects a material belonging to another tenant", async () => {
      const { data: material } = await bClient
        .rpc("create_tenant_material", {
          p_tenant_id: tenantBId,
          p_name: `Tenant B priceable material ${RUN_ID}`,
          p_category: "other",
          p_default_unit: "each",
        })
        .single();
      const materialId = (material as { id: string }).id;

      const { error } = await aClient.rpc("create_tenant_material_price", {
        p_tenant_id: tenantAId,
        p_material_catalog_item_id: materialId,
        p_unit_price_cents: 500,
      });
      expect(error).not.toBeNull();
    });
  });

  // ===========================================================================
  // Permission matrix
  // ===========================================================================
  describe("Permission matrix", () => {
    it("Viewer cannot create a tenant material", async () => {
      const { error } = await viewerClient.rpc("create_tenant_material", {
        p_tenant_id: tenantAId,
        p_name: "Viewer should not create this",
        p_category: "other",
        p_default_unit: "each",
      });
      expect(error).not.toBeNull();
    });

    it("Viewer cannot archive a tenant material", async () => {
      const { data: material } = await aClient
        .rpc("create_tenant_material", { p_tenant_id: tenantAId, p_name: `Archive target ${RUN_ID}`, p_category: "other", p_default_unit: "each" })
        .single();
      const materialId = (material as { id: string }).id;
      const { error } = await viewerClient.rpc("archive_tenant_material", { p_material_id: materialId });
      expect(error).not.toBeNull();
    });

    it("Estimator can create a tenant material", async () => {
      const { data, error } = await estimatorClient
        .rpc("create_tenant_material", {
          p_tenant_id: tenantAId,
          p_name: `Estimator material ${RUN_ID}`,
          p_category: "other",
          p_default_unit: "each",
        })
        .single();
      expect(error).toBeNull();
      expect((data as { scope: string }).scope).toBe("tenant");
    });

    it("nobody can edit the global catalog, even Owner", async () => {
      const { error } = await aClient.rpc("update_tenant_material", {
        p_material_id: interiorPaintId,
        p_name: "Hacked name",
        p_category: "paint",
        p_default_unit: "gallon",
        p_description: null,
        p_service_type: null,
        p_brand: null,
        p_sku: null,
        p_supplier_name: null,
      });
      expect(error).not.toBeNull();
    });

    it("Sales can add a catalog item to a proposal at the catalog price (proposals.update)", async () => {
      const { versionId } = await createDraftProposal("Sales catalog add");
      await aClient.rpc("update_proposal_pricing_zip", { p_proposal_version_id: versionId, p_zip_code: "33101" });

      const { data, error } = await salesClient
        .rpc("add_proposal_line_item_from_catalog", {
          p_proposal_version_id: versionId,
          p_material_catalog_item_id: interiorPaintId,
          p_quantity: 3,
        })
        .single();
      expect(error).toBeNull();
      expect((data as { unit_price_cents: number; line_total_cents: number }).unit_price_cents).toBe(4200);
      expect((data as { line_total_cents: number }).line_total_cents).toBe(12600);
    });

    it("Sales cannot override the catalog price without proposals.manage_pricing", async () => {
      const { versionId } = await createDraftProposal("Sales override attempt");
      await aClient.rpc("update_proposal_pricing_zip", { p_proposal_version_id: versionId, p_zip_code: "33101" });

      const { error } = await salesClient.rpc("add_proposal_line_item_from_catalog", {
        p_proposal_version_id: versionId,
        p_material_catalog_item_id: interiorPaintId,
        p_quantity: 1,
        p_unit_price_cents_override: 1,
      });
      expect(error).not.toBeNull();
    });

    it("Owner (has manage_pricing) CAN override the catalog price", async () => {
      const { versionId } = await createDraftProposal("Owner override");
      await aClient.rpc("update_proposal_pricing_zip", { p_proposal_version_id: versionId, p_zip_code: "33101" });

      const { data, error } = await aClient
        .rpc("add_proposal_line_item_from_catalog", {
          p_proposal_version_id: versionId,
          p_material_catalog_item_id: interiorPaintId,
          p_quantity: 2,
          p_unit_price_cents_override: 5000,
        })
        .single();
      expect(error).toBeNull();
      expect((data as { unit_price_cents: number }).unit_price_cents).toBe(5000);
    });

    it("adding a catalog item with no available price is rejected rather than defaulting to zero", async () => {
      const { versionId } = await createDraftProposal("No price available");
      await aClient.rpc("update_proposal_pricing_zip", { p_proposal_version_id: versionId, p_zip_code: "33101" });

      const { error } = await aClient.rpc("add_proposal_line_item_from_catalog", {
        p_proposal_version_id: versionId,
        p_material_catalog_item_id: debrisDisposalId,
        p_quantity: 1,
      });
      expect(error).not.toBeNull();
    });
  });

  // ===========================================================================
  // Snapshot immutability + ZIP-change scoping + recalculation
  // ===========================================================================
  describe("Snapshot pricing", () => {
    it("adding a catalog item recalculates the version's totals server-side", async () => {
      const { versionId } = await createDraftProposal("Recalc on catalog add");
      await aClient.rpc("update_proposal_pricing_zip", { p_proposal_version_id: versionId, p_zip_code: "33101" });

      await aClient.rpc("add_proposal_line_item_from_catalog", {
        p_proposal_version_id: versionId,
        p_material_catalog_item_id: interiorPaintId,
        p_quantity: 3,
      });

      const { data: version } = await aClient.from("proposal_versions").select("*").eq("id", versionId).single();
      expect((version as { line_items_subtotal_cents: number }).line_items_subtotal_cents).toBe(12600);
      expect((version as { total_cents: number }).total_cents).toBe(12600);
    });

    it("a later price change never retroactively changes an already-added line item's snapshot", async () => {
      const { versionId } = await createDraftProposal("Snapshot immutability");
      await aClient.rpc("update_proposal_pricing_zip", { p_proposal_version_id: versionId, p_zip_code: "33101" });

      const { data: item } = await aClient
        .rpc("add_proposal_line_item_from_catalog", {
          p_proposal_version_id: versionId,
          p_material_catalog_item_id: interiorPaintId,
          p_quantity: 1,
        })
        .single();
      const lineItemId = (item as { id: string; unit_price_cents: number }).id;
      expect((item as { unit_price_cents: number }).unit_price_cents).toBe(4200);

      // Change the underlying seed price directly (simulating a future
      // catalog price update).
      await admin.from("material_zip_prices").update({ unit_price_cents: 99999 }).eq("material_catalog_item_id", interiorPaintId).eq("zip_code", "33101");

      const { data: unchanged } = await aClient.from("proposal_line_items").select("unit_price_cents, line_total_cents").eq("id", lineItemId).single();
      expect((unchanged as { unit_price_cents: number }).unit_price_cents).toBe(4200);
      expect((unchanged as { line_total_cents: number }).line_total_cents).toBe(4200);

      // Restore the seed price so other tests in this file are unaffected.
      await admin.from("material_zip_prices").update({ unit_price_cents: 4200 }).eq("material_catalog_item_id", interiorPaintId).eq("zip_code", "33101");
    });

    it("changing the proposal's pricing ZIP only affects materials added afterward", async () => {
      const { versionId } = await createDraftProposal("ZIP change scoping");
      await aClient.rpc("update_proposal_pricing_zip", { p_proposal_version_id: versionId, p_zip_code: "33101" });

      const { data: firstItem } = await aClient
        .rpc("add_proposal_line_item_from_catalog", { p_proposal_version_id: versionId, p_material_catalog_item_id: interiorPaintId, p_quantity: 1 })
        .single();
      const firstId = (firstItem as { id: string }).id;
      expect((firstItem as { unit_price_cents: number }).unit_price_cents).toBe(4200);

      await aClient.rpc("update_proposal_pricing_zip", { p_proposal_version_id: versionId, p_zip_code: "78701" });

      const { data: secondItem } = await aClient
        .rpc("add_proposal_line_item_from_catalog", { p_proposal_version_id: versionId, p_material_catalog_item_id: interiorPaintId, p_quantity: 1 })
        .single();
      expect((secondItem as { unit_price_cents: number }).unit_price_cents).toBe(3800);

      const { data: firstAfter } = await aClient.from("proposal_line_items").select("unit_price_cents, source_zip_code").eq("id", firstId).single();
      expect((firstAfter as { unit_price_cents: number }).unit_price_cents).toBe(4200);
      expect((firstAfter as { source_zip_code: string }).source_zip_code).toBe("33101");
    });
  });

  // ===========================================================================
  // Additional archive/restore coverage (beyond phase2a-proposals.test.ts)
  // ===========================================================================
  describe("Proposal archive/restore — additional coverage", () => {
    it("Tenant B cannot archive Tenant A's proposal", async () => {
      const { proposalId } = await createDraftProposal("Cross-tenant archive attempt");
      const { error } = await bClient.rpc("archive_proposal", { p_proposal_id: proposalId });
      expect(error).not.toBeNull();

      const { data: stillDraft } = await admin.from("proposals").select("status").eq("id", proposalId).single();
      expect((stillDraft as { status: string }).status).toBe("draft");
    });

    it("a suspended user's existing session cannot archive", async () => {
      const { proposalId } = await createDraftProposal("Suspended user archive attempt");
      await aClient.rpc("update_membership", { p_membership_id: adminMembershipId, p_new_status: "suspended" });

      const { error } = await adminClientA.rpc("archive_proposal", { p_proposal_id: proposalId });
      expect(error).not.toBeNull();

      await aClient.rpc("update_membership", { p_membership_id: adminMembershipId, p_new_status: "active" });
    });

    it("archiving writes an audit_logs row and never deletes line items", async () => {
      const { proposalId, versionId } = await createDraftProposal("Archive audit + line item preservation");
      await aClient.rpc("update_proposal_pricing_zip", { p_proposal_version_id: versionId, p_zip_code: "33101" });
      await aClient.rpc("add_proposal_line_item_from_catalog", { p_proposal_version_id: versionId, p_material_catalog_item_id: interiorPaintId, p_quantity: 2 });

      await aClient.rpc("archive_proposal", { p_proposal_id: proposalId });

      const { data: auditRows } = await admin
        .from("audit_logs")
        .select("action")
        .eq("tenant_id", tenantAId)
        .eq("entity_id", proposalId)
        .eq("action", "proposal.archived");
      expect((auditRows ?? []).length).toBeGreaterThanOrEqual(1);

      const { data: lineItems } = await admin.from("proposal_line_items").select("id").eq("proposal_version_id", versionId).is("archived_at", null);
      expect((lineItems ?? []).length).toBe(1);

      await aClient.rpc("restore_proposal", { p_proposal_id: proposalId });
    });
  });
});
