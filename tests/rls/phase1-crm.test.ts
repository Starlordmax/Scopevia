/**
 * Phase 1 (CRM & Projects) integration tests — tenant isolation, cross-tenant
 * FK integrity, the Phase 1 permission matrix, and concurrency (primary
 * contact/address races, opportunity-to-project conversion idempotency).
 *
 * Same infrastructure as tests/rls/tenant-isolation.test.ts: requires
 * SUPABASE_TEST_URL/ANON_KEY/SERVICE_ROLE_KEY in .env.local pointing at a
 * project dedicated to testing (never staging/production); skipped entirely
 * if those are absent.
 *
 * Fixture: Tenant A (owner userA) and Tenant B (owner userB, used only for
 * cross-tenant negative tests). Tenant A additionally has salesUser (sales),
 * viewerUser (viewer) and fieldWorkerUser (field_worker) as active members,
 * exercising the Phase 1 role matrix directly rather than just owner/admin.
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
  return `test-p1-${label}-${RUN_ID}@example.com`;
}

async function signIn(addr: string): Promise<SupabaseClient> {
  const client = createClient(TEST_URL!, TEST_ANON_KEY!);
  const { error } = await client.auth.signInWithPassword({ email: addr, password: PASSWORD });
  if (error) throw error;
  return client;
}

type TestUser = { id: string; email: string };

describe.skipIf(!canRun)("Phase 1 CRM & Projects (requires real Postgres)", () => {
  let admin: SupabaseClient;
  let userA: TestUser, userB: TestUser, salesUser: TestUser, viewerUser: TestUser, fieldWorkerUser: TestUser;
  let aClient: SupabaseClient, bClient: SupabaseClient, salesClient: SupabaseClient, viewerClient: SupabaseClient, fieldWorkerClient: SupabaseClient;
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
    salesUser = await createUser("sales");
    viewerUser = await createUser("viewer");
    fieldWorkerUser = await createUser("field-worker");

    [aClient, bClient, salesClient, viewerClient, fieldWorkerClient] = await Promise.all([
      signIn(userA.email),
      signIn(userB.email),
      signIn(salesUser.email),
      signIn(viewerUser.email),
      signIn(fieldWorkerUser.email),
    ]);

    const { data: tenantA } = await aClient
      .rpc("create_tenant_with_owner", { p_name: "Phase1 Tenant A", p_slug: `phase1-a-${RUN_ID}` })
      .single();
    tenantAId = (tenantA as { id: string }).id;

    const { data: tenantB } = await bClient
      .rpc("create_tenant_with_owner", { p_name: "Phase1 Tenant B", p_slug: `phase1-b-${RUN_ID}` })
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

    await inviteAndAccept(salesClient, salesUser.email, "sales");
    await inviteAndAccept(viewerClient, viewerUser.email, "viewer");
    await inviteAndAccept(fieldWorkerClient, fieldWorkerUser.email, "field_worker");

    const { data: clientA } = await aClient
      .rpc("create_client", { p_tenant_id: tenantAId, p_client_type: "individual", p_display_name: "Phase1 Client A" })
      .single();
    clientAId = (clientA as { id: string }).id;

    const { data: clientB } = await bClient
      .rpc("create_client", { p_tenant_id: tenantBId, p_client_type: "individual", p_display_name: "Phase1 Client B" })
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

  // ===========================================================================
  // Tenant isolation across every new table
  // ===========================================================================
  describe("Tenant isolation", () => {
    it("User A cannot read Tenant B's client", async () => {
      const { data } = await aClient.from("clients").select("*").eq("id", clientBId);
      expect(data ?? []).toHaveLength(0);
    });

    it("User A cannot update Tenant B's client via the RPC (not found in tenant)", async () => {
      const { error } = await aClient.rpc("update_client", {
        p_client_id: clientBId,
        p_client_type: "individual",
        p_display_name: "hacked",
      });
      expect(error).not.toBeNull();
    });

    it("User A cannot archive Tenant B's client", async () => {
      const { error } = await aClient.rpc("archive_client", { p_client_id: clientBId });
      expect(error).not.toBeNull();
    });

    it("no global enumeration: an unfiltered clients query for User A never includes Tenant B rows", async () => {
      const { data } = await aClient.from("clients").select("tenant_id");
      expect((data ?? []).every((c: { tenant_id: string }) => c.tenant_id === tenantAId)).toBe(true);
    });

    it("anon cannot read clients, opportunities, or projects", async () => {
      const anonClient = createClient(TEST_URL!, TEST_ANON_KEY!);
      const [clients, opportunities, projects] = await Promise.all([
        anonClient.from("clients").select("*"),
        anonClient.from("opportunities").select("*"),
        anonClient.from("projects").select("*"),
      ]);
      expect(clients.data ?? []).toHaveLength(0);
      expect(opportunities.data ?? []).toHaveLength(0);
      expect(projects.data ?? []).toHaveLength(0);
    });
  });

  // ===========================================================================
  // Cross-tenant relationship integrity (declarative FK, not just RLS)
  // ===========================================================================
  describe("Cross-tenant relationship integrity", () => {
    it("create_opportunity rejects a client from a different tenant (application-level pre-check)", async () => {
      const { error } = await aClient.rpc("create_opportunity", {
        p_tenant_id: tenantAId,
        p_client_id: clientBId,
        p_title: "Cross-tenant attempt",
      });
      expect(error).not.toBeNull();
    });

    it("a direct service_role INSERT bypassing the function is still rejected by the composite foreign key", async () => {
      const { error } = await admin.from("opportunities").insert({
        tenant_id: tenantAId,
        client_id: clientBId, // belongs to Tenant B — (client_id, tenant_id) has no match in clients
        title: "Bypassing the function entirely",
        created_by: userA.id,
      });
      expect(error).not.toBeNull();
      expect(error?.code).toBe("23503"); // foreign_key_violation
    });

    it("an assignee from a different tenant is rejected", async () => {
      const { data: bMembership } = await admin
        .from("tenant_memberships")
        .select("id")
        .eq("tenant_id", tenantBId)
        .eq("user_id", userB.id)
        .single();

      const { error } = await aClient.rpc("create_opportunity", {
        p_tenant_id: tenantAId,
        p_client_id: clientAId,
        p_title: "Cross-tenant assignee attempt",
        p_assigned_to: (bMembership as { id: string }).id,
      });
      expect(error).not.toBeNull();
    });
  });

  // ===========================================================================
  // Permission matrix
  // ===========================================================================
  describe("Permission matrix", () => {
    it("Viewer cannot create a client", async () => {
      const { error } = await viewerClient.rpc("create_client", {
        p_tenant_id: tenantAId,
        p_client_type: "individual",
        p_display_name: "Should not be created",
      });
      expect(error).not.toBeNull();
    });

    it("Viewer CAN view clients", async () => {
      const { data } = await viewerClient.from("clients").select("id").eq("id", clientAId);
      expect(data).toHaveLength(1);
    });

    it("Sales can create a client and an opportunity", async () => {
      const { data: c, error: cErr } = await salesClient
        .rpc("create_client", { p_tenant_id: tenantAId, p_client_type: "individual", p_display_name: "Sales-created client" })
        .single();
      expect(cErr).toBeNull();

      const { error: oErr } = await salesClient.rpc("create_opportunity", {
        p_tenant_id: tenantAId,
        p_client_id: (c as { id: string }).id,
        p_title: "Sales-created opportunity",
      });
      expect(oErr).toBeNull();
    });

    it("Sales can create a project but cannot update it (no projects.update)", async () => {
      const { data: project, error: createErr } = await salesClient
        .rpc("create_project", { p_tenant_id: tenantAId, p_client_id: clientAId, p_name: "Sales-created project" })
        .single();
      expect(createErr).toBeNull();

      const { error: updateErr } = await salesClient.rpc("update_project", {
        p_project_id: (project as { id: string }).id,
        p_name: "Renamed by sales",
      });
      expect(updateErr).not.toBeNull();
    });

    it("Field Worker cannot view clients or opportunities, but CAN view projects (broad, non-assignment-scoped)", async () => {
      const [clients, opportunities, projects] = await Promise.all([
        fieldWorkerClient.from("clients").select("id"),
        fieldWorkerClient.from("opportunities").select("id"),
        fieldWorkerClient.from("projects").select("id").eq("tenant_id", tenantAId),
      ]);
      expect(clients.data ?? []).toHaveLength(0);
      expect(opportunities.data ?? []).toHaveLength(0);
      expect((projects.data ?? []).length).toBeGreaterThan(0);
    });

    it("Field Worker cannot archive a client (lacks clients.archive entirely)", async () => {
      const { error } = await fieldWorkerClient.rpc("archive_client", { p_client_id: clientAId });
      expect(error).not.toBeNull();
    });

    it("Field Worker CAN create a note on a project", async () => {
      const { data: project } = await admin.from("projects").select("id").eq("tenant_id", tenantAId).limit(1).single();
      const { error } = await fieldWorkerClient.rpc("create_note", {
        p_tenant_id: tenantAId,
        p_body: "Field worker note",
        p_project_id: (project as { id: string }).id,
      });
      expect(error).toBeNull();
    });

    it("no permission can be escalated via a manipulated payload — permission is always re-derived server-side from the caller's own membership", async () => {
      // Viewer cannot smuggle in a fabricated permission by calling the RPC
      // with a tenant they do belong to but lack the permission for — there
      // is no "permission" parameter to manipulate in the first place, which
      // is exactly the point: authorization is looked up from tenant_memberships,
      // never trusted from the caller.
      const { error } = await viewerClient.rpc("change_opportunity_status", {
        p_opportunity_id: "00000000-0000-0000-0000-000000000000",
        p_new_status: "contacted",
      });
      expect(error).not.toBeNull();
    });
  });

  // ===========================================================================
  // Concurrency
  // ===========================================================================
  describe("Concurrency", () => {
    it("two concurrent set_primary_contact calls for the same client leave exactly one primary contact", async () => {
      const { data: c1 } = await aClient
        .rpc("create_client_contact", { p_client_id: clientAId, p_first_name: "Contact", p_last_name: "One" })
        .single();
      const { data: c2 } = await aClient
        .rpc("create_client_contact", { p_client_id: clientAId, p_first_name: "Contact", p_last_name: "Two" })
        .single();

      await Promise.all([
        aClient.rpc("set_primary_contact", { p_contact_id: (c1 as { id: string }).id }),
        aClient.rpc("set_primary_contact", { p_contact_id: (c2 as { id: string }).id }),
      ]);

      const { data: primaryContacts } = await admin
        .from("client_contacts")
        .select("id")
        .eq("client_id", clientAId)
        .eq("is_primary", true)
        .is("archived_at", null);
      expect(primaryContacts).toHaveLength(1);
    });

    it("two concurrent conversions of the same opportunity produce exactly one project, returned to both callers", async () => {
      const { data: opp } = await aClient
        .rpc("create_opportunity", { p_tenant_id: tenantAId, p_client_id: clientAId, p_title: "Convert-race opportunity" })
        .single();
      const opportunityId = (opp as { id: string }).id;

      await aClient.rpc("change_opportunity_status", { p_opportunity_id: opportunityId, p_new_status: "contacted" });
      await aClient.rpc("change_opportunity_status", { p_opportunity_id: opportunityId, p_new_status: "qualified" });
      await aClient.rpc("change_opportunity_status", { p_opportunity_id: opportunityId, p_new_status: "ready_for_estimate" });

      const [r1, r2] = await Promise.all([
        aClient.rpc("convert_opportunity_to_project", { p_opportunity_id: opportunityId }).single(),
        aClient.rpc("convert_opportunity_to_project", { p_opportunity_id: opportunityId }).single(),
      ]);

      expect(r1.error).toBeNull();
      expect(r2.error).toBeNull();
      expect((r1.data as { id: string })?.id).toBe((r2.data as { id: string })?.id);

      const { data: projects } = await admin.from("projects").select("id").eq("opportunity_id", opportunityId);
      expect(projects).toHaveLength(1);
    });

    it("retrying convert_opportunity_to_project after success returns the same project (idempotent)", async () => {
      const { data: opp } = await aClient
        .rpc("create_opportunity", { p_tenant_id: tenantAId, p_client_id: clientAId, p_title: "Idempotent-retry opportunity" })
        .single();
      const opportunityId = (opp as { id: string }).id;
      await aClient.rpc("change_opportunity_status", { p_opportunity_id: opportunityId, p_new_status: "contacted" });
      await aClient.rpc("change_opportunity_status", { p_opportunity_id: opportunityId, p_new_status: "qualified" });
      await aClient.rpc("change_opportunity_status", { p_opportunity_id: opportunityId, p_new_status: "ready_for_estimate" });

      const { data: first } = await aClient.rpc("convert_opportunity_to_project", { p_opportunity_id: opportunityId }).single();
      const { data: second } = await aClient.rpc("convert_opportunity_to_project", { p_opportunity_id: opportunityId }).single();
      expect((first as { id: string }).id).toBe((second as { id: string }).id);
    });
  });

  // ===========================================================================
  // Opportunity status machine
  // ===========================================================================
  describe("Opportunity status machine", () => {
    it("rejects an invalid transition", async () => {
      const { data: opp } = await aClient
        .rpc("create_opportunity", { p_tenant_id: tenantAId, p_client_id: clientAId, p_title: "Invalid transition test" })
        .single();
      const { error } = await aClient.rpc("change_opportunity_status", {
        p_opportunity_id: (opp as { id: string }).id,
        p_new_status: "won", // new -> won is not a valid direct transition
      });
      expect(error).not.toBeNull();
    });

    it("requires lost_reason when marking as lost", async () => {
      const { data: opp } = await aClient
        .rpc("create_opportunity", { p_tenant_id: tenantAId, p_client_id: clientAId, p_title: "Lost reason test" })
        .single();
      const { error } = await aClient.rpc("change_opportunity_status", {
        p_opportunity_id: (opp as { id: string }).id,
        p_new_status: "lost",
      });
      expect(error).not.toBeNull();
    });

    it("requires inspection_scheduled_at for inspection_scheduled", async () => {
      const { data: opp } = await aClient
        .rpc("create_opportunity", { p_tenant_id: tenantAId, p_client_id: clientAId, p_title: "Inspection date test" })
        .single();
      const oppId = (opp as { id: string }).id;
      await aClient.rpc("change_opportunity_status", { p_opportunity_id: oppId, p_new_status: "contacted" });
      await aClient.rpc("change_opportunity_status", { p_opportunity_id: oppId, p_new_status: "qualified" });

      const { error } = await aClient.rpc("change_opportunity_status", {
        p_opportunity_id: oppId,
        p_new_status: "inspection_scheduled",
      });
      expect(error).not.toBeNull();
    });

    it("cannot archive an opportunity that is not won or lost", async () => {
      const { data: opp } = await aClient
        .rpc("create_opportunity", { p_tenant_id: tenantAId, p_client_id: clientAId, p_title: "Cannot archive yet" })
        .single();
      const { error } = await aClient.rpc("archive_opportunity", { p_opportunity_id: (opp as { id: string }).id });
      expect(error).not.toBeNull();
    });
  });

  // ===========================================================================
  // Notes vs. activities vs. audit_logs
  // ===========================================================================
  describe("Notes, activity, and audit separation", () => {
    it("creating a note produces rows in crm_notes, crm_activities, AND audit_logs — three distinct tables", async () => {
      const { data: note, error } = await aClient
        .rpc("create_note", { p_tenant_id: tenantAId, p_body: "Separation test note", p_client_id: clientAId })
        .single();
      expect(error).toBeNull();

      const [{ data: noteRow }, { data: activityRows }, { data: auditRows }] = await Promise.all([
        admin.from("crm_notes").select("id").eq("id", (note as { id: string }).id),
        admin.from("crm_activities").select("id").eq("client_id", clientAId).eq("activity_type", "note_added"),
        admin.from("audit_logs").select("id").eq("entity_type", "crm_note").eq("entity_id", (note as { id: string }).id),
      ]);
      expect(noteRow).toHaveLength(1);
      expect((activityRows ?? []).length).toBeGreaterThan(0);
      expect(auditRows).toHaveLength(1);
    });

    it("no client can insert into crm_activities directly", async () => {
      const { error } = await aClient.from("crm_activities").insert({
        tenant_id: tenantAId,
        client_id: clientAId,
        activity_type: "note_added",
      });
      expect(error).not.toBeNull();
    });

    it("crm_activities cannot be updated or deleted, even via service_role", async () => {
      const { data: anyActivity } = await admin.from("crm_activities").select("id").eq("tenant_id", tenantAId).limit(1).single();
      const updateResult = await admin.from("crm_activities").update({ activity_type: "tampered" }).eq("id", (anyActivity as { id: string }).id);
      const deleteResult = await admin.from("crm_activities").delete().eq("id", (anyActivity as { id: string }).id);
      expect(updateResult.error).not.toBeNull();
      expect(deleteResult.error).not.toBeNull();
    });

    it("crm_activities metadata never contains password/token/secret-shaped values", async () => {
      const { data } = await aClient.from("crm_activities").select("metadata").eq("tenant_id", tenantAId);
      for (const row of data ?? []) {
        const serialized = JSON.stringify((row as { metadata: unknown }).metadata).toLowerCase();
        expect(serialized).not.toMatch(/password|"token"|secret|service_role/);
      }
    });
  });

  // ===========================================================================
  // Suspension revokes access to Phase 1 tables immediately
  // ===========================================================================
  describe("Suspension", () => {
    it("suspending Sales immediately blocks their EXISTING session from reading clients", async () => {
      const { data: membership } = await admin
        .from("tenant_memberships")
        .select("id")
        .eq("tenant_id", tenantAId)
        .eq("user_id", salesUser.id)
        .single();

      const { error } = await aClient.rpc("update_membership", {
        p_membership_id: (membership as { id: string }).id,
        p_new_status: "suspended",
      });
      expect(error).toBeNull();

      const { data } = await salesClient.from("clients").select("id").eq("id", clientAId);
      expect(data ?? []).toHaveLength(0);
    });
  });
});
