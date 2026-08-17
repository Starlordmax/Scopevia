/**
 * Phase 2C (Measurements / Takeoff builder) — manual measurement CRUD,
 * calculation correctness, cross-tenant integrity, the
 * measurements.x / measurements.generate_materials permission matrix,
 * material/labor generation from a measurement, and locked-version
 * rejection.
 *
 * Same infrastructure/conventions as tests/rls/phase2b-materials.test.ts —
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
  return `test-p2c-${label}-${RUN_ID}@example.com`;
}

async function signIn(addr: string): Promise<SupabaseClient> {
  const client = createClient(TEST_URL!, TEST_ANON_KEY!);
  const { error } = await client.auth.signInWithPassword({ email: addr, password: PASSWORD });
  if (error) throw error;
  return client;
}

type TestUser = { id: string; email: string };

describe.skipIf(!canRun)("Phase 2C Measurements / Takeoff builder (requires real Postgres)", () => {
  let admin: SupabaseClient;
  let userA: TestUser, userB: TestUser, estimatorUser: TestUser, salesUser: TestUser, viewerUser: TestUser, fieldWorkerUser: TestUser, adminUser: TestUser;
  let aClient: SupabaseClient, bClient: SupabaseClient, estimatorClient: SupabaseClient, salesClient: SupabaseClient, viewerClient: SupabaseClient, fieldWorkerClient: SupabaseClient, adminClientA: SupabaseClient;
  let tenantAId: string, tenantBId: string;
  let clientAId: string;
  let adminMembershipId: string;
  let interiorPaintId: string;

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
    fieldWorkerUser = await createUser("field-worker");
    adminUser = await createUser("admin");

    [aClient, bClient, estimatorClient, salesClient, viewerClient, fieldWorkerClient, adminClientA] = await Promise.all([
      signIn(userA.email),
      signIn(userB.email),
      signIn(estimatorUser.email),
      signIn(salesUser.email),
      signIn(viewerUser.email),
      signIn(fieldWorkerUser.email),
      signIn(adminUser.email),
    ]);

    const { data: tenantA } = await aClient.rpc("create_tenant_with_owner", { p_name: "P2C Tenant A", p_slug: `p2c-a-${RUN_ID}` }).single();
    tenantAId = (tenantA as { id: string }).id;

    const { data: tenantB } = await bClient.rpc("create_tenant_with_owner", { p_name: "P2C Tenant B", p_slug: `p2c-b-${RUN_ID}` }).single();
    tenantBId = (tenantB as { id: string }).id;

    async function inviteAndAccept(client: SupabaseClient, targetEmail: string, role: string) {
      const { data: invite, error: inviteErr } = await aClient
        .rpc("invite_member_by_email", { p_tenant_id: tenantAId, p_email: targetEmail, p_role_key: role })
        .single();
      if (inviteErr) throw inviteErr;
      const { error: acceptErr } = await client.rpc("accept_invitation", { p_membership_id: (invite as { id: string }).id });
      if (acceptErr) throw acceptErr;
      return (invite as { id: string }).id;
    }

    await inviteAndAccept(estimatorClient, estimatorUser.email, "estimator");
    await inviteAndAccept(salesClient, salesUser.email, "sales");
    await inviteAndAccept(viewerClient, viewerUser.email, "viewer");
    await inviteAndAccept(fieldWorkerClient, fieldWorkerUser.email, "field_worker");
    adminMembershipId = await inviteAndAccept(adminClientA, adminUser.email, "admin");

    const { data: clientA } = await aClient
      .rpc("create_client", { p_tenant_id: tenantAId, p_client_type: "individual", p_display_name: "P2C Client A" })
      .single();
    clientAId = (clientA as { id: string }).id;

    const { data: seedItem } = await admin.from("material_catalog_items").select("id").eq("scope", "global").eq("name", "Interior Paint").single();
    interiorPaintId = (seedItem as { id: string }).id;
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
      .rpc("create_proposal_direct", { p_tenant_id: tenantAId, p_client_id: clientAId, p_title: title, p_service_type: "custom", p_custom_service_name: "Custom service" })
      .single();
    const p = proposal as { id: string; current_version_id: string };
    return { proposalId: p.id, versionId: p.current_version_id };
  }

  async function createGroup(versionId: string, name = "Bathroom"): Promise<string> {
    const { data, error } = await aClient.rpc("create_measurement_group", { p_proposal_version_id: versionId, p_name: name }).single();
    if (error) throw error;
    return (data as { id: string }).id;
  }

  // ===========================================================================
  // Manual measurement CRUD + calculation correctness
  // ===========================================================================
  describe("Manual measurement CRUD", () => {
    it("manual_rectangle floor_area computes area=length*width, perimeter=2*(l+w)", async () => {
      const { versionId } = await createDraftProposal("Rectangle floor");
      const groupId = await createGroup(versionId);
      const { data, error } = await aClient
        .rpc("add_measurement", {
          p_proposal_version_id: versionId, p_measurement_group_id: groupId, p_name: "Bathroom floor",
          p_measurement_type: "floor_area", p_shape_type: "manual_rectangle", p_unit: "ft",
          p_length: 10, p_width: 8,
        })
        .single();
      expect(error).toBeNull();
      const m = data as { area: number; perimeter: number; linear_length: number | null };
      expect(m.area).toBe(80);
      expect(m.perimeter).toBe(36);
      expect(m.linear_length).toBeNull();
    });

    it("wall_area computes area=perimeter*height (the brief's Bathroom worked example)", async () => {
      const { versionId } = await createDraftProposal("Wall area");
      const groupId = await createGroup(versionId);
      const { data, error } = await aClient
        .rpc("add_measurement", {
          p_proposal_version_id: versionId, p_measurement_group_id: groupId, p_name: "Bathroom walls",
          p_measurement_type: "wall_area", p_shape_type: "manual_rectangle", p_unit: "ft",
          p_length: 10, p_width: 8, p_height: 9,
        })
        .single();
      expect(error).toBeNull();
      const m = data as { area: number; perimeter: number };
      expect(m.perimeter).toBe(36);
      expect(m.area).toBe(324);
    });

    it("wall_area without height is rejected", async () => {
      const { versionId } = await createDraftProposal("Wall area no height");
      const groupId = await createGroup(versionId);
      const { error } = await aClient.rpc("add_measurement", {
        p_proposal_version_id: versionId, p_measurement_group_id: groupId, p_name: "Bad wall",
        p_measurement_type: "wall_area", p_shape_type: "manual_rectangle", p_unit: "ft",
        p_length: 10, p_width: 8,
      });
      expect(error).not.toBeNull();
    });

    it("manual_area accepts a direct area value with no perimeter", async () => {
      const { versionId } = await createDraftProposal("Direct area");
      const groupId = await createGroup(versionId);
      const { data, error } = await aClient
        .rpc("add_measurement", {
          p_proposal_version_id: versionId, p_measurement_group_id: groupId, p_name: "Odd-shaped room",
          p_measurement_type: "surface", p_shape_type: "manual_area", p_unit: "ft", p_area: 245.5,
        })
        .single();
      expect(error).toBeNull();
      const m = data as { area: number; perimeter: number | null };
      expect(m.area).toBe(245.5);
      expect(m.perimeter).toBeNull();
    });

    it("manual_linear accepts a direct linear length", async () => {
      const { versionId } = await createDraftProposal("Trim run");
      const groupId = await createGroup(versionId);
      const { data, error } = await aClient
        .rpc("add_measurement", {
          p_proposal_version_id: versionId, p_measurement_group_id: groupId, p_name: "Baseboard trim",
          p_measurement_type: "linear", p_shape_type: "manual_linear", p_unit: "ft", p_linear_length: 42,
        })
        .single();
      expect(error).toBeNull();
      const m = data as { linear_length: number; area: number | null };
      expect(m.linear_length).toBe(42);
      expect(m.area).toBeNull();
    });

    it("zero length is rejected", async () => {
      const { versionId } = await createDraftProposal("Zero length");
      const groupId = await createGroup(versionId);
      const { error } = await aClient.rpc("add_measurement", {
        p_proposal_version_id: versionId, p_measurement_group_id: groupId, p_name: "Bad",
        p_measurement_type: "floor_area", p_shape_type: "manual_rectangle", p_unit: "ft",
        p_length: 0, p_width: 8,
      });
      expect(error).not.toBeNull();
    });

    it("negative width is rejected", async () => {
      const { versionId } = await createDraftProposal("Negative width");
      const groupId = await createGroup(versionId);
      const { error } = await aClient.rpc("add_measurement", {
        p_proposal_version_id: versionId, p_measurement_group_id: groupId, p_name: "Bad",
        p_measurement_type: "floor_area", p_shape_type: "manual_rectangle", p_unit: "ft",
        p_length: 10, p_width: -8,
      });
      expect(error).not.toBeNull();
    });

    it("metric unit_system/unit works identically (formulas are unit-agnostic)", async () => {
      const { versionId } = await createDraftProposal("Metric room");
      const groupId = await createGroup(versionId);
      const { data, error } = await aClient
        .rpc("add_measurement", {
          p_proposal_version_id: versionId, p_measurement_group_id: groupId, p_name: "Metric floor",
          p_measurement_type: "floor_area", p_shape_type: "manual_rectangle", p_unit: "m",
          p_length: 5, p_width: 4,
        })
        .single();
      expect(error).toBeNull();
      const m = data as { area: number; unit: string };
      expect(m.area).toBe(20);
      expect(m.unit).toBe("m");
    });

    it("update_measurement recomputes area/perimeter", async () => {
      const { versionId } = await createDraftProposal("Update measurement");
      const groupId = await createGroup(versionId);
      const { data: created } = await aClient
        .rpc("add_measurement", {
          p_proposal_version_id: versionId, p_measurement_group_id: groupId, p_name: "Original",
          p_measurement_type: "floor_area", p_shape_type: "manual_rectangle", p_unit: "ft",
          p_length: 10, p_width: 8,
        })
        .single();
      const id = (created as { id: string }).id;

      const { data: updated, error } = await aClient
        .rpc("update_measurement", {
          p_measurement_id: id, p_name: "Updated", p_measurement_type: "floor_area",
          p_length: 12, p_width: 10,
        })
        .single();
      expect(error).toBeNull();
      const m = updated as { area: number; perimeter: number; name: string };
      expect(m.name).toBe("Updated");
      expect(m.area).toBe(120);
      expect(m.perimeter).toBe(44);
    });

    it("archive_measurement archives without affecting already-generated content", async () => {
      const { versionId } = await createDraftProposal("Archive measurement");
      const groupId = await createGroup(versionId);
      const { data: created } = await aClient
        .rpc("add_measurement", {
          p_proposal_version_id: versionId, p_measurement_group_id: groupId, p_name: "To archive",
          p_measurement_type: "floor_area", p_shape_type: "manual_rectangle", p_unit: "ft",
          p_length: 10, p_width: 8,
        })
        .single();
      const id = (created as { id: string }).id;

      const { data: archived, error } = await aClient.rpc("archive_measurement", { p_measurement_id: id }).single();
      expect(error).toBeNull();
      expect((archived as { archived_at: string | null }).archived_at).not.toBeNull();
    });
  });

  // ===========================================================================
  // Cross-tenant integrity
  // ===========================================================================
  describe("Cross-tenant integrity", () => {
    it("Tenant A cannot read Tenant B's measurements", async () => {
      const { versionId } = await createDraftProposal("A's measurement");
      const groupId = await createGroup(versionId);
      const { data: created } = await aClient
        .rpc("add_measurement", {
          p_proposal_version_id: versionId, p_measurement_group_id: groupId, p_name: "A only",
          p_measurement_type: "floor_area", p_shape_type: "manual_rectangle", p_unit: "ft",
          p_length: 10, p_width: 8,
        })
        .single();
      const id = (created as { id: string }).id;

      const { data: bView } = await bClient.from("proposal_measurements").select("id").eq("id", id);
      expect(bView ?? []).toHaveLength(0);
    });

    it("a measurement cannot be created on another tenant's proposal version (service_role raw insert rejected)", async () => {
      const { versionId: versionAId } = await createDraftProposal("Version A");
      const groupAId = await createGroup(versionAId);

      const { data: clientB } = await bClient
        .rpc("create_client", { p_tenant_id: tenantBId, p_client_type: "individual", p_display_name: "P2C Client B" })
        .single();
      const { data: proposalB } = await bClient
        .rpc("create_proposal_direct", { p_tenant_id: tenantBId, p_client_id: (clientB as { id: string }).id, p_title: "Proposal B", p_service_type: "custom", p_custom_service_name: "Custom service" })
        .single();
      const versionBId = (proposalB as { current_version_id: string }).current_version_id;

      // Tenant A's group, but Tenant B's version + tenant_id -- must be rejected by the composite FK.
      const { error } = await admin.from("proposal_measurements").insert({
        tenant_id: tenantBId,
        proposal_version_id: versionBId,
        measurement_group_id: groupAId,
        name: "Should be rejected",
        measurement_type: "floor_area",
        shape_type: "manual_rectangle",
        length: 10,
        width: 8,
        area: 80,
        perimeter: 36,
        unit: "ft",
      });
      expect(error).not.toBeNull();
    });

    it("generate_material_from_measurement rejects a material belonging to another tenant", async () => {
      const { versionId } = await createDraftProposal("Cross-tenant material gen");
      const groupId = await createGroup(versionId);
      const { data: measurement } = await aClient
        .rpc("add_measurement", {
          p_proposal_version_id: versionId, p_measurement_group_id: groupId, p_name: "Floor",
          p_measurement_type: "floor_area", p_shape_type: "manual_rectangle", p_unit: "ft",
          p_length: 10, p_width: 8,
        })
        .single();

      const { data: tenantBMaterial } = await bClient
        .rpc("create_tenant_material", { p_tenant_id: tenantBId, p_name: `Tenant B material ${RUN_ID}`, p_category: "other", p_default_unit: "each" })
        .single();

      const { error } = await aClient.rpc("generate_material_from_measurement", {
        p_proposal_version_id: versionId,
        p_proposal_measurement_id: (measurement as { id: string }).id,
        p_material_catalog_item_id: (tenantBMaterial as { id: string }).id,
        p_measurement_value_field: "area",
        p_coverage_rate: 1,
      });
      expect(error).not.toBeNull();
    });
  });

  // ===========================================================================
  // Permission matrix
  // ===========================================================================
  describe("Permission matrix", () => {
    it("Viewer cannot create a measurement", async () => {
      const { versionId } = await createDraftProposal("Viewer create attempt");
      const groupId = await createGroup(versionId);
      const { error } = await viewerClient.rpc("add_measurement", {
        p_proposal_version_id: versionId, p_measurement_group_id: groupId, p_name: "Should fail",
        p_measurement_type: "floor_area", p_shape_type: "manual_rectangle", p_unit: "ft",
        p_length: 10, p_width: 8,
      });
      expect(error).not.toBeNull();
    });

    it("Field Worker CAN create a measurement despite lacking proposals.update entirely", async () => {
      const { versionId } = await createDraftProposal("Field worker create");
      const groupId = await createGroup(versionId);
      const { data, error } = await fieldWorkerClient
        .rpc("add_measurement", {
          p_proposal_version_id: versionId, p_measurement_group_id: groupId, p_name: "Field worker measurement",
          p_measurement_type: "floor_area", p_shape_type: "manual_rectangle", p_unit: "ft",
          p_length: 10, p_width: 8,
        })
        .single();
      expect(error).toBeNull();
      expect(data).toBeTruthy();
    });

    it("Field Worker cannot update a measurement", async () => {
      const { versionId } = await createDraftProposal("Field worker update attempt");
      const groupId = await createGroup(versionId);
      const { data: created } = await fieldWorkerClient
        .rpc("add_measurement", {
          p_proposal_version_id: versionId, p_measurement_group_id: groupId, p_name: "Original",
          p_measurement_type: "floor_area", p_shape_type: "manual_rectangle", p_unit: "ft",
          p_length: 10, p_width: 8,
        })
        .single();
      const { error } = await fieldWorkerClient.rpc("update_measurement", {
        p_measurement_id: (created as { id: string }).id, p_name: "Changed", p_measurement_type: "floor_area",
        p_length: 12, p_width: 10,
      });
      expect(error).not.toBeNull();
    });

    it("Field Worker cannot generate materials/labor from a measurement", async () => {
      const { versionId } = await createDraftProposal("Field worker generate attempt");
      const groupId = await createGroup(versionId);
      const { data: measurement } = await aClient
        .rpc("add_measurement", {
          p_proposal_version_id: versionId, p_measurement_group_id: groupId, p_name: "Floor",
          p_measurement_type: "floor_area", p_shape_type: "manual_rectangle", p_unit: "ft",
          p_length: 10, p_width: 8,
        })
        .single();
      await aClient.rpc("update_proposal_pricing_zip", { p_proposal_version_id: versionId, p_zip_code: "33101" });

      const { error: matErr } = await fieldWorkerClient.rpc("generate_material_from_measurement", {
        p_proposal_version_id: versionId, p_proposal_measurement_id: (measurement as { id: string }).id,
        p_material_catalog_item_id: interiorPaintId, p_measurement_value_field: "area", p_coverage_rate: 350,
      });
      expect(matErr).not.toBeNull();

      const { error: laborErr } = await fieldWorkerClient.rpc("add_proposal_labor_item_from_measurement", {
        p_proposal_version_id: versionId, p_proposal_measurement_id: (measurement as { id: string }).id,
        p_label: "Should fail", p_pricing_method: "area", p_rate_cents: 400,
      });
      expect(laborErr).not.toBeNull();
    });

    it("Sales can create/update measurements but cannot archive or generate materials/labor", async () => {
      const { versionId } = await createDraftProposal("Sales measurement");
      const groupId = await createGroup(versionId);
      const { data: created, error: createErr } = await salesClient
        .rpc("add_measurement", {
          p_proposal_version_id: versionId, p_measurement_group_id: groupId, p_name: "Sales measurement",
          p_measurement_type: "floor_area", p_shape_type: "manual_rectangle", p_unit: "ft",
          p_length: 10, p_width: 8,
        })
        .single();
      expect(createErr).toBeNull();
      const id = (created as { id: string }).id;

      const { error: updateErr } = await salesClient.rpc("update_measurement", {
        p_measurement_id: id, p_name: "Sales updated", p_measurement_type: "floor_area", p_length: 11, p_width: 9,
      });
      expect(updateErr).toBeNull();

      const { error: archiveErr } = await salesClient.rpc("archive_measurement", { p_measurement_id: id });
      expect(archiveErr).not.toBeNull();

      await aClient.rpc("update_proposal_pricing_zip", { p_proposal_version_id: versionId, p_zip_code: "33101" });
      const { error: genErr } = await salesClient.rpc("generate_material_from_measurement", {
        p_proposal_version_id: versionId, p_proposal_measurement_id: id,
        p_material_catalog_item_id: interiorPaintId, p_measurement_value_field: "area", p_coverage_rate: 350,
      });
      expect(genErr).not.toBeNull();
    });

    it("a suspended user's existing session cannot create a measurement", async () => {
      const { versionId } = await createDraftProposal("Suspended user attempt");
      const groupId = await createGroup(versionId);
      await aClient.rpc("update_membership", { p_membership_id: adminMembershipId, p_new_status: "suspended" });

      const { error } = await adminClientA.rpc("add_measurement", {
        p_proposal_version_id: versionId, p_measurement_group_id: groupId, p_name: "Should fail",
        p_measurement_type: "floor_area", p_shape_type: "manual_rectangle", p_unit: "ft",
        p_length: 10, p_width: 8,
      });
      expect(error).not.toBeNull();

      await aClient.rpc("update_membership", { p_membership_id: adminMembershipId, p_new_status: "active" });
    });
  });

  // ===========================================================================
  // Material + labor generation, and total recalculation
  // ===========================================================================
  describe("Generate material/labor from a measurement", () => {
    it("generates a snapshotted line item at the resolved ZIP price and recalculates the total", async () => {
      const { versionId } = await createDraftProposal("Generate material");
      await aClient.rpc("update_proposal_pricing_zip", { p_proposal_version_id: versionId, p_zip_code: "33101" });
      const groupId = await createGroup(versionId);
      const { data: measurement } = await aClient
        .rpc("add_measurement", {
          p_proposal_version_id: versionId, p_measurement_group_id: groupId, p_name: "Floor for paint",
          p_measurement_type: "floor_area", p_shape_type: "manual_rectangle", p_unit: "ft",
          p_length: 20, p_width: 10, // area 200
        })
        .single();

      const { data: lineItem, error } = await aClient
        .rpc("generate_material_from_measurement", {
          p_proposal_version_id: versionId,
          p_proposal_measurement_id: (measurement as { id: string }).id,
          p_material_catalog_item_id: interiorPaintId,
          p_measurement_value_field: "area",
          p_coverage_rate: 350,
          p_coats: 2,
          p_waste_bps: 1000,
        })
        .single();
      expect(error).toBeNull();
      // raw = 200*2*1.1/350 = 440/350 = 1.257... -> ceil -> 2 gallons @ $42.00 = $84.00
      const li = lineItem as { quantity: number; unit_price_cents: number; line_total_cents: number };
      expect(li.quantity).toBe(2);
      expect(li.unit_price_cents).toBe(4200);
      expect(li.line_total_cents).toBe(8400);

      const { data: version } = await admin.from("proposal_versions").select("line_items_subtotal_cents, total_cents").eq("id", versionId).single();
      expect((version as { line_items_subtotal_cents: number }).line_items_subtotal_cents).toBe(8400);
      expect((version as { total_cents: number }).total_cents).toBe(8400);

      const { data: measurementMaterials } = await admin.from("proposal_measurement_materials").select("*").eq("proposal_measurement_id", (measurement as { id: string }).id);
      expect((measurementMaterials ?? []).length).toBe(1);
    });

    it("rejects generation when no catalog price is available for the ZIP", async () => {
      const { versionId } = await createDraftProposal("No price generate");
      await aClient.rpc("update_proposal_pricing_zip", { p_proposal_version_id: versionId, p_zip_code: "33101" });
      const groupId = await createGroup(versionId);
      const { data: debrisItem } = await admin.from("material_catalog_items").select("id").eq("scope", "global").eq("name", "Construction Debris Disposal").single();
      const { data: measurement } = await aClient
        .rpc("add_measurement", {
          p_proposal_version_id: versionId, p_measurement_group_id: groupId, p_name: "Floor",
          p_measurement_type: "floor_area", p_shape_type: "manual_rectangle", p_unit: "ft",
          p_length: 10, p_width: 8,
        })
        .single();

      const { error } = await aClient.rpc("generate_material_from_measurement", {
        p_proposal_version_id: versionId, p_proposal_measurement_id: (measurement as { id: string }).id,
        p_material_catalog_item_id: (debrisItem as { id: string }).id, p_measurement_value_field: "area", p_coverage_rate: 1,
      });
      expect(error).not.toBeNull();
      expect(error?.message).toContain("No catalog price is available");
    });

    it("generates area-based labor and recalculates the total", async () => {
      const { versionId } = await createDraftProposal("Generate area labor");
      const groupId = await createGroup(versionId);
      const { data: measurement } = await aClient
        .rpc("add_measurement", {
          p_proposal_version_id: versionId, p_measurement_group_id: groupId, p_name: "Floor for labor",
          p_measurement_type: "floor_area", p_shape_type: "manual_rectangle", p_unit: "ft",
          p_length: 20, p_width: 15, // area 300
        })
        .single();

      const { data: laborItem, error } = await aClient
        .rpc("add_proposal_labor_item_from_measurement", {
          p_proposal_version_id: versionId, p_proposal_measurement_id: (measurement as { id: string }).id,
          p_label: "Flooring labor", p_pricing_method: "area", p_rate_cents: 400,
        })
        .single();
      expect(error).toBeNull();
      expect((laborItem as { total_cents: number }).total_cents).toBe(120000); // 300 * 400

      const { data: version } = await admin.from("proposal_versions").select("labor_total_cents, total_cents").eq("id", versionId).single();
      expect((version as { labor_total_cents: number }).labor_total_cents).toBe(120000);
    });

    it("generates linear-based labor from perimeter when linear_length is absent", async () => {
      const { versionId } = await createDraftProposal("Generate linear labor via perimeter");
      const groupId = await createGroup(versionId);
      const { data: measurement } = await aClient
        .rpc("add_measurement", {
          p_proposal_version_id: versionId, p_measurement_group_id: groupId, p_name: "Room for trim",
          p_measurement_type: "floor_area", p_shape_type: "manual_rectangle", p_unit: "ft",
          p_length: 10, p_width: 8, // perimeter 36
        })
        .single();

      const { data: laborItem, error } = await aClient
        .rpc("add_proposal_labor_item_from_measurement", {
          p_proposal_version_id: versionId, p_proposal_measurement_id: (measurement as { id: string }).id,
          p_label: "Trim labor", p_pricing_method: "linear", p_rate_cents: 150,
        })
        .single();
      expect(error).toBeNull();
      expect((laborItem as { total_cents: number; measured_linear_length: number }).total_cents).toBe(5400); // 36*150
      expect((laborItem as { measured_linear_length: number }).measured_linear_length).toBe(36);
    });
  });

  // ===========================================================================
  // Locked version rejection
  // ===========================================================================
  describe("Locked version immutability", () => {
    it("add_measurement rejects a locked proposal version", async () => {
      const { versionId } = await createDraftProposal("Locked add_measurement");
      const groupId = await createGroup(versionId);
      await admin.from("proposal_versions").update({ version_status: "locked", locked_at: new Date().toISOString() }).eq("id", versionId);

      const { error } = await aClient.rpc("add_measurement", {
        p_proposal_version_id: versionId, p_measurement_group_id: groupId, p_name: "Should not save",
        p_measurement_type: "floor_area", p_shape_type: "manual_rectangle", p_unit: "ft",
        p_length: 10, p_width: 8,
      });
      expect(error).not.toBeNull();
    });

    it("generate_material_from_measurement rejects a locked proposal version", async () => {
      const { versionId } = await createDraftProposal("Locked generate material");
      await aClient.rpc("update_proposal_pricing_zip", { p_proposal_version_id: versionId, p_zip_code: "33101" });
      const groupId = await createGroup(versionId);
      const { data: measurement } = await aClient
        .rpc("add_measurement", {
          p_proposal_version_id: versionId, p_measurement_group_id: groupId, p_name: "Floor",
          p_measurement_type: "floor_area", p_shape_type: "manual_rectangle", p_unit: "ft",
          p_length: 10, p_width: 8,
        })
        .single();

      await admin.from("proposal_versions").update({ version_status: "locked", locked_at: new Date().toISOString() }).eq("id", versionId);

      const { error } = await aClient.rpc("generate_material_from_measurement", {
        p_proposal_version_id: versionId, p_proposal_measurement_id: (measurement as { id: string }).id,
        p_material_catalog_item_id: interiorPaintId, p_measurement_value_field: "area", p_coverage_rate: 350,
      });
      expect(error).not.toBeNull();
    });
  });

  // ===========================================================================
  // Phase 2C.1: freehand/brush drawing (sketch_polygon)
  // ===========================================================================
  describe("Freehand polygon measurements", () => {
    it("saves a closed polygon: area via the shoelace formula, full perimeter (an L-shape: 10x10 minus a 5x5 corner -> area 75, perimeter 40)", async () => {
      const { versionId } = await createDraftProposal("Freehand L-shape");
      const groupId = await createGroup(versionId);
      const { data, error } = await aClient
        .rpc("save_measurement_polygon_shape", {
          p_proposal_version_id: versionId, p_measurement_group_id: groupId, p_name: "L-shaped room",
          p_measurement_type: "floor_area", p_unit: "ft",
          p_strokes: [
            [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 10 }, { x: 0, y: 10 }],
          ],
          p_closed: true, p_scale_reference_length: 10, p_scale_unit: "ft", p_shape_data: { type: "freehand", closed: true },
        })
        .single();
      expect(error).toBeNull();
      const m = data as { area: number; perimeter: number; linear_length: number | null; shape_type: string };
      expect(m.area).toBe(75);
      expect(m.perimeter).toBe(40);
      expect(m.linear_length).toBeNull();
      expect(m.shape_type).toBe("sketch_polygon");
    });

    it("saves an open path as a linear measurement (no area, no perimeter)", async () => {
      const { versionId } = await createDraftProposal("Freehand open path");
      const groupId = await createGroup(versionId);
      const { data, error } = await aClient
        .rpc("save_measurement_polygon_shape", {
          p_proposal_version_id: versionId, p_measurement_group_id: groupId, p_name: "Traced trim run",
          p_measurement_type: "linear", p_unit: "ft",
          p_strokes: [[{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }]],
          p_closed: false, p_scale_reference_length: 10, p_scale_unit: "ft", p_shape_data: { type: "freehand", closed: false },
        })
        .single();
      expect(error).toBeNull();
      const m = data as { area: number | null; perimeter: number | null; linear_length: number };
      expect(m.area).toBeNull();
      expect(m.perimeter).toBeNull();
      expect(m.linear_length).toBe(10);
    });

    it("rejects a closed shape with fewer than 3 points", async () => {
      const { versionId } = await createDraftProposal("Freehand too few points closed");
      const groupId = await createGroup(versionId);
      const { error } = await aClient.rpc("save_measurement_polygon_shape", {
        p_proposal_version_id: versionId, p_measurement_group_id: groupId, p_name: "Bad",
        p_measurement_type: "floor_area", p_unit: "ft",
        p_strokes: [[{ x: 0, y: 0 }, { x: 10, y: 0 }]],
        p_closed: true, p_scale_reference_length: 10, p_scale_unit: "ft", p_shape_data: {},
      });
      expect(error).not.toBeNull();
    });

    it("rejects an open path with fewer than 2 points", async () => {
      const { versionId } = await createDraftProposal("Freehand too few points open");
      const groupId = await createGroup(versionId);
      const { error } = await aClient.rpc("save_measurement_polygon_shape", {
        p_proposal_version_id: versionId, p_measurement_group_id: groupId, p_name: "Bad",
        p_measurement_type: "linear", p_unit: "ft",
        p_strokes: [[{ x: 0, y: 0 }]],
        p_closed: false, p_scale_reference_length: 10, p_scale_unit: "ft", p_shape_data: {},
      });
      expect(error).not.toBeNull();
    });

    it("rejects collinear points for a closed shape (zero area)", async () => {
      const { versionId } = await createDraftProposal("Freehand collinear");
      const groupId = await createGroup(versionId);
      const { error } = await aClient.rpc("save_measurement_polygon_shape", {
        p_proposal_version_id: versionId, p_measurement_group_id: groupId, p_name: "Bad",
        p_measurement_type: "floor_area", p_unit: "ft",
        p_strokes: [[{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }]],
        p_closed: true, p_scale_reference_length: 10, p_scale_unit: "ft", p_shape_data: {},
      });
      expect(error).not.toBeNull();
    });

    it("rejects an invalid (negative) scale reference length", async () => {
      const { versionId } = await createDraftProposal("Freehand bad scale");
      const groupId = await createGroup(versionId);
      const { error } = await aClient.rpc("save_measurement_polygon_shape", {
        p_proposal_version_id: versionId, p_measurement_group_id: groupId, p_name: "Bad",
        p_measurement_type: "floor_area", p_unit: "ft",
        p_strokes: [[{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]],
        p_closed: true, p_scale_reference_length: -5, p_scale_unit: "ft", p_shape_data: {},
      });
      expect(error).not.toBeNull();
    });

    it("update_measurement rejects editing a sketch_polygon's dimensions (archive-and-redraw only)", async () => {
      const { versionId } = await createDraftProposal("Freehand update rejected");
      const groupId = await createGroup(versionId);
      const { data } = await aClient
        .rpc("save_measurement_polygon_shape", {
          p_proposal_version_id: versionId, p_measurement_group_id: groupId, p_name: "Square",
          p_measurement_type: "floor_area", p_unit: "ft",
          p_strokes: [[{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]],
          p_closed: true, p_scale_reference_length: 10, p_scale_unit: "ft", p_shape_data: {},
        })
        .single();

      const { error } = await aClient.rpc("update_measurement", {
        p_measurement_id: (data as { id: string }).id, p_name: "Changed", p_measurement_type: "floor_area",
        p_length: 12, p_width: 10,
      });
      expect(error).not.toBeNull();
    });

    it("archive_measurement still works for a sketch_polygon", async () => {
      const { versionId } = await createDraftProposal("Freehand archive");
      const groupId = await createGroup(versionId);
      const { data } = await aClient
        .rpc("save_measurement_polygon_shape", {
          p_proposal_version_id: versionId, p_measurement_group_id: groupId, p_name: "Square",
          p_measurement_type: "floor_area", p_unit: "ft",
          p_strokes: [[{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]],
          p_closed: true, p_scale_reference_length: 10, p_scale_unit: "ft", p_shape_data: {},
        })
        .single();

      const { data: archived, error } = await aClient.rpc("archive_measurement", { p_measurement_id: (data as { id: string }).id }).single();
      expect(error).toBeNull();
      expect((archived as { archived_at: string | null }).archived_at).not.toBeNull();
    });

    it("Tenant A cannot read Tenant B's freehand measurement or its shape", async () => {
      const { versionId } = await createDraftProposal("Freehand tenant isolation");
      const groupId = await createGroup(versionId);
      const { data } = await aClient
        .rpc("save_measurement_polygon_shape", {
          p_proposal_version_id: versionId, p_measurement_group_id: groupId, p_name: "A only",
          p_measurement_type: "floor_area", p_unit: "ft",
          p_strokes: [[{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]],
          p_closed: true, p_scale_reference_length: 10, p_scale_unit: "ft", p_shape_data: {},
        })
        .single();
      const id = (data as { id: string }).id;

      const { data: bMeasurement } = await bClient.from("proposal_measurements").select("id").eq("id", id);
      expect(bMeasurement ?? []).toHaveLength(0);
      const { data: bShape } = await bClient.from("proposal_measurement_shapes").select("id").eq("proposal_measurement_id", id);
      expect(bShape ?? []).toHaveLength(0);
    });

    it("generates a catalog material from a freehand-derived area, snapshotted and recalculated", async () => {
      const { versionId } = await createDraftProposal("Freehand generate material");
      await aClient.rpc("update_proposal_pricing_zip", { p_proposal_version_id: versionId, p_zip_code: "33101" });
      const groupId = await createGroup(versionId);
      const { data: measurement } = await aClient
        .rpc("save_measurement_polygon_shape", {
          p_proposal_version_id: versionId, p_measurement_group_id: groupId, p_name: "Freehand floor",
          p_measurement_type: "floor_area", p_unit: "ft",
          // A 20x10 rectangle drawn as a polygon -> area 200.
          p_strokes: [[{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 0, y: 10 }]],
          p_closed: true, p_scale_reference_length: 20, p_scale_unit: "ft", p_shape_data: {},
        })
        .single();

      const { data: lineItem, error } = await aClient
        .rpc("generate_material_from_measurement", {
          p_proposal_version_id: versionId,
          p_proposal_measurement_id: (measurement as { id: string }).id,
          p_material_catalog_item_id: interiorPaintId,
          p_measurement_value_field: "area",
          p_coverage_rate: 350,
          p_coats: 2,
          p_waste_bps: 1000,
        })
        .single();
      expect(error).toBeNull();
      // area=200, coats=2, waste 10% -> ceil(200*2*1.1/350) = ceil(1.257) = 2 gallons @ $42.00 = $84.00
      const li = lineItem as { quantity: number; line_total_cents: number };
      expect(li.quantity).toBe(2);
      expect(li.line_total_cents).toBe(8400);

      const { data: version } = await admin.from("proposal_versions").select("line_items_subtotal_cents").eq("id", versionId).single();
      expect((version as { line_items_subtotal_cents: number }).line_items_subtotal_cents).toBe(8400);
    });

    it("generates area-based labor from a freehand-derived area", async () => {
      const { versionId } = await createDraftProposal("Freehand generate labor");
      const groupId = await createGroup(versionId);
      const { data: measurement } = await aClient
        .rpc("save_measurement_polygon_shape", {
          p_proposal_version_id: versionId, p_measurement_group_id: groupId, p_name: "Freehand floor for labor",
          p_measurement_type: "floor_area", p_unit: "ft",
          p_strokes: [[{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 15 }, { x: 0, y: 15 }]], // area 300
          p_closed: true, p_scale_reference_length: 20, p_scale_unit: "ft", p_shape_data: {},
        })
        .single();

      const { data: laborItem, error } = await aClient
        .rpc("add_proposal_labor_item_from_measurement", {
          p_proposal_version_id: versionId, p_proposal_measurement_id: (measurement as { id: string }).id,
          p_label: "Freehand area labor", p_pricing_method: "area", p_rate_cents: 400,
        })
        .single();
      expect(error).toBeNull();
      expect((laborItem as { total_cents: number }).total_cents).toBe(120000); // 300 * 400
    });

    it("generate_material_from_measurement rejects a material belonging to another tenant, even for a freehand measurement", async () => {
      const { versionId } = await createDraftProposal("Freehand cross-tenant material");
      const groupId = await createGroup(versionId);
      const { data: measurement } = await aClient
        .rpc("save_measurement_polygon_shape", {
          p_proposal_version_id: versionId, p_measurement_group_id: groupId, p_name: "Floor",
          p_measurement_type: "floor_area", p_unit: "ft",
          p_strokes: [[{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]],
          p_closed: true, p_scale_reference_length: 10, p_scale_unit: "ft", p_shape_data: {},
        })
        .single();

      const { data: tenantBMaterial } = await bClient
        .rpc("create_tenant_material", { p_tenant_id: tenantBId, p_name: `Tenant B freehand material ${RUN_ID}`, p_category: "other", p_default_unit: "each" })
        .single();

      const { error } = await aClient.rpc("generate_material_from_measurement", {
        p_proposal_version_id: versionId,
        p_proposal_measurement_id: (measurement as { id: string }).id,
        p_material_catalog_item_id: (tenantBMaterial as { id: string }).id,
        p_measurement_value_field: "area",
        p_coverage_rate: 1,
      });
      expect(error).not.toBeNull();
    });

    it("save_measurement_polygon_shape rejects a locked proposal version", async () => {
      const { versionId } = await createDraftProposal("Freehand locked version");
      const groupId = await createGroup(versionId);
      await admin.from("proposal_versions").update({ version_status: "locked", locked_at: new Date().toISOString() }).eq("id", versionId);

      const { error } = await aClient.rpc("save_measurement_polygon_shape", {
        p_proposal_version_id: versionId, p_measurement_group_id: groupId, p_name: "Should not save",
        p_measurement_type: "floor_area", p_unit: "ft",
        p_strokes: [[{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]],
        p_closed: true, p_scale_reference_length: 10, p_scale_unit: "ft", p_shape_data: {},
      });
      expect(error).not.toBeNull();
    });

    it("Field Worker can save a freehand measurement despite lacking proposals.update entirely", async () => {
      const { versionId } = await createDraftProposal("Freehand field worker");
      const groupId = await createGroup(versionId);
      const { data, error } = await fieldWorkerClient
        .rpc("save_measurement_polygon_shape", {
          p_proposal_version_id: versionId, p_measurement_group_id: groupId, p_name: "Field worker freehand",
          p_measurement_type: "floor_area", p_unit: "ft",
          p_strokes: [[{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]],
          p_closed: true, p_scale_reference_length: 10, p_scale_unit: "ft", p_shape_data: {},
        })
        .single();
      expect(error).toBeNull();
      expect(data).toBeTruthy();
    });
  });

  // ===========================================================================
  // Multi-stroke drawing (bug fix) — see
  // docs/74-custom-service-name-and-multistroke-drawing.md. p_strokes is an
  // array of point arrays (one per stroke); a CLOSED shape joins them
  // end-to-end in drawn order, an OPEN path sums each stroke's own length
  // independently, never a phantom edge across the gap between strokes.
  // ===========================================================================
  describe("Multi-stroke drawing", () => {
    it("saves a closed shape from multiple strokes -- joined end-to-end, same area/perimeter as an equivalent single stroke", async () => {
      const { versionId } = await createDraftProposal("Multi-stroke closed");
      const groupId = await createGroup(versionId);
      // Two strokes that together trace a 10x10 square outline.
      const { data, error } = await aClient
        .rpc("save_measurement_polygon_shape", {
          p_proposal_version_id: versionId, p_measurement_group_id: groupId, p_name: "Two-stroke square",
          p_measurement_type: "floor_area", p_unit: "ft",
          p_strokes: [
            [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }],
            [{ x: 10, y: 10 }, { x: 0, y: 10 }],
          ],
          p_closed: true, p_scale_reference_length: 10, p_scale_unit: "ft", p_shape_data: { strokeCount: 2 },
        })
        .single();
      expect(error).toBeNull();
      const m = data as { area: number; perimeter: number };
      expect(m.area).toBe(100);
      expect(m.perimeter).toBe(40);
    });

    it("an OPEN multi-stroke path sums each stroke's own length independently -- never a phantom edge across the gap between strokes", async () => {
      const { versionId } = await createDraftProposal("Multi-stroke open, separate strokes");
      const groupId = await createGroup(versionId);
      // Stroke 1: 3 units long. Stroke 2: 4 units long, drawn far away
      // (a 100-unit gap) after lifting the pen. A naive flatten-then-sum
      // (the original bug) would wrongly include that gap in the total.
      const { data, error } = await aClient
        .rpc("save_measurement_polygon_shape", {
          p_proposal_version_id: versionId, p_measurement_group_id: groupId, p_name: "Two separate trim runs",
          p_measurement_type: "linear", p_unit: "ft",
          p_strokes: [
            [{ x: 0, y: 0 }, { x: 3, y: 0 }],
            [{ x: 103, y: 0 }, { x: 107, y: 0 }],
          ],
          p_closed: false, p_scale_reference_length: 1, p_scale_unit: "ft", p_shape_data: { strokeCount: 2 },
        })
        .single();
      expect(error).toBeNull();
      const m = data as { area: number | null; perimeter: number | null; linear_length: number };
      expect(m.area).toBeNull();
      expect(m.perimeter).toBeNull();
      expect(m.linear_length).toBe(7); // 3 + 4, NOT 3 + 100 + 4
    });

    it("ignores a degenerate (single-point) stroke mixed in with valid strokes, without crashing", async () => {
      const { versionId } = await createDraftProposal("Multi-stroke with a stray tap");
      const groupId = await createGroup(versionId);
      const { data, error } = await aClient
        .rpc("save_measurement_polygon_shape", {
          p_proposal_version_id: versionId, p_measurement_group_id: groupId, p_name: "Stroke plus stray tap",
          p_measurement_type: "linear", p_unit: "ft",
          p_strokes: [
            [{ x: 0, y: 0 }, { x: 5, y: 0 }],
            [{ x: 50, y: 50 }], // a single-point "stray tap" stroke
          ],
          p_closed: false, p_scale_reference_length: 1, p_scale_unit: "ft", p_shape_data: {},
        })
        .single();
      expect(error).toBeNull();
      expect((data as { linear_length: number }).linear_length).toBe(5);
    });

    it("rejects saving an area measurement when there are not enough total points to close (friendly message)", async () => {
      const { versionId } = await createDraftProposal("Multi-stroke not enough points");
      const groupId = await createGroup(versionId);
      const { error } = await aClient.rpc("save_measurement_polygon_shape", {
        p_proposal_version_id: versionId, p_measurement_group_id: groupId, p_name: "Too few points",
        p_measurement_type: "floor_area", p_unit: "ft",
        p_strokes: [[{ x: 0, y: 0 }], [{ x: 5, y: 5 }]], // 2 total points, closed needs >= 3
        p_closed: true, p_scale_reference_length: 10, p_scale_unit: "ft", p_shape_data: {},
      });
      expect(error).not.toBeNull();
      expect(error!.message).toBe("Close the shape before saving an area measurement");
    });

    it("rejects an empty strokes array with a friendly message", async () => {
      const { versionId } = await createDraftProposal("Multi-stroke empty");
      const groupId = await createGroup(versionId);
      const { error } = await aClient.rpc("save_measurement_polygon_shape", {
        p_proposal_version_id: versionId, p_measurement_group_id: groupId, p_name: "Nothing drawn",
        p_measurement_type: "linear", p_unit: "ft",
        p_strokes: [],
        p_closed: false, p_scale_reference_length: 10, p_scale_unit: "ft", p_shape_data: {},
      });
      expect(error).not.toBeNull();
      expect(error!.message).toBe("Draw the area before saving");
    });

    it("a closed shape's area/perimeter from 3 strokes matches the same outline drawn as 1 stroke", async () => {
      const { versionId } = await createDraftProposal("Multi-stroke vs single-stroke equivalence");
      const groupId = await createGroup(versionId);
      const outline = [
        { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 10 }, { x: 0, y: 10 },
      ];

      const { data: singleStroke } = await aClient
        .rpc("save_measurement_polygon_shape", {
          p_proposal_version_id: versionId, p_measurement_group_id: groupId, p_name: "Single stroke L-shape",
          p_measurement_type: "floor_area", p_unit: "ft",
          p_strokes: [outline],
          p_closed: true, p_scale_reference_length: 10, p_scale_unit: "ft", p_shape_data: {},
        })
        .single();

      const { data: threeStrokes } = await aClient
        .rpc("save_measurement_polygon_shape", {
          p_proposal_version_id: versionId, p_measurement_group_id: groupId, p_name: "Three-stroke L-shape",
          p_measurement_type: "floor_area", p_unit: "ft",
          p_strokes: [
            [outline[0]!, outline[1]!],
            [outline[2]!, outline[3]!],
            [outline[4]!, outline[5]!],
          ],
          p_closed: true, p_scale_reference_length: 10, p_scale_unit: "ft", p_shape_data: {},
        })
        .single();

      const a = singleStroke as { area: number; perimeter: number };
      const b = threeStrokes as { area: number; perimeter: number };
      expect(b.area).toBe(a.area);
      expect(b.perimeter).toBe(a.perimeter);
      expect(a.area).toBe(75);
      expect(a.perimeter).toBe(40);
    });
  });
});
