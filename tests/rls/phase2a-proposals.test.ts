/**
 * Phase 2A (Proposal-centric pivot) integration tests — proposal lifecycle,
 * versioning, numbering concurrency, the calculation engine end-to-end
 * through real RPCs, cross-tenant integrity, media/portfolio, and the
 * Phase 2A permission matrix.
 *
 * Same infrastructure/fixture style as tests/rls/phase1-crm.test.ts —
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
  return `test-p2a-${label}-${RUN_ID}@example.com`;
}

async function signIn(addr: string): Promise<SupabaseClient> {
  const client = createClient(TEST_URL!, TEST_ANON_KEY!);
  const { error } = await client.auth.signInWithPassword({ email: addr, password: PASSWORD });
  if (error) throw error;
  return client;
}

type TestUser = { id: string; email: string };

describe.skipIf(!canRun)("Phase 2A Proposal-centric pivot (requires real Postgres)", () => {
  let admin: SupabaseClient;
  let userA: TestUser, userB: TestUser, estimatorUser: TestUser, salesUser: TestUser, viewerUser: TestUser, fieldWorkerUser: TestUser;
  let aClient: SupabaseClient, bClient: SupabaseClient, estimatorClient: SupabaseClient, salesClient: SupabaseClient, viewerClient: SupabaseClient, fieldWorkerClient: SupabaseClient;
  let tenantAId: string, tenantBId: string;
  let clientAId: string, clientBId: string;

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

    [aClient, bClient, estimatorClient, salesClient, viewerClient, fieldWorkerClient] = await Promise.all([
      signIn(userA.email),
      signIn(userB.email),
      signIn(estimatorUser.email),
      signIn(salesUser.email),
      signIn(viewerUser.email),
      signIn(fieldWorkerUser.email),
    ]);

    const { data: tenantA } = await aClient
      .rpc("create_tenant_with_owner", { p_name: "P2A Tenant A", p_slug: `p2a-a-${RUN_ID}` })
      .single();
    tenantAId = (tenantA as { id: string }).id;

    const { data: tenantB } = await bClient
      .rpc("create_tenant_with_owner", { p_name: "P2A Tenant B", p_slug: `p2a-b-${RUN_ID}` })
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
    }

    await inviteAndAccept(estimatorClient, estimatorUser.email, "estimator");
    await inviteAndAccept(salesClient, salesUser.email, "sales");
    await inviteAndAccept(viewerClient, viewerUser.email, "viewer");
    await inviteAndAccept(fieldWorkerClient, fieldWorkerUser.email, "field_worker");

    const { data: clientA } = await aClient
      .rpc("create_client", { p_tenant_id: tenantAId, p_client_type: "individual", p_display_name: "P2A Client A" })
      .single();
    clientAId = (clientA as { id: string }).id;

    const { data: clientB } = await bClient
      .rpc("create_client", { p_tenant_id: tenantBId, p_client_type: "individual", p_display_name: "P2A Client B" })
      .single();
    clientBId = (clientB as { id: string }).id;
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
      .rpc("create_proposal_direct", {
        p_tenant_id: tenantAId,
        p_client_id: clientAId,
        p_title: title,
        p_service_type: "custom",
      })
      .single();
    const p = proposal as { id: string; current_version_id: string };
    return { proposalId: p.id, versionId: p.current_version_id };
  }

  // ===========================================================================
  // Proposal creation
  // ===========================================================================
  describe("Proposal creation", () => {
    it("create_proposal_direct without an opportunity auto-creates a lightweight one, linked, in proposal_in_progress", async () => {
      const { data: proposal, error } = await aClient
        .rpc("create_proposal_direct", {
          p_tenant_id: tenantAId,
          p_client_id: clientAId,
          p_title: "Direct proposal, no opportunity",
          p_service_type: "interior_painting",
        })
        .single();
      expect(error).toBeNull();
      const p = proposal as { id: string; opportunity_id: string; status: string; source: string; proposal_number: number };
      expect(p.opportunity_id).toBeTruthy();
      expect(p.status).toBe("draft");
      expect(p.source).toBe("direct");

      const { data: opp } = await aClient.from("opportunities").select("status, title").eq("id", p.opportunity_id).single();
      expect((opp as { status: string }).status).toBe("proposal_in_progress");
      expect((opp as { title: string }).title).toBe("Direct proposal, no opportunity");
    });

    it("create_proposal_from_opportunity links to the given opportunity and syncs its status", async () => {
      const { data: opp } = await aClient
        .rpc("create_opportunity", { p_tenant_id: tenantAId, p_client_id: clientAId, p_title: "Existing opp for proposal" })
        .single();
      const oppId = (opp as { id: string }).id;

      const { data: proposal, error } = await aClient
        .rpc("create_proposal_from_opportunity", {
          p_tenant_id: tenantAId,
          p_opportunity_id: oppId,
          p_title: "From existing opportunity",
          p_service_type: "exterior_painting",
        })
        .single();
      expect(error).toBeNull();
      expect((proposal as { opportunity_id: string }).opportunity_id).toBe(oppId);

      const { data: updatedOpp } = await aClient.from("opportunities").select("status").eq("id", oppId).single();
      expect((updatedOpp as { status: string }).status).toBe("proposal_in_progress");
    });

    it("a brand-new proposal has exactly one draft version, version_number 1", async () => {
      const { data: proposal } = await aClient
        .rpc("create_proposal_direct", {
          p_tenant_id: tenantAId,
          p_client_id: clientAId,
          p_title: "Version check",
          p_service_type: "flooring",
        })
        .single();
      const p = proposal as { id: string; current_version_id: string };

      const { data: versions } = await aClient.from("proposal_versions").select("*").eq("proposal_id", p.id);
      expect(versions).toHaveLength(1);
      const version = (versions as { id: string; version_number: number; version_status: string }[])[0]!;
      expect(version.version_number).toBe(1);
      expect(version.version_status).toBe("draft");
      expect(p.current_version_id).toBe(version.id);
    });

    it("an opportunity from a different client is rejected", async () => {
      const { data: otherClient } = await aClient
        .rpc("create_client", { p_tenant_id: tenantAId, p_client_type: "individual", p_display_name: "Other client" })
        .single();
      const { data: opp } = await aClient
        .rpc("create_opportunity", { p_tenant_id: tenantAId, p_client_id: (otherClient as { id: string }).id, p_title: "Wrong client opp" })
        .single();

      const { error } = await aClient.rpc("create_proposal_direct", {
        p_tenant_id: tenantAId,
        p_client_id: clientAId,
        p_title: "Mismatched client/opportunity",
        p_service_type: "custom",
        p_opportunity_id: (opp as { id: string }).id,
      });
      expect(error).not.toBeNull();
    });

    it("a contact belonging to a different client is rejected", async () => {
      const { data: otherClient } = await aClient
        .rpc("create_client", { p_tenant_id: tenantAId, p_client_type: "individual", p_display_name: "Contact owner" })
        .single();
      const { data: contact } = await aClient
        .rpc("create_client_contact", {
          p_client_id: (otherClient as { id: string }).id,
          p_first_name: "Wrong",
        })
        .single();

      const { error } = await aClient.rpc("create_proposal_direct", {
        p_tenant_id: tenantAId,
        p_client_id: clientAId,
        p_title: "Mismatched contact",
        p_service_type: "custom",
        p_client_contact_id: (contact as { id: string }).id,
      });
      expect(error).not.toBeNull();
    });

    it("only one active (non-archived) proposal per opportunity", async () => {
      const { data: opp } = await aClient
        .rpc("create_opportunity", { p_tenant_id: tenantAId, p_client_id: clientAId, p_title: "One-active-proposal opp" })
        .single();
      const oppId = (opp as { id: string }).id;

      const { error: firstErr } = await aClient.rpc("create_proposal_from_opportunity", {
        p_tenant_id: tenantAId,
        p_opportunity_id: oppId,
        p_title: "First",
        p_service_type: "custom",
      });
      expect(firstErr).toBeNull();

      const { error: secondErr } = await aClient.rpc("create_proposal_from_opportunity", {
        p_tenant_id: tenantAId,
        p_opportunity_id: oppId,
        p_title: "Second — should fail",
        p_service_type: "custom",
      });
      expect(secondErr).not.toBeNull();
    });

    it("idempotency key: a repeated create_proposal_direct call returns the same proposal, not a duplicate", async () => {
      const idempotencyKey = `idem-${RUN_ID}-${Math.random()}`;
      const args = {
        p_tenant_id: tenantAId,
        p_client_id: clientAId,
        p_title: "Idempotent create",
        p_service_type: "custom",
        p_idempotency_key: idempotencyKey,
      };
      const { data: first } = await aClient.rpc("create_proposal_direct", args).single();
      const { data: second } = await aClient.rpc("create_proposal_direct", args).single();
      expect((first as { id: string }).id).toBe((second as { id: string }).id);
    });

    it("concurrent proposal creation produces different proposal_numbers, never colliding", async () => {
      const results = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          aClient
            .rpc("create_proposal_direct", {
              p_tenant_id: tenantAId,
              p_client_id: clientAId,
              p_title: `Concurrent ${i}`,
              p_service_type: "custom",
            })
            .single()
        )
      );
      const numbers = results.map((r) => (r.data as { proposal_number: number })?.proposal_number);
      expect(new Set(numbers).size).toBe(5);
    });
  });

  // ===========================================================================
  // Calculation engine, exercised through the real RPCs end-to-end
  // ===========================================================================
  describe("Calculation engine (server-side, via RPC)", () => {
    let proposalId: string;
    let versionId: string;

    beforeAll(async () => {
      const { data: proposal } = await aClient
        .rpc("create_proposal_direct", {
          p_tenant_id: tenantAId,
          p_client_id: clientAId,
          p_title: "Calc engine test",
          p_service_type: "interior_painting",
        })
        .single();
      const p = proposal as { id: string; current_version_id: string };
      proposalId = p.id;
      versionId = p.current_version_id;
    });

    it("adding a labor item recalculates the version's totals server-side", async () => {
      const { data: item, error } = await aClient
        .rpc("add_proposal_labor_item", {
          p_proposal_version_id: versionId,
          p_label: "Lead painter",
          p_worker_count: 2,
          p_estimated_days: 5,
          p_hours_per_day: 8,
          p_hourly_rate_cents: 3000,
        })
        .single();
      expect(error).toBeNull();
      expect((item as { total_hours: number }).total_hours).toBe(80);
      expect((item as { total_cents: number }).total_cents).toBe(240000);

      const { data: version } = await aClient.from("proposal_versions").select("*").eq("id", versionId).single();
      expect((version as { labor_total_cents: number }).labor_total_cents).toBe(240000);
      expect((version as { total_cents: number }).total_cents).toBe(240000);
    });

    it("adding a line item updates the subtotal and total", async () => {
      const { error } = await aClient.rpc("add_proposal_line_item", {
        p_proposal_version_id: versionId,
        p_category: "material",
        p_description: "Paint (5 gal)",
        p_quantity: 5,
        p_unit: "gallon",
        p_unit_price_cents: 4000,
        p_taxable: true,
      });
      expect(error).toBeNull();

      const { data: version } = await aClient.from("proposal_versions").select("*").eq("id", versionId).single();
      expect((version as { line_items_subtotal_cents: number }).line_items_subtotal_cents).toBe(20000);
      expect((version as { subtotal_cents: number }).subtotal_cents).toBe(260000); // 240000 labor + 20000 material
    });

    it("update_proposal_pricing applies tax and discount, recalculating the total", async () => {
      const { data: version, error } = await aClient
        .rpc("update_proposal_pricing", {
          p_proposal_version_id: versionId,
          p_terms: "50% deposit required",
          p_exclusions: "Permits not included",
          p_notes_for_client: "",
          p_discount_type: "percentage",
          p_discount_value: 1000, // 10%
          p_tax_rate_bps: 700, // 7%
        })
        .single();
      expect(error).toBeNull();
      const v = version as {
        subtotal_cents: number;
        discount_cents: number;
        tax_cents: number;
        total_cents: number;
      };
      expect(v.subtotal_cents).toBe(260000);
      expect(v.discount_cents).toBe(26000); // 10% of 260000
      // taxable subtotal after proportional discount = 260000 - 26000 = 234000 (everything is taxable here)
      expect(v.tax_cents).toBe(16380); // 7% of 234000
      expect(v.total_cents).toBe(v.subtotal_cents - v.discount_cents + v.tax_cents);
    });

    it("a manipulated total_cents sent directly via .update() is never accepted — no UPDATE grant exists", async () => {
      // No UPDATE grant on proposal_versions at all — PostgREST reports this
      // as a successful no-op (zero rows affected), not an error. Either way
      // the value must never actually change; that's the real assertion.
      await aClient.from("proposal_versions").update({ total_cents: 1 }).eq("id", versionId);

      const { data: version } = await aClient.from("proposal_versions").select("total_cents").eq("id", versionId).single();
      expect((version as { total_cents: number }).total_cents).not.toBe(1);
    });

    it("negative/zero/invalid labor inputs are rejected server-side", async () => {
      const cases = [
        { p_worker_count: 0, p_estimated_days: 5, p_hours_per_day: 8, p_hourly_rate_cents: 3000 },
        { p_worker_count: 1, p_estimated_days: -1, p_hours_per_day: 8, p_hourly_rate_cents: 3000 },
        { p_worker_count: 1, p_estimated_days: 5, p_hours_per_day: 0, p_hourly_rate_cents: 3000 },
        { p_worker_count: 1, p_estimated_days: 5, p_hours_per_day: 8, p_hourly_rate_cents: -100 },
      ];
      for (const c of cases) {
        const { error } = await aClient.rpc("add_proposal_labor_item", {
          p_proposal_version_id: versionId,
          p_label: "Invalid",
          ...c,
        });
        expect(error).not.toBeNull();
      }
    });

    it("a zero or negative quantity/unit price line item is rejected", async () => {
      const cases = [
        { p_quantity: 0, p_unit_price_cents: 1000 },
        { p_quantity: -1, p_unit_price_cents: 1000 },
        { p_quantity: 1, p_unit_price_cents: -1 },
      ];
      for (const c of cases) {
        const { error } = await aClient.rpc("add_proposal_line_item", {
          p_proposal_version_id: versionId,
          p_category: "material",
          p_description: "Invalid",
          p_unit: "each",
          p_taxable: true,
          ...c,
        });
        expect(error).not.toBeNull();
      }
    });
  });

  // ===========================================================================
  // Direct DB verification of the Pricing Summary "$0.00" report
  // (docs/40-proposal-total-refresh-fix.md). This mirrors the brief's exact
  // reported scenario and its exact expected numbers, reading raw table
  // rows via the tenant's own signed-in client (never assuming what the
  // Pricing Summary's rendered text says — checking what is actually
  // persisted, per the brief's explicit instruction).
  // ===========================================================================
  describe("Direct DB verification: labor + material persistence and recalculation", () => {
    it("Case 1: hourly labor (1 worker, 1 day, 8h, $35/hr) persists as total_cents=28000 and updates proposal_versions.labor_total_cents/total_cents to 28000", async () => {
      const { proposalId, versionId } = await createDraftProposal("DB verify: Case 1 hourly");

      const { data: laborItem, error: laborErr } = await aClient
        .rpc("add_proposal_labor_item", {
          p_proposal_version_id: versionId,
          p_label: "Painting labor",
          p_worker_count: 1,
          p_estimated_days: 1,
          p_hours_per_day: 8,
          p_hourly_rate_cents: 3500,
        })
        .single();
      expect(laborErr).toBeNull();

      // Read the raw row back, not just the RPC's return value — proves the
      // row actually landed in the table, tenant-scoped, unarchived.
      const { data: rawLaborRows } = await aClient
        .from("proposal_labor_items")
        .select("id, proposal_version_id, pricing_method, total_cents, archived_at")
        .eq("proposal_version_id", versionId);
      expect(rawLaborRows).toHaveLength(1);
      const rawLabor = (rawLaborRows as { proposal_version_id: string; total_cents: number; archived_at: string | null }[])[0]!;
      expect(rawLabor.proposal_version_id).toBe(versionId);
      expect(rawLabor.total_cents).toBe(28000);
      expect(rawLabor.archived_at).toBeNull();
      expect((laborItem as { total_cents: number }).total_cents).toBe(28000);

      const { data: version1 } = await aClient
        .from("proposal_versions")
        .select("labor_total_cents, line_items_subtotal_cents, subtotal_cents, total_cents")
        .eq("id", versionId)
        .single();
      const v1 = version1 as { labor_total_cents: number; line_items_subtotal_cents: number; subtotal_cents: number; total_cents: number };
      expect(v1.labor_total_cents).toBe(28000);
      expect(v1.line_items_subtotal_cents).toBe(0);
      expect(v1.subtotal_cents).toBe(28000);
      expect(v1.total_cents).toBe(28000);

      // Case 2: add a $50.00 material line item to the SAME version.
      const { error: lineErr } = await aClient.rpc("add_proposal_line_item", {
        p_proposal_version_id: versionId,
        p_category: "material",
        p_description: "Paint",
        p_quantity: 1,
        p_unit: "each",
        p_unit_price_cents: 5000,
        p_taxable: true,
      });
      expect(lineErr).toBeNull();

      const { data: rawLineRows } = await aClient
        .from("proposal_line_items")
        .select("id, proposal_version_id, line_total_cents, archived_at")
        .eq("proposal_version_id", versionId);
      expect(rawLineRows).toHaveLength(1);
      const rawLine = (rawLineRows as { proposal_version_id: string; line_total_cents: number; archived_at: string | null }[])[0]!;
      expect(rawLine.proposal_version_id).toBe(versionId);
      expect(rawLine.line_total_cents).toBe(5000);
      expect(rawLine.archived_at).toBeNull();

      const { data: version2 } = await aClient
        .from("proposal_versions")
        .select("labor_total_cents, line_items_subtotal_cents, subtotal_cents, total_cents")
        .eq("id", versionId)
        .single();
      const v2 = version2 as { labor_total_cents: number; line_items_subtotal_cents: number; subtotal_cents: number; total_cents: number };
      expect(v2.labor_total_cents).toBe(28000);
      expect(v2.line_items_subtotal_cents).toBe(5000);
      expect(v2.subtotal_cents).toBe(33000);
      expect(v2.total_cents).toBe(33000);

      // Case 3: "reload" — re-fetch via the exact same path the builder
      // page uses (proposals.current_version_id -> proposal_versions.id),
      // never a hardcoded id or an "order by created_at limit 1" guess.
      const { data: proposalRow } = await aClient.from("proposals").select("current_version_id").eq("id", proposalId).single();
      expect((proposalRow as { current_version_id: string }).current_version_id).toBe(versionId);

      const { data: reloaded } = await aClient
        .from("proposal_versions")
        .select("labor_total_cents, line_items_subtotal_cents, total_cents")
        .eq("id", (proposalRow as { current_version_id: string }).current_version_id)
        .single();
      const r = reloaded as { labor_total_cents: number; line_items_subtotal_cents: number; total_cents: number };
      expect(r.labor_total_cents).toBe(28000);
      expect(r.line_items_subtotal_cents).toBe(5000);
      expect(r.total_cents).toBe(33000);
    });

    it("Case 4: fixed labor $700 persists as labor_total_cents=70000 and total_cents=70000", async () => {
      const { versionId } = await createDraftProposal("DB verify: Case 4 fixed");
      await aClient.rpc("add_proposal_labor_item", {
        p_proposal_version_id: versionId,
        p_label: "Fixed labor",
        p_worker_count: null as unknown as number,
        p_estimated_days: null as unknown as number,
        p_hours_per_day: null as unknown as number,
        p_hourly_rate_cents: null as unknown as number,
        p_pricing_method: "fixed",
        p_fixed_total_cents: 70000,
      });
      const { data: version } = await aClient.from("proposal_versions").select("labor_total_cents, total_cents").eq("id", versionId).single();
      const v = version as { labor_total_cents: number; total_cents: number };
      expect(v.labor_total_cents).toBe(70000);
      expect(v.total_cents).toBe(70000);
    });

    it("Case 5: fixed labor $700 + material 2x$40 persists as total_cents=78000", async () => {
      const { versionId } = await createDraftProposal("DB verify: Case 5 fixed + material");
      await aClient.rpc("add_proposal_labor_item", {
        p_proposal_version_id: versionId,
        p_label: "Fixed labor",
        p_worker_count: null as unknown as number,
        p_estimated_days: null as unknown as number,
        p_hours_per_day: null as unknown as number,
        p_hourly_rate_cents: null as unknown as number,
        p_pricing_method: "fixed",
        p_fixed_total_cents: 70000,
      });
      await aClient.rpc("add_proposal_line_item", {
        p_proposal_version_id: versionId,
        p_category: "material",
        p_description: "Paint",
        p_quantity: 2,
        p_unit: "each",
        p_unit_price_cents: 4000,
        p_taxable: true,
      });
      const { data: version } = await aClient
        .from("proposal_versions")
        .select("labor_total_cents, line_items_subtotal_cents, total_cents")
        .eq("id", versionId)
        .single();
      const v = version as { labor_total_cents: number; line_items_subtotal_cents: number; total_cents: number };
      expect(v.labor_total_cents).toBe(70000);
      expect(v.line_items_subtotal_cents).toBe(8000);
      expect(v.total_cents).toBe(78000);
    });
  });

  // ===========================================================================
  // Fixed-price labor (docs/39-fixed-labor-pricing.md) — the hourly-only
  // permission-matrix tests above already prove Viewer/Sales/Field Worker
  // are rejected and Estimator is allowed, since the permission gate in
  // add/update_proposal_labor_item runs before any pricing_method branch;
  // this block covers the new fixed-mode code path itself.
  // ===========================================================================
  describe("Fixed-price labor", () => {
    it("creates a fixed-price labor item: total_hours is 0, total_cents is the fixed price verbatim", async () => {
      const { versionId } = await createDraftProposal("Fixed labor: create");
      const { data: item, error } = await aClient
        .rpc("add_proposal_labor_item", {
          p_proposal_version_id: versionId,
          p_label: "Bathroom remodeling labor",
          p_worker_count: null as unknown as number,
          p_estimated_days: null as unknown as number,
          p_hours_per_day: null as unknown as number,
          p_hourly_rate_cents: null as unknown as number,
          p_pricing_method: "fixed",
          p_fixed_total_cents: 70000,
        })
        .single();
      expect(error).toBeNull();
      const i = item as { total_hours: number; total_cents: number; pricing_method: string; worker_count: number | null };
      expect(i.pricing_method).toBe("fixed");
      expect(i.total_hours).toBe(0);
      expect(i.total_cents).toBe(70000);
      expect(i.worker_count).toBeNull();
    });

    it("a fixed-price labor item updates the version's labor_total_cents and total_cents", async () => {
      const { versionId } = await createDraftProposal("Fixed labor: recalculation");
      await aClient.rpc("add_proposal_labor_item", {
        p_proposal_version_id: versionId,
        p_label: "Fixed labor",
        p_worker_count: null as unknown as number,
        p_estimated_days: null as unknown as number,
        p_hours_per_day: null as unknown as number,
        p_hourly_rate_cents: null as unknown as number,
        p_pricing_method: "fixed",
        p_fixed_total_cents: 70000,
      });
      const { data: version } = await aClient.from("proposal_versions").select("labor_total_cents, total_cents").eq("id", versionId).single();
      const v = version as { labor_total_cents: number; total_cents: number };
      expect(v.labor_total_cents).toBe(70000);
      expect(v.total_cents).toBe(70000);
    });

    it("the exact manual-verification case: fixed labor $700 + material 2x$40 = $780 total", async () => {
      const { versionId } = await createDraftProposal("Fixed labor: manual verification");
      await aClient.rpc("add_proposal_labor_item", {
        p_proposal_version_id: versionId,
        p_label: "Fixed labor",
        p_worker_count: null as unknown as number,
        p_estimated_days: null as unknown as number,
        p_hours_per_day: null as unknown as number,
        p_hourly_rate_cents: null as unknown as number,
        p_pricing_method: "fixed",
        p_fixed_total_cents: 70000,
      });
      await aClient.rpc("add_proposal_line_item", {
        p_proposal_version_id: versionId,
        p_category: "material",
        p_description: "Paint",
        p_quantity: 2,
        p_unit: "each",
        p_unit_price_cents: 4000,
        p_taxable: true,
      });
      const { data: version } = await aClient
        .from("proposal_versions")
        .select("labor_total_cents, line_items_subtotal_cents, total_cents")
        .eq("id", versionId)
        .single();
      const v = version as { labor_total_cents: number; line_items_subtotal_cents: number; total_cents: number };
      expect(v.labor_total_cents).toBe(70000); // $700.00
      expect(v.line_items_subtotal_cents).toBe(8000); // $80.00
      expect(v.total_cents).toBe(78000); // $780.00
    });

    it("a negative fixed price is rejected", async () => {
      const { versionId } = await createDraftProposal("Fixed labor: negative rejected");
      const { error } = await aClient.rpc("add_proposal_labor_item", {
        p_proposal_version_id: versionId,
        p_label: "Invalid",
        p_worker_count: null as unknown as number,
        p_estimated_days: null as unknown as number,
        p_hours_per_day: null as unknown as number,
        p_hourly_rate_cents: null as unknown as number,
        p_pricing_method: "fixed",
        p_fixed_total_cents: -100,
      });
      expect(error).not.toBeNull();
    });

    it("a null fixed price for pricing_method=fixed is rejected, not silently treated as zero", async () => {
      const { versionId } = await createDraftProposal("Fixed labor: null rejected");
      const { error } = await aClient.rpc("add_proposal_labor_item", {
        p_proposal_version_id: versionId,
        p_label: "Invalid",
        p_worker_count: null as unknown as number,
        p_estimated_days: null as unknown as number,
        p_hours_per_day: null as unknown as number,
        p_hourly_rate_cents: null as unknown as number,
        p_pricing_method: "fixed",
        p_fixed_total_cents: null as unknown as number,
      });
      expect(error).not.toBeNull();
    });

    it("an invalid pricing_method string is rejected", async () => {
      const { versionId } = await createDraftProposal("Fixed labor: invalid method");
      const { error } = await aClient.rpc("add_proposal_labor_item", {
        p_proposal_version_id: versionId,
        p_label: "Invalid",
        p_worker_count: 1,
        p_estimated_days: 1,
        p_hours_per_day: 8,
        p_hourly_rate_cents: 3000,
        p_pricing_method: "hourly_and_fixed",
        p_fixed_total_cents: null as unknown as number,
      });
      expect(error).not.toBeNull();
    });

    it("switching an existing item from hourly to fixed clears the hourly fields", async () => {
      const { versionId } = await createDraftProposal("Fixed labor: hourly to fixed");
      const { data: item } = await aClient
        .rpc("add_proposal_labor_item", {
          p_proposal_version_id: versionId,
          p_label: "Switch me",
          p_worker_count: 2,
          p_estimated_days: 5,
          p_hours_per_day: 8,
          p_hourly_rate_cents: 3000,
        })
        .single();
      const itemId = (item as { id: string }).id;

      const { data: updated, error } = await aClient
        .rpc("update_proposal_labor_item", {
          p_labor_item_id: itemId,
          p_label: "Switch me",
          p_worker_count: null as unknown as number,
          p_estimated_days: null as unknown as number,
          p_hours_per_day: null as unknown as number,
          p_hourly_rate_cents: null as unknown as number,
          p_pricing_method: "fixed",
          p_fixed_total_cents: 55000,
        })
        .single();
      expect(error).toBeNull();
      const u = updated as { pricing_method: string; total_cents: number; worker_count: number | null; hourly_rate_cents: number | null };
      expect(u.pricing_method).toBe("fixed");
      expect(u.total_cents).toBe(55000);
      expect(u.worker_count).toBeNull();
      expect(u.hourly_rate_cents).toBeNull();
    });

    it("switching an existing item from fixed to hourly clears the fixed field", async () => {
      const { versionId } = await createDraftProposal("Fixed labor: fixed to hourly");
      const { data: item } = await aClient
        .rpc("add_proposal_labor_item", {
          p_proposal_version_id: versionId,
          p_label: "Switch me back",
          p_worker_count: null as unknown as number,
          p_estimated_days: null as unknown as number,
          p_hours_per_day: null as unknown as number,
          p_hourly_rate_cents: null as unknown as number,
          p_pricing_method: "fixed",
          p_fixed_total_cents: 55000,
        })
        .single();
      const itemId = (item as { id: string }).id;

      const { data: updated, error } = await aClient
        .rpc("update_proposal_labor_item", {
          p_labor_item_id: itemId,
          p_label: "Switch me back",
          p_worker_count: 1,
          p_estimated_days: 1,
          p_hours_per_day: 8,
          p_hourly_rate_cents: 3000,
          p_pricing_method: "hourly",
          p_fixed_total_cents: null as unknown as number,
        })
        .single();
      expect(error).toBeNull();
      const u = updated as { pricing_method: string; total_cents: number; fixed_total_cents: number | null };
      expect(u.pricing_method).toBe("hourly");
      expect(u.total_cents).toBe(24000);
      expect(u.fixed_total_cents).toBeNull();
    });

    it("a manipulated total_cents on a fixed labor item via raw .update() is never accepted — no UPDATE grant exists", async () => {
      const { versionId } = await createDraftProposal("Fixed labor: manipulation rejected");
      const { data: item } = await aClient
        .rpc("add_proposal_labor_item", {
          p_proposal_version_id: versionId,
          p_label: "Fixed labor",
          p_worker_count: null as unknown as number,
          p_estimated_days: null as unknown as number,
          p_hours_per_day: null as unknown as number,
          p_hourly_rate_cents: null as unknown as number,
          p_pricing_method: "fixed",
          p_fixed_total_cents: 70000,
        })
        .single();
      const itemId = (item as { id: string }).id;

      await aClient.from("proposal_labor_items").update({ total_cents: 1, fixed_total_cents: 1 }).eq("id", itemId);

      const { data: unchanged } = await aClient.from("proposal_labor_items").select("total_cents, fixed_total_cents").eq("id", itemId).single();
      const u = unchanged as { total_cents: number; fixed_total_cents: number };
      expect(u.total_cents).toBe(70000);
      expect(u.fixed_total_cents).toBe(70000);
    });

    it("a locked version rejects both adding and updating fixed-price labor", async () => {
      const { versionId } = await createDraftProposal("Fixed labor: locked version");
      const { data: item } = await aClient
        .rpc("add_proposal_labor_item", {
          p_proposal_version_id: versionId,
          p_label: "Pre-lock item",
          p_worker_count: 1,
          p_estimated_days: 1,
          p_hours_per_day: 8,
          p_hourly_rate_cents: 3000,
        })
        .single();
      const itemId = (item as { id: string }).id;

      await admin.from("proposal_versions").update({ version_status: "locked", locked_at: new Date().toISOString() }).eq("id", versionId);

      const { error: addErr } = await aClient.rpc("add_proposal_labor_item", {
        p_proposal_version_id: versionId,
        p_label: "Should not be added",
        p_worker_count: null as unknown as number,
        p_estimated_days: null as unknown as number,
        p_hours_per_day: null as unknown as number,
        p_hourly_rate_cents: null as unknown as number,
        p_pricing_method: "fixed",
        p_fixed_total_cents: 50000,
      });
      expect(addErr).not.toBeNull();

      const { error: updateErr } = await aClient.rpc("update_proposal_labor_item", {
        p_labor_item_id: itemId,
        p_label: "Should not switch to fixed",
        p_worker_count: null as unknown as number,
        p_estimated_days: null as unknown as number,
        p_hours_per_day: null as unknown as number,
        p_hourly_rate_cents: null as unknown as number,
        p_pricing_method: "fixed",
        p_fixed_total_cents: 50000,
      });
      expect(updateErr).not.toBeNull();

      await admin.from("proposal_versions").update({ version_status: "superseded" }).eq("id", versionId);
    });

    it("cross-tenant: Tenant B cannot add a fixed-price labor item to Tenant A's version", async () => {
      const { versionId } = await createDraftProposal("Fixed labor: cross-tenant");
      const { error } = await bClient.rpc("add_proposal_labor_item", {
        p_proposal_version_id: versionId,
        p_label: "Tenant B should not add this",
        p_worker_count: null as unknown as number,
        p_estimated_days: null as unknown as number,
        p_hours_per_day: null as unknown as number,
        p_hourly_rate_cents: null as unknown as number,
        p_pricing_method: "fixed",
        p_fixed_total_cents: 50000,
      });
      expect(error).not.toBeNull();
    });

    it("Estimator (has proposals.manage_pricing) can add a fixed-price labor item", async () => {
      const { versionId } = await createDraftProposal("Fixed labor: estimator permission");
      const { error } = await estimatorClient.rpc("add_proposal_labor_item", {
        p_proposal_version_id: versionId,
        p_label: "Estimator fixed labor",
        p_worker_count: null as unknown as number,
        p_estimated_days: null as unknown as number,
        p_hours_per_day: null as unknown as number,
        p_hourly_rate_cents: null as unknown as number,
        p_pricing_method: "fixed",
        p_fixed_total_cents: 50000,
      });
      expect(error).toBeNull();
    });

    it("Viewer cannot add a fixed-price labor item", async () => {
      const { versionId } = await createDraftProposal("Fixed labor: viewer rejected");
      const { error } = await viewerClient.rpc("add_proposal_labor_item", {
        p_proposal_version_id: versionId,
        p_label: "Viewer should not add this",
        p_worker_count: null as unknown as number,
        p_estimated_days: null as unknown as number,
        p_hours_per_day: null as unknown as number,
        p_hourly_rate_cents: null as unknown as number,
        p_pricing_method: "fixed",
        p_fixed_total_cents: 50000,
      });
      expect(error).not.toBeNull();
    });
  });

  // ===========================================================================
  // Job summary (update_proposal_scope) — regression coverage for the bug
  // where PostgREST failed to resolve the RPC overload when a client
  // omitted an empty optional argument instead of sending it as null.
  // ===========================================================================
  describe("update_proposal_scope (Job summary)", () => {
    it("accepts all five parameters at once", async () => {
      const { versionId } = await createDraftProposal("Scope: all fields");
      const { data, error } = await aClient
        .rpc("update_proposal_scope", {
          p_proposal_version_id: versionId,
          p_summary: "Painting house",
          p_scope_intro: "Full exterior repaint",
          p_estimated_start_date: "2026-01-20",
          p_estimated_duration_days: 5,
        })
        .single();
      expect(error).toBeNull();
      const v = data as {
        summary: string;
        scope_intro: string;
        estimated_start_date: string;
        estimated_duration_days: number;
      };
      expect(v.summary).toBe("Painting house");
      expect(v.scope_intro).toBe("Full exterior repaint");
      expect(v.estimated_start_date).toBe("2026-01-20");
      expect(v.estimated_duration_days).toBe(5);
    });

    it("accepts only p_summary, with the other three explicitly null — the exact reported bug", async () => {
      const { versionId } = await createDraftProposal("Scope: summary + start date only");
      const { data, error } = await aClient
        .rpc("update_proposal_scope", {
          p_proposal_version_id: versionId,
          p_summary: "Painting house",
          p_scope_intro: null,
          p_estimated_start_date: "2026-01-20",
          p_estimated_duration_days: null,
        })
        .single();
      expect(error).toBeNull();
      const v = data as {
        summary: string;
        scope_intro: string | null;
        estimated_start_date: string;
        estimated_duration_days: number | null;
      };
      expect(v.summary).toBe("Painting house");
      expect(v.scope_intro).toBeNull();
      expect(v.estimated_start_date).toBe("2026-01-20");
      expect(v.estimated_duration_days).toBeNull();
    });

    it("accepts only summary, the other three omitted entirely (relies on SQL DEFAULT NULL)", async () => {
      const { versionId } = await createDraftProposal("Scope: summary only, omitted keys");
      const { data, error } = await aClient
        .rpc("update_proposal_scope", {
          p_proposal_version_id: versionId,
          p_summary: "Only summary",
        })
        .single();
      expect(error).toBeNull();
      const v = data as { summary: string; scope_intro: string | null };
      expect(v.summary).toBe("Only summary");
      expect(v.scope_intro).toBeNull();
    });

    it("accepts only estimated_start_date", async () => {
      const { versionId } = await createDraftProposal("Scope: start date only");
      const { data, error } = await aClient
        .rpc("update_proposal_scope", {
          p_proposal_version_id: versionId,
          p_summary: null,
          p_scope_intro: null,
          p_estimated_start_date: "2026-03-01",
          p_estimated_duration_days: null,
        })
        .single();
      expect(error).toBeNull();
      expect((data as { estimated_start_date: string }).estimated_start_date).toBe("2026-03-01");
    });

    it("accepts only scope_intro", async () => {
      const { versionId } = await createDraftProposal("Scope: intro only");
      const { data, error } = await aClient
        .rpc("update_proposal_scope", {
          p_proposal_version_id: versionId,
          p_summary: null,
          p_scope_intro: "Just the intro",
          p_estimated_start_date: null,
          p_estimated_duration_days: null,
        })
        .single();
      expect(error).toBeNull();
      expect((data as { scope_intro: string }).scope_intro).toBe("Just the intro");
    });

    it("accepts only estimated_duration_days", async () => {
      const { versionId } = await createDraftProposal("Scope: duration only");
      const { data, error } = await aClient
        .rpc("update_proposal_scope", {
          p_proposal_version_id: versionId,
          p_summary: null,
          p_scope_intro: null,
          p_estimated_start_date: null,
          p_estimated_duration_days: 12,
        })
        .single();
      expect(error).toBeNull();
      expect((data as { estimated_duration_days: number }).estimated_duration_days).toBe(12);
    });

    it("all fields explicitly null clears previously-saved values", async () => {
      const { versionId } = await createDraftProposal("Scope: clearing to null");
      await aClient.rpc("update_proposal_scope", {
        p_proposal_version_id: versionId,
        p_summary: "Will be cleared",
        p_scope_intro: "Will be cleared",
        p_estimated_start_date: "2026-01-01",
        p_estimated_duration_days: 3,
      });
      const { data, error } = await aClient
        .rpc("update_proposal_scope", {
          p_proposal_version_id: versionId,
          p_summary: null,
          p_scope_intro: null,
          p_estimated_start_date: null,
          p_estimated_duration_days: null,
        })
        .single();
      expect(error).toBeNull();
      const v = data as {
        summary: string | null;
        scope_intro: string | null;
        estimated_start_date: string | null;
        estimated_duration_days: number | null;
      };
      expect(v.summary).toBeNull();
      expect(v.scope_intro).toBeNull();
      expect(v.estimated_start_date).toBeNull();
      expect(v.estimated_duration_days).toBeNull();
    });

    it("an invalid calendar date is rejected, not silently accepted", async () => {
      const { versionId } = await createDraftProposal("Scope: invalid date");
      const { error } = await aClient.rpc("update_proposal_scope", {
        p_proposal_version_id: versionId,
        p_summary: null,
        p_scope_intro: null,
        p_estimated_start_date: "2026-02-30",
        p_estimated_duration_days: null,
      });
      expect(error).not.toBeNull();
    });

    it("a negative or zero estimated_duration_days is rejected server-side", async () => {
      const { versionId } = await createDraftProposal("Scope: invalid duration");
      for (const bad of [0, -1]) {
        const { error } = await aClient.rpc("update_proposal_scope", {
          p_proposal_version_id: versionId,
          p_summary: null,
          p_scope_intro: null,
          p_estimated_start_date: null,
          p_estimated_duration_days: bad,
        });
        expect(error).not.toBeNull();
      }
    });

    it("a locked version is rejected", async () => {
      const { versionId } = await createDraftProposal("Scope: locked version");
      await admin.from("proposal_versions").update({ version_status: "locked", locked_at: new Date().toISOString() }).eq("id", versionId);

      const { error } = await aClient.rpc("update_proposal_scope", {
        p_proposal_version_id: versionId,
        p_summary: "Should not save",
        p_scope_intro: null,
        p_estimated_start_date: null,
        p_estimated_duration_days: null,
      });
      expect(error).not.toBeNull();

      await admin.from("proposal_versions").update({ version_status: "superseded" }).eq("id", versionId);
    });

    it("Viewer is rejected", async () => {
      const { versionId } = await createDraftProposal("Scope: viewer rejected");
      const { error } = await viewerClient.rpc("update_proposal_scope", {
        p_proposal_version_id: versionId,
        p_summary: "Viewer should not save this",
        p_scope_intro: null,
        p_estimated_start_date: null,
        p_estimated_duration_days: null,
      });
      expect(error).not.toBeNull();
    });

    it("cross-tenant: Tenant B cannot update Tenant A's proposal version", async () => {
      const { versionId } = await createDraftProposal("Scope: cross-tenant");
      const { error } = await bClient.rpc("update_proposal_scope", {
        p_proposal_version_id: versionId,
        p_summary: "Tenant B should not save this",
        p_scope_intro: null,
        p_estimated_start_date: null,
        p_estimated_duration_days: null,
      });
      expect(error).not.toBeNull();

      const { data: unchanged } = await admin.from("proposal_versions").select("summary").eq("id", versionId).single();
      expect((unchanged as { summary: string | null }).summary).not.toBe("Tenant B should not save this");
    });

    it("a suspended user's existing session cannot save, even with an otherwise-valid permission", async () => {
      const suspendAddr = email("scope-suspend");
      const { data: created, error: createUserErr } = await admin.auth.admin.createUser({
        email: suspendAddr,
        password: PASSWORD,
        email_confirm: true,
      });
      if (createUserErr || !created.user) throw createUserErr ?? new Error("Failed to create suspend-test user");
      allUserIds.push(created.user.id);
      const suspendClient = await signIn(suspendAddr);

      const { data: invite, error: inviteErr } = await aClient
        .rpc("invite_member_by_email", { p_tenant_id: tenantAId, p_email: suspendAddr, p_role_key: "sales" })
        .single();
      if (inviteErr) throw inviteErr;
      const membershipId = (invite as { id: string }).id;
      const { error: acceptErr } = await suspendClient.rpc("accept_invitation", { p_membership_id: membershipId });
      if (acceptErr) throw acceptErr;

      const { versionId } = await createDraftProposal("Scope: suspended user");

      const { error: suspendErr } = await aClient.rpc("update_membership", {
        p_membership_id: membershipId,
        p_new_status: "suspended",
      });
      expect(suspendErr).toBeNull();

      const { error } = await suspendClient.rpc("update_proposal_scope", {
        p_proposal_version_id: versionId,
        p_summary: "Suspended user should not save this",
        p_scope_intro: null,
        p_estimated_start_date: null,
        p_estimated_duration_days: null,
      });
      expect(error).not.toBeNull();
    });

    it("writes an audit log entry on success", async () => {
      const { versionId } = await createDraftProposal("Scope: audit log");
      await aClient.rpc("update_proposal_scope", {
        p_proposal_version_id: versionId,
        p_summary: "Audited change",
        p_scope_intro: null,
        p_estimated_start_date: null,
        p_estimated_duration_days: null,
      });

      const { data: logs } = await admin
        .from("audit_logs")
        .select("action, entity_type, entity_id")
        .eq("tenant_id", tenantAId)
        .eq("entity_id", versionId)
        .eq("action", "proposal.updated");
      expect((logs ?? []).length).toBeGreaterThan(0);
    });
  });

  // ===========================================================================
  // Version locking and immutability
  // ===========================================================================
  describe("Locked version immutability", () => {
    it("a locked version's children cannot be mutated, and the version itself cannot be modified except to superseded", async () => {
      const { data: proposal } = await aClient
        .rpc("create_proposal_direct", {
          p_tenant_id: tenantAId,
          p_client_id: clientAId,
          p_title: "Lock test",
          p_service_type: "custom",
        })
        .single();
      const p = proposal as { current_version_id: string };

      const { data: laborItem } = await aClient
        .rpc("add_proposal_labor_item", {
          p_proposal_version_id: p.current_version_id,
          p_label: "Crew",
          p_worker_count: 1,
          p_estimated_days: 1,
          p_hours_per_day: 8,
          p_hourly_rate_cents: 2000,
        })
        .single();

      // Controlled test preparation (section 40 of the brief): force the
      // version into 'locked' via the service role directly, since no real
      // send flow exists yet to reach this state through the app itself.
      const { error: lockErr } = await admin
        .from("proposal_versions")
        .update({ version_status: "locked", locked_at: new Date().toISOString() })
        .eq("id", p.current_version_id);
      expect(lockErr).toBeNull();

      // The application-level function refuses to edit a non-draft version.
      const { error: editErr } = await aClient.rpc("update_proposal_labor_item", {
        p_labor_item_id: (laborItem as { id: string }).id,
        p_label: "Changed",
        p_worker_count: 2,
        p_estimated_days: 1,
        p_hours_per_day: 8,
        p_hourly_rate_cents: 2000,
      });
      expect(editErr).not.toBeNull();

      // Even a raw UPDATE attempted with the service role (bypassing RLS
      // entirely) is rejected by the database trigger — the second barrier.
      const { error: rawErr } = await admin
        .from("proposal_labor_items")
        .update({ label: "Direct SQL bypass attempt" })
        .eq("id", (laborItem as { id: string }).id);
      expect(rawErr).not.toBeNull();

      // The version row itself: commercial fields are frozen...
      const { error: versionFieldErr } = await admin
        .from("proposal_versions")
        .update({ terms: "Sneaky change" })
        .eq("id", p.current_version_id);
      expect(versionFieldErr).not.toBeNull();

      // ...but the one sanctioned transition (locked -> superseded) is allowed.
      const { error: supersedeErr } = await admin
        .from("proposal_versions")
        .update({ version_status: "superseded" })
        .eq("id", p.current_version_id);
      expect(supersedeErr).toBeNull();
    });
  });

  // ===========================================================================
  // Proposal status transitions
  // ===========================================================================
  describe("Proposal status transitions", () => {
    it("draft -> ready -> draft round-trips", async () => {
      const { data: proposal } = await aClient
        .rpc("create_proposal_direct", {
          p_tenant_id: tenantAId,
          p_client_id: clientAId,
          p_title: "Ready round trip",
          p_service_type: "custom",
        })
        .single();
      const id = (proposal as { id: string }).id;

      const { data: ready } = await aClient.rpc("mark_proposal_ready", { p_proposal_id: id }).single();
      expect((ready as { status: string }).status).toBe("ready");

      const { data: draft } = await aClient.rpc("return_proposal_to_draft", { p_proposal_id: id }).single();
      expect((draft as { status: string }).status).toBe("draft");
    });

    it("a user cannot set status directly to sent/viewed/accepted/declined via .update()", async () => {
      const { data: proposal } = await aClient
        .rpc("create_proposal_direct", {
          p_tenant_id: tenantAId,
          p_client_id: clientAId,
          p_title: "No direct status jump",
          p_service_type: "custom",
        })
        .single();
      const id = (proposal as { id: string }).id;

      // No UPDATE grant on proposals — PostgREST reports a no-op, not an
      // error. The real assertion is that status never actually changes.
      for (const status of ["sent", "viewed", "accepted", "declined", "expired"]) {
        await aClient.from("proposals").update({ status }).eq("id", id);
      }

      const { data: unchanged } = await aClient.from("proposals").select("status").eq("id", id).single();
      expect((unchanged as { status: string }).status).toBe("draft");
    });

    it("archive requires draft or ready, and restore returns to the prior status", async () => {
      const { data: proposal } = await aClient
        .rpc("create_proposal_direct", {
          p_tenant_id: tenantAId,
          p_client_id: clientAId,
          p_title: "Archive round trip",
          p_service_type: "custom",
        })
        .single();
      const id = (proposal as { id: string }).id;
      await aClient.rpc("mark_proposal_ready", { p_proposal_id: id });

      const { data: archived } = await aClient.rpc("archive_proposal", { p_proposal_id: id }).single();
      expect((archived as { status: string; pre_archive_status: string }).status).toBe("archived");
      expect((archived as { pre_archive_status: string }).pre_archive_status).toBe("ready");

      const { data: restored } = await aClient.rpc("restore_proposal", { p_proposal_id: id }).single();
      expect((restored as { status: string }).status).toBe("ready");
    });
  });

  // ===========================================================================
  // Cross-tenant integrity (service role, bypassing every application check)
  // ===========================================================================
  describe("Cross-tenant integrity (rejected even via service_role raw insert)", () => {
    it("a proposal cannot reference a client from a different tenant", async () => {
      const { error } = await admin.from("proposals").insert({
        tenant_id: tenantAId,
        proposal_number: 999001,
        client_id: clientBId, // belongs to tenant B
        title: "Cross-tenant client",
        service_type: "custom",
        source: "direct",
        created_by: userA.id,
      });
      expect(error).not.toBeNull();
      expect(error?.code).toBe("23503"); // foreign_key_violation
    });

    it("media_assets from a different tenant cannot be attached to a proposal version", async () => {
      const { data: proposal } = await aClient
        .rpc("create_proposal_direct", {
          p_tenant_id: tenantAId,
          p_client_id: clientAId,
          p_title: "Cross-tenant media test",
          p_service_type: "custom",
        })
        .single();
      const p = proposal as { current_version_id: string };

      const { data: bMedia } = await admin
        .from("media_assets")
        .insert({
          tenant_id: tenantBId,
          storage_path: `${tenantBId}/fake-media-id/original.jpg`,
          original_filename: "fake.jpg",
          mime_type: "image/jpeg",
          size_bytes: 1000,
          media_type: "current_job",
          uploaded_by: userB.id,
        })
        .select()
        .single();

      const { error } = await aClient.rpc("attach_media_to_proposal", {
        p_proposal_version_id: p.current_version_id,
        p_media_asset_id: (bMedia as { id: string }).id,
        p_usage_type: "current_job",
      });
      expect(error).not.toBeNull();
    });

    it("portfolio_project_media cannot cross tenants at the database level", async () => {
      const { data: bPortfolio } = await admin
        .from("portfolio_projects")
        .insert({ tenant_id: tenantBId, title: "B portfolio", service_type: "custom", created_by: userB.id })
        .select()
        .single();
      const { data: aMedia } = await admin
        .from("media_assets")
        .insert({
          tenant_id: tenantAId,
          storage_path: `${tenantAId}/fake/original.jpg`,
          original_filename: "fake.jpg",
          mime_type: "image/jpeg",
          size_bytes: 1000,
          media_type: "portfolio",
          uploaded_by: userA.id,
        })
        .select()
        .single();

      const { error } = await admin.from("portfolio_project_media").insert({
        tenant_id: tenantBId,
        portfolio_project_id: (bPortfolio as { id: string }).id,
        media_asset_id: (aMedia as { id: string }).id, // wrong tenant
      });
      expect(error).not.toBeNull();
      expect(error?.code).toBe("23503");
    });
  });

  // ===========================================================================
  // Tenant isolation via RLS (real user sessions, not service role)
  // ===========================================================================
  describe("Tenant isolation", () => {
    it("User A cannot read Tenant B's proposals, even unfiltered", async () => {
      await bClient.rpc("create_proposal_direct", {
        p_tenant_id: tenantBId,
        p_client_id: clientBId,
        p_title: "Tenant B only",
        p_service_type: "custom",
      });
      const { data } = await aClient.from("proposals").select("*").eq("tenant_id", tenantBId);
      expect(data ?? []).toHaveLength(0);
    });

    it("User A cannot mutate a Tenant B proposal via RPC", async () => {
      const { data: bProposal } = await bClient
        .rpc("create_proposal_direct", {
          p_tenant_id: tenantBId,
          p_client_id: clientBId,
          p_title: "Tenant B target",
          p_service_type: "custom",
        })
        .single();
      const { error } = await aClient.rpc("mark_proposal_ready", { p_proposal_id: (bProposal as { id: string }).id });
      expect(error).not.toBeNull();
    });
  });

  // ===========================================================================
  // Permission matrix
  // ===========================================================================
  describe("Permission matrix", () => {
    let proposalId: string;
    let versionId: string;

    beforeAll(async () => {
      const { data: proposal } = await aClient
        .rpc("create_proposal_direct", {
          p_tenant_id: tenantAId,
          p_client_id: clientAId,
          p_title: "Permission matrix proposal",
          p_service_type: "custom",
        })
        .single();
      const p = proposal as { id: string; current_version_id: string };
      proposalId = p.id;
      versionId = p.current_version_id;
    });

    it("Viewer can view but cannot create a proposal", async () => {
      const { data, error: viewErr } = await viewerClient.from("proposals").select("*").eq("id", proposalId);
      expect(viewErr).toBeNull();
      expect(data).toHaveLength(1);

      const { error: createErr } = await viewerClient.rpc("create_proposal_direct", {
        p_tenant_id: tenantAId,
        p_client_id: clientAId,
        p_title: "Viewer should not create this",
        p_service_type: "custom",
      });
      expect(createErr).not.toBeNull();
    });

    it("Sales can create/update a proposal but cannot manage pricing by default", async () => {
      const { error: createErr } = await salesClient.rpc("create_proposal_direct", {
        p_tenant_id: tenantAId,
        p_client_id: clientAId,
        p_title: "Sales-created proposal",
        p_service_type: "custom",
      });
      expect(createErr).toBeNull();

      const { error: pricingErr } = await salesClient.rpc("add_proposal_labor_item", {
        p_proposal_version_id: versionId,
        p_label: "Sales cannot add this",
        p_worker_count: 1,
        p_estimated_days: 1,
        p_hours_per_day: 8,
        p_hourly_rate_cents: 1000,
      });
      expect(pricingErr).not.toBeNull();
    });

    it("Estimator can manage pricing", async () => {
      const { error } = await estimatorClient.rpc("add_proposal_labor_item", {
        p_proposal_version_id: versionId,
        p_label: "Estimator crew",
        p_worker_count: 1,
        p_estimated_days: 1,
        p_hours_per_day: 8,
        p_hourly_rate_cents: 1000,
      });
      expect(error).toBeNull();
    });

    it("Field Worker can upload/attach current-job media but not manage pricing or mark ready", async () => {
      const { data: media } = await admin
        .from("media_assets")
        .insert({
          tenant_id: tenantAId,
          storage_path: `${tenantAId}/fw-media/original.jpg`,
          original_filename: "job.jpg",
          mime_type: "image/jpeg",
          size_bytes: 1000,
          media_type: "current_job",
          uploaded_by: fieldWorkerUser.id,
        })
        .select()
        .single();

      const { error: attachErr } = await fieldWorkerClient.rpc("attach_media_to_proposal", {
        p_proposal_version_id: versionId,
        p_media_asset_id: (media as { id: string }).id,
        p_usage_type: "current_job",
      });
      expect(attachErr).toBeNull();

      const { error: pricingErr } = await fieldWorkerClient.rpc("add_proposal_labor_item", {
        p_proposal_version_id: versionId,
        p_label: "Field worker cannot add this",
        p_worker_count: 1,
        p_estimated_days: 1,
        p_hours_per_day: 8,
        p_hourly_rate_cents: 1000,
      });
      expect(pricingErr).not.toBeNull();

      const { error: readyErr } = await fieldWorkerClient.rpc("mark_proposal_ready", { p_proposal_id: proposalId });
      expect(readyErr).not.toBeNull();
    });
  });

  // ===========================================================================
  // Portfolio
  // ===========================================================================
  describe("Portfolio", () => {
    it("create, archive, and restore a portfolio project", async () => {
      const { data: project, error: createErr } = await aClient
        .rpc("create_portfolio_project", {
          p_tenant_id: tenantAId,
          p_title: "Sample kitchen remodel",
          p_service_type: "general_remodeling",
          p_location_label: "Miami, FL",
        })
        .single();
      expect(createErr).toBeNull();
      const id = (project as { id: string }).id;

      const { data: archived } = await aClient.rpc("archive_portfolio_project", { p_portfolio_project_id: id }).single();
      expect((archived as { archived_at: string | null }).archived_at).not.toBeNull();

      const { data: restored } = await aClient.rpc("restore_portfolio_project", { p_portfolio_project_id: id }).single();
      expect((restored as { archived_at: string | null }).archived_at).toBeNull();
    });

    it("archiving a portfolio project does not break a proposal that already references its media", async () => {
      const { data: project } = await aClient
        .rpc("create_portfolio_project", {
          p_tenant_id: tenantAId,
          p_title: "Reused portfolio item",
          p_service_type: "custom",
        })
        .single();
      const projectId = (project as { id: string }).id;

      const { data: media } = await admin
        .from("media_assets")
        .insert({
          tenant_id: tenantAId,
          storage_path: `${tenantAId}/portfolio-media/original.jpg`,
          original_filename: "before-after.jpg",
          mime_type: "image/jpeg",
          size_bytes: 1000,
          media_type: "portfolio",
          uploaded_by: userA.id,
        })
        .select()
        .single();
      const mediaId = (media as { id: string }).id;

      await aClient.rpc("add_portfolio_project_media", { p_portfolio_project_id: projectId, p_media_asset_id: mediaId });

      const { data: proposal } = await aClient
        .rpc("create_proposal_direct", {
          p_tenant_id: tenantAId,
          p_client_id: clientAId,
          p_title: "Uses portfolio media",
          p_service_type: "custom",
        })
        .single();
      const p = proposal as { current_version_id: string };

      const { error: attachErr } = await aClient.rpc("attach_media_to_proposal", {
        p_proposal_version_id: p.current_version_id,
        p_media_asset_id: mediaId,
        p_usage_type: "previous_work",
        p_portfolio_project_id: projectId,
      });
      expect(attachErr).toBeNull();

      await aClient.rpc("archive_portfolio_project", { p_portfolio_project_id: projectId });

      const { data: proposalMedia, error: readErr } = await aClient
        .from("proposal_media")
        .select("*, media_assets(*)")
        .eq("proposal_version_id", p.current_version_id);
      expect(readErr).toBeNull();
      expect(proposalMedia).toHaveLength(1);
    });
  });

  // ===========================================================================
  // Tenant proposal settings
  // ===========================================================================
  describe("Tenant proposal settings", () => {
    it("get_tenant_proposal_settings is idempotent and returns sensible defaults", async () => {
      const { data: first } = await aClient.rpc("get_tenant_proposal_settings", { p_tenant_id: tenantAId }).single();
      const { data: second } = await aClient.rpc("get_tenant_proposal_settings", { p_tenant_id: tenantAId }).single();
      expect((first as { tenant_id: string }).tenant_id).toBe((second as { tenant_id: string }).tenant_id);
      expect((first as { currency_code: string }).currency_code).toBe("USD");
    });

    it("update_tenant_proposal_settings persists changes; Sales cannot update settings", async () => {
      const { data: updated, error } = await aClient
        .rpc("update_tenant_proposal_settings", {
          p_tenant_id: tenantAId,
          p_default_customer_hourly_rate_cents: 4500,
          p_default_hours_per_day: 8,
          p_default_tax_rate_bps: 700,
          p_default_proposal_valid_days: 30,
          p_default_terms: "Standard terms",
          p_default_exclusions: "Standard exclusions",
          p_proposal_number_prefix: "SCV",
        })
        .single();
      expect(error).toBeNull();
      expect((updated as { default_customer_hourly_rate_cents: number }).default_customer_hourly_rate_cents).toBe(4500);

      const { error: salesErr } = await salesClient.rpc("update_tenant_proposal_settings", {
        p_tenant_id: tenantAId,
        p_default_customer_hourly_rate_cents: 1,
        p_default_hours_per_day: 8,
        p_default_tax_rate_bps: 0,
        p_default_proposal_valid_days: 30,
        p_default_terms: "",
        p_default_exclusions: "",
        p_proposal_number_prefix: "HACK",
      });
      expect(salesErr).not.toBeNull();
    });

    it("next_proposal_number allocation is concurrency-safe across many parallel calls", async () => {
      const results = await Promise.all(
        Array.from({ length: 10 }, () => admin.rpc("allocate_next_proposal_number", { p_tenant_id: tenantAId }))
      );
      const numbers = results.map((r) => r.data);
      expect(new Set(numbers).size).toBe(10);
    });
  });

  // ===========================================================================
  // Project creation from an accepted proposal (architecture prep — see
  // docs/adr/0034-project-creation-after-acceptance.md). Never faked through
  // a UI acceptance flow — proposals.status is forced to 'accepted' directly
  // via service_role as the "controlled test preparation" the brief asks for.
  // ===========================================================================
  describe("Project creation from an accepted proposal (architecture prep)", () => {
    it("rejects a proposal that is not accepted", async () => {
      const { data: proposal } = await aClient
        .rpc("create_proposal_direct", {
          p_tenant_id: tenantAId,
          p_client_id: clientAId,
          p_title: "Not accepted yet",
          p_service_type: "custom",
        })
        .single();

      const { error } = await aClient.rpc("create_project_from_accepted_proposal", {
        p_proposal_id: (proposal as { id: string }).id,
      });
      expect(error).not.toBeNull();
    });

    it("creates a project copying client/opportunity/contact/title once accepted, and is idempotent", async () => {
      const { data: proposal } = await aClient
        .rpc("create_proposal_direct", {
          p_tenant_id: tenantAId,
          p_client_id: clientAId,
          p_title: "Accepted proposal project test",
          p_service_type: "flooring",
        })
        .single();
      const p = proposal as { id: string; opportunity_id: string; client_id: string; title: string; service_type: string };

      await admin.from("proposals").update({ status: "accepted" }).eq("id", p.id);

      const { data: project, error } = await aClient
        .rpc("create_project_from_accepted_proposal", { p_proposal_id: p.id })
        .single();
      expect(error).toBeNull();
      const proj = project as { id: string; client_id: string; opportunity_id: string; name: string };
      expect(proj.client_id).toBe(p.client_id);
      expect(proj.opportunity_id).toBe(p.opportunity_id);
      expect(proj.name).toBe(p.title);

      // Calling it again must return the SAME project, not a duplicate.
      const { data: again } = await aClient
        .rpc("create_project_from_accepted_proposal", { p_proposal_id: p.id })
        .single();
      expect((again as { id: string }).id).toBe(proj.id);
    });
  });
});
