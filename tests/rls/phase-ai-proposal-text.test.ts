/**
 * AI-assisted proposal text — RLS/integration tests. Covers
 * business_profiles (reuses tenant.view/tenant.update, no new permission)
 * and ai_generation_events + the new ai.generate_proposal_text permission
 * (count_recent_ai_generations()/record_ai_generation_event()). Runs
 * against the same real, dedicated test Supabase project as every other
 * RLS suite; skipped entirely if the env vars are absent. See
 * docs/77-ai-proposal-text-generation.md and docs/79-openrouter-security.md.
 *
 * Deliberately does NOT call OpenRouter or the generateProposalTextAction
 * Server Action itself (that would be an E2E concern, and per the brief
 * "do not call the real OpenRouter API in CI/E2E") — this suite tests the
 * RLS/permission/rate-limit layer directly via the RPCs the action calls.
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
  return `test-ai-text-${label}-${RUN_ID}@example.com`;
}

async function signIn(addr: string): Promise<SupabaseClient> {
  const client = createClient(TEST_URL!, TEST_ANON_KEY!);
  const { error } = await client.auth.signInWithPassword({ email: addr, password: PASSWORD });
  if (error) throw error;
  return client;
}

type TestUser = { id: string; email: string };
type BusinessProfileRow = { tenant_id: string; business_name: string; tone_preference: string };

describe.skipIf(!canRun)("AI-assisted proposal text (requires real Postgres)", () => {
  let admin: SupabaseClient;
  let ownerA: TestUser, adminA: TestUser, estimatorA: TestUser, salesA: TestUser, viewerA: TestUser, fieldWorkerA: TestUser, ownerB: TestUser;
  let ownerAClient: SupabaseClient,
    adminAClient: SupabaseClient,
    estimatorAClient: SupabaseClient,
    salesAClient: SupabaseClient,
    viewerAClient: SupabaseClient,
    fieldWorkerAClient: SupabaseClient,
    ownerBClient: SupabaseClient;
  let tenantAId: string, tenantBId: string;

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

    ownerA = await createUser("a-owner");
    adminA = await createUser("a-admin");
    estimatorA = await createUser("a-estimator");
    salesA = await createUser("a-sales");
    viewerA = await createUser("a-viewer");
    fieldWorkerA = await createUser("a-field-worker");
    ownerB = await createUser("b-owner");

    [ownerAClient, adminAClient, estimatorAClient, salesAClient, viewerAClient, fieldWorkerAClient, ownerBClient] = await Promise.all([
      signIn(ownerA.email),
      signIn(adminA.email),
      signIn(estimatorA.email),
      signIn(salesA.email),
      signIn(viewerA.email),
      signIn(fieldWorkerA.email),
      signIn(ownerB.email),
    ]);

    const { data: tenantA } = await ownerAClient
      .rpc("create_tenant_with_owner", { p_name: "AI Text Tenant A", p_slug: `ai-text-a-${RUN_ID}` })
      .single();
    tenantAId = (tenantA as { id: string }).id;

    const { data: tenantB } = await ownerBClient
      .rpc("create_tenant_with_owner", { p_name: "AI Text Tenant B", p_slug: `ai-text-b-${RUN_ID}` })
      .single();
    tenantBId = (tenantB as { id: string }).id;

    async function inviteAndAccept(client: SupabaseClient, targetEmail: string, role: string) {
      const { data: invite, error: inviteErr } = await ownerAClient
        .rpc("invite_member_by_email", { p_tenant_id: tenantAId, p_email: targetEmail, p_role_key: role })
        .single();
      if (inviteErr) throw inviteErr;
      const { error: acceptErr } = await client.rpc("accept_invitation", { p_membership_id: (invite as { id: string }).id });
      if (acceptErr) throw acceptErr;
    }

    await inviteAndAccept(adminAClient, adminA.email, "admin");
    await inviteAndAccept(estimatorAClient, estimatorA.email, "estimator");
    await inviteAndAccept(salesAClient, salesA.email, "sales");
    await inviteAndAccept(viewerAClient, viewerA.email, "viewer");
    await inviteAndAccept(fieldWorkerAClient, fieldWorkerA.email, "field_worker");
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

  describe("business_profiles", () => {
    it("get_business_profile lazily creates a row with defaults for every tenant member (tenant.view)", async () => {
      const { data, error } = await estimatorAClient.rpc("get_business_profile", { p_tenant_id: tenantAId }).single();
      expect(error).toBeNull();
      const row = data as BusinessProfileRow;
      expect(row.tenant_id).toBe(tenantAId);
      expect(row.tone_preference).toBe("professional");
    });

    it("Owner can update the business profile", async () => {
      const { data, error } = await ownerAClient
        .rpc("update_business_profile", {
          p_tenant_id: tenantAId,
          p_business_name: "Mike's Painting",
          p_industry: "Residential painting",
          p_main_services: "",
          p_service_area: "",
          p_business_address: "",
          p_business_phone: "",
          p_business_email: "",
          p_license_number: "",
          p_insurance_statement: "",
          p_default_warranty_policy: "One year workmanship warranty.",
          p_default_payment_terms: "",
          p_default_deposit_policy: "",
          p_default_change_order_policy: "",
          p_default_cancellation_policy: "",
          p_default_cleanup_policy: "",
          p_default_materials_policy: "",
          p_default_client_responsibilities: "",
          p_default_exclusions: "",
          p_tone_preference: "friendly",
        })
        .single();
      expect(error).toBeNull();
      const row = data as BusinessProfileRow;
      expect(row.business_name).toBe("Mike's Painting");
      expect(row.tone_preference).toBe("friendly");

      // Every tenant member can read the updated profile.
      const { data: viewerRead } = await viewerAClient.rpc("get_business_profile", { p_tenant_id: tenantAId }).single();
      expect((viewerRead as BusinessProfileRow).business_name).toBe("Mike's Painting");
    });

    it("Admin can update the business profile", async () => {
      const { error } = await adminAClient.rpc("update_business_profile", {
        p_tenant_id: tenantAId,
        p_business_name: "Mike's Painting LLC",
        p_industry: "",
        p_main_services: "",
        p_service_area: "",
        p_business_address: "",
        p_business_phone: "",
        p_business_email: "",
        p_license_number: "",
        p_insurance_statement: "",
        p_default_warranty_policy: "",
        p_default_payment_terms: "",
        p_default_deposit_policy: "",
        p_default_change_order_policy: "",
        p_default_cancellation_policy: "",
        p_default_cleanup_policy: "",
        p_default_materials_policy: "",
        p_default_client_responsibilities: "",
        p_default_exclusions: "",
        p_tone_preference: "professional",
      });
      expect(error).toBeNull();
    });

    it("Estimator CANNOT update the business profile (view-only)", async () => {
      const { error } = await estimatorAClient.rpc("update_business_profile", {
        p_tenant_id: tenantAId,
        p_business_name: "Hijacked name",
        p_industry: "",
        p_main_services: "",
        p_service_area: "",
        p_business_address: "",
        p_business_phone: "",
        p_business_email: "",
        p_license_number: "",
        p_insurance_statement: "",
        p_default_warranty_policy: "",
        p_default_payment_terms: "",
        p_default_deposit_policy: "",
        p_default_change_order_policy: "",
        p_default_cancellation_policy: "",
        p_default_cleanup_policy: "",
        p_default_materials_policy: "",
        p_default_client_responsibilities: "",
        p_default_exclusions: "",
        p_tone_preference: "professional",
      });
      expect(error).not.toBeNull();
    });

    it("a blank business name is rejected", async () => {
      const { error } = await ownerAClient.rpc("update_business_profile", {
        p_tenant_id: tenantAId,
        p_business_name: "   ",
        p_industry: "",
        p_main_services: "",
        p_service_area: "",
        p_business_address: "",
        p_business_phone: "",
        p_business_email: "",
        p_license_number: "",
        p_insurance_statement: "",
        p_default_warranty_policy: "",
        p_default_payment_terms: "",
        p_default_deposit_policy: "",
        p_default_change_order_policy: "",
        p_default_cancellation_policy: "",
        p_default_cleanup_policy: "",
        p_default_materials_policy: "",
        p_default_client_responsibilities: "",
        p_default_exclusions: "",
        p_tone_preference: "professional",
      });
      expect(error).not.toBeNull();
    });

    it("Tenant B's owner cannot read or update Tenant A's business profile (not a member)", async () => {
      const { error: readErr } = await ownerBClient.rpc("get_business_profile", { p_tenant_id: tenantAId });
      expect(readErr).not.toBeNull();

      const { error: updateErr } = await ownerBClient.rpc("update_business_profile", {
        p_tenant_id: tenantAId,
        p_business_name: "Cross-tenant write attempt",
        p_industry: "",
        p_main_services: "",
        p_service_area: "",
        p_business_address: "",
        p_business_phone: "",
        p_business_email: "",
        p_license_number: "",
        p_insurance_statement: "",
        p_default_warranty_policy: "",
        p_default_payment_terms: "",
        p_default_deposit_policy: "",
        p_default_change_order_policy: "",
        p_default_cancellation_policy: "",
        p_default_cleanup_policy: "",
        p_default_materials_policy: "",
        p_default_client_responsibilities: "",
        p_default_exclusions: "",
        p_tone_preference: "professional",
      });
      expect(updateErr).not.toBeNull();
    });

    it("business_profiles has no direct insert/update/delete grant — only the RPCs can write it", async () => {
      const { error: insertErr } = await ownerAClient.from("business_profiles").insert({ tenant_id: tenantAId, business_name: "Direct insert" });
      expect(insertErr).not.toBeNull();

      // No UPDATE policy exists on this table at all (only SELECT, granted
      // in 20260819100200_business_profiles_rls.sql) — PostgREST doesn't
      // always surface that as a thrown `error` (a fully RLS-filtered
      // UPDATE can report 0 rows affected without erroring), so the real
      // assertion is that the row's data is provably unchanged, not just
      // that `error` is non-null.
      await ownerAClient.from("business_profiles").update({ business_name: "Direct update" }).eq("tenant_id", tenantAId);
      const { data: unchanged } = await ownerAClient.rpc("get_business_profile", { p_tenant_id: tenantAId }).single();
      expect((unchanged as BusinessProfileRow).business_name).not.toBe("Direct update");
    });
  });

  describe("ai_generation_events / ai.generate_proposal_text permission", () => {
    it("Owner/Admin/Estimator/Sales CAN call count_recent_ai_generations (have ai.generate_proposal_text)", async () => {
      for (const client of [ownerAClient, adminAClient, estimatorAClient, salesAClient]) {
        const { error } = await client.rpc("count_recent_ai_generations", { p_tenant_id: tenantAId });
        expect(error).toBeNull();
      }
    });

    it("Viewer and Field Worker CANNOT call count_recent_ai_generations (no ai.generate_proposal_text)", async () => {
      for (const client of [viewerAClient, fieldWorkerAClient]) {
        const { error } = await client.rpc("count_recent_ai_generations", { p_tenant_id: tenantAId });
        expect(error).not.toBeNull();
      }
    });

    it("record_ai_generation_event inserts a row for a permitted user, and the count reflects it", async () => {
      const before = await ownerAClient.rpc("count_recent_ai_generations", { p_tenant_id: tenantAId });
      const { error } = await ownerAClient.rpc("record_ai_generation_event", {
        p_tenant_id: tenantAId,
        p_proposal_id: null,
        p_proposal_version_id: null,
        p_feature: "terms",
        p_model: "test-model",
        p_status: "success",
        p_error_code: null,
        p_input_tokens: 10,
        p_output_tokens: 20,
      });
      expect(error).toBeNull();

      const after = await ownerAClient.rpc("count_recent_ai_generations", { p_tenant_id: tenantAId });
      expect((after.data as number) - (before.data as number)).toBe(1);
    });

    it("Viewer CANNOT call record_ai_generation_event (no ai.generate_proposal_text)", async () => {
      const { error } = await viewerAClient.rpc("record_ai_generation_event", {
        p_tenant_id: tenantAId,
        p_proposal_id: null,
        p_proposal_version_id: null,
        p_feature: "terms",
        p_model: "test-model",
        p_status: "success",
        p_error_code: null,
        p_input_tokens: null,
        p_output_tokens: null,
      });
      expect(error).not.toBeNull();
    });

    it("count_recent_ai_generations is scoped per-user: Owner's events don't count against Admin's limit", async () => {
      const adminCountBefore = await adminAClient.rpc("count_recent_ai_generations", { p_tenant_id: tenantAId });
      await ownerAClient.rpc("record_ai_generation_event", {
        p_tenant_id: tenantAId,
        p_proposal_id: null,
        p_proposal_version_id: null,
        p_feature: "exclusions",
        p_model: "test-model",
        p_status: "success",
        p_error_code: null,
        p_input_tokens: null,
        p_output_tokens: null,
      });
      const adminCountAfter = await adminAClient.rpc("count_recent_ai_generations", { p_tenant_id: tenantAId });
      expect(adminCountAfter.data).toBe(adminCountBefore.data);
    });

    it("Tenant B's owner cannot generate against Tenant A (not a member -- no permission there at all)", async () => {
      const { error } = await ownerBClient.rpc("count_recent_ai_generations", { p_tenant_id: tenantAId });
      expect(error).not.toBeNull();
    });

    it("ai_generation_events has no direct insert/update/delete grant -- only record_ai_generation_event() can write it, and it is truly append-only", async () => {
      const { error: insertErr } = await ownerAClient
        .from("ai_generation_events")
        .insert({ tenant_id: tenantAId, feature: "terms", model: "x", status: "success" });
      expect(insertErr).not.toBeNull();

      const { data: existing } = await ownerAClient
        .from("ai_generation_events")
        .select("id")
        .eq("tenant_id", tenantAId)
        .limit(1)
        .single();
      if (existing) {
        const { error: updateErr } = await admin.from("ai_generation_events").update({ status: "error" }).eq("id", (existing as { id: string }).id);
        expect(updateErr).not.toBeNull();
        const { error: deleteErr } = await admin.from("ai_generation_events").delete().eq("id", (existing as { id: string }).id);
        expect(deleteErr).not.toBeNull();
      }
    });

    it("Tenant A members can only SELECT their own tenant's generation events, never Tenant B's", async () => {
      await ownerBClient.rpc("record_ai_generation_event", {
        p_tenant_id: tenantBId,
        p_proposal_id: null,
        p_proposal_version_id: null,
        p_feature: "client_notes",
        p_model: "test-model",
        p_status: "success",
        p_error_code: null,
        p_input_tokens: null,
        p_output_tokens: null,
      });

      const { data } = await ownerAClient.from("ai_generation_events").select("tenant_id").eq("tenant_id", tenantBId);
      expect(data).toEqual([]);
    });
  });
});
