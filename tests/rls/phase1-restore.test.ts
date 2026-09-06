/**
 * Dedicated automated coverage for the five Phase 1 restore operations:
 * restore_client, restore_client_contact, restore_opportunity,
 * restore_project, restore_project_address. These existed and were
 * architecturally reviewed (ADR 0010) but had zero automated test coverage
 * before this file — the archive path was tested, restore was not.
 *
 * For each function: restores with correct permission; is a safe no-op on
 * an already-active resource; Viewer cannot restore; Tenant A cannot
 * restore Tenant B's resource; a suspended user's already-issued session
 * immediately loses the ability to restore; archived_at/archived_by end up
 * null; an audit_logs row is written; a crm_activities row is written IF
 * (and only if) the underlying function actually calls log_crm_activity()
 * for that action (contacts and project addresses do not — verified against
 * the migration source, not assumed uniform across all five).
 *
 * Same infrastructure/conventions as tests/rls/phase1-crm.test.ts: requires
 * SUPABASE_TEST_URL/ANON_KEY/SERVICE_ROLE_KEY in .env.local pointing at the
 * scopevia-test project; skipped entirely if absent.
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
  return `test-restore-${label}-${RUN_ID}@example.com`;
}

async function signIn(addr: string): Promise<SupabaseClient> {
  const client = createClient(TEST_URL!, TEST_ANON_KEY!);
  const { error } = await client.auth.signInWithPassword({ email: addr, password: PASSWORD });
  if (error) throw error;
  return client;
}

type TestUser = { id: string; email: string };

describe.skipIf(!canRun)("Phase 1 restore coverage (requires real Postgres)", () => {
  let admin: SupabaseClient;
  let userA: TestUser, userB: TestUser, viewerUser: TestUser, adminUser: TestUser;
  let aClient: SupabaseClient, bClient: SupabaseClient, viewerClient: SupabaseClient, adminClientA: SupabaseClient;
  let tenantAId: string, tenantBId: string;
  let clientAId: string, clientBId: string;
  let adminMembershipId: string;

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
    viewerUser = await createUser("viewer");
    adminUser = await createUser("admin");

    [aClient, bClient, viewerClient, adminClientA] = await Promise.all([
      signIn(userA.email),
      signIn(userB.email),
      signIn(viewerUser.email),
      signIn(adminUser.email),
    ]);

    const { data: tenantA } = await aClient
      .rpc("create_tenant_with_owner", { p_name: "Phase1 Restore Tenant A", p_slug: `p1restore-a-${RUN_ID}` })
      .single();
    tenantAId = (tenantA as { id: string }).id;

    const { data: tenantB } = await bClient
      .rpc("create_tenant_with_owner", { p_name: "Phase1 Restore Tenant B", p_slug: `p1restore-b-${RUN_ID}` })
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

    await inviteAndAccept(viewerClient, viewerUser.email, "viewer");
    adminMembershipId = await inviteAndAccept(adminClientA, adminUser.email, "admin");

    const { data: clientA } = await aClient
      .rpc("create_client", { p_tenant_id: tenantAId, p_client_type: "individual", p_display_name: "Restore Client A" })
      .single();
    clientAId = (clientA as { id: string }).id;

    const { data: clientB } = await bClient
      .rpc("create_client", { p_tenant_id: tenantBId, p_client_type: "individual", p_display_name: "Restore Client B" })
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
  // restore_client
  // ===========================================================================
  describe("restore_client", () => {
    it("restores an archived client, clears archived_at/archived_by, logs audit + activity", async () => {
      const { data: c } = await aClient
        .rpc("create_client", { p_tenant_id: tenantAId, p_client_type: "individual", p_display_name: "Restorable Client" })
        .single();
      const id = (c as { id: string }).id;
      await aClient.rpc("archive_client", { p_client_id: id });

      const { data: restored, error } = await aClient.rpc("restore_client", { p_client_id: id }).single();
      expect(error).toBeNull();
      expect((restored as { archived_at: string | null }).archived_at).toBeNull();
      expect((restored as { archived_by: string | null }).archived_by).toBeNull();

      const { data: row } = await admin.from("clients").select("archived_at, archived_by").eq("id", id).single();
      expect((row as { archived_at: string | null }).archived_at).toBeNull();
      expect((row as { archived_by: string | null }).archived_by).toBeNull();

      const { data: auditRows } = await admin.from("audit_logs").select("id").eq("entity_id", id).eq("action", "client.restored");
      expect(auditRows).toHaveLength(1);
      const { data: activityRows } = await admin
        .from("crm_activities")
        .select("id")
        .eq("client_id", id)
        .eq("activity_type", "client_restored");
      expect(activityRows).toHaveLength(1);
    });

    it("is a safe no-op when the client is not archived (no corruption)", async () => {
      const { data: c } = await aClient
        .rpc("create_client", { p_tenant_id: tenantAId, p_client_type: "individual", p_display_name: "Never Archived Client" })
        .single();
      const id = (c as { id: string }).id;

      const { data: result, error } = await aClient.rpc("restore_client", { p_client_id: id }).single();
      expect(error).toBeNull();
      expect((result as { id: string }).id).toBe(id);

      const { data: auditRows } = await admin.from("audit_logs").select("id").eq("entity_id", id).eq("action", "client.restored");
      expect(auditRows ?? []).toHaveLength(0);
    });

    it("Viewer cannot restore", async () => {
      await aClient.rpc("archive_client", { p_client_id: clientAId });
      const { error } = await viewerClient.rpc("restore_client", { p_client_id: clientAId });
      expect(error).not.toBeNull();
      await aClient.rpc("restore_client", { p_client_id: clientAId }); // put it back for later tests
    });

    it("Tenant A cannot restore Tenant B's client", async () => {
      await bClient.rpc("archive_client", { p_client_id: clientBId });
      const { error } = await aClient.rpc("restore_client", { p_client_id: clientBId });
      expect(error).not.toBeNull();
      const { data: row } = await admin.from("clients").select("archived_at").eq("id", clientBId).single();
      expect((row as { archived_at: string | null }).archived_at).not.toBeNull(); // untouched, still archived
    });

    it("a suspended user's existing session cannot restore", async () => {
      const { data: c } = await aClient
        .rpc("create_client", { p_tenant_id: tenantAId, p_client_type: "individual", p_display_name: "Suspend Test Client" })
        .single();
      const id = (c as { id: string }).id;
      await aClient.rpc("archive_client", { p_client_id: id });

      await aClient.rpc("update_membership", { p_membership_id: adminMembershipId, p_new_status: "suspended" });
      const { error } = await adminClientA.rpc("restore_client", { p_client_id: id });
      expect(error).not.toBeNull();

      await aClient.rpc("update_membership", { p_membership_id: adminMembershipId, p_new_status: "active" });
    });
  });

  // ===========================================================================
  // restore_client_contact
  // ===========================================================================
  describe("restore_client_contact", () => {
    async function archivedContact() {
      const { data: contact } = await aClient
        .rpc("create_client_contact", { p_client_id: clientAId, p_first_name: "Restore", p_last_name: "Contact" })
        .single();
      const id = (contact as { id: string }).id;
      await aClient.rpc("archive_client_contact", { p_contact_id: id });
      return id;
    }

    it("restores an archived contact, clears archived_at/archived_by, logs audit (no crm_activity for contacts)", async () => {
      const id = await archivedContact();
      const { data: restored, error } = await aClient.rpc("restore_client_contact", { p_contact_id: id }).single();
      expect(error).toBeNull();
      expect((restored as { archived_at: string | null }).archived_at).toBeNull();
      expect((restored as { archived_by: string | null }).archived_by).toBeNull();

      const { data: auditRows } = await admin
        .from("audit_logs")
        .select("id")
        .eq("entity_id", id)
        .eq("action", "contact.restored");
      expect(auditRows).toHaveLength(1);
      // contact.archived/.restored do not call log_crm_activity() (verified
      // against 20260702130600_crm_functions_clients_contacts.sql) — unlike
      // clients, there is no corresponding activity row.
      const { data: activityRows } = await admin.from("crm_activities").select("id").eq("client_id", clientAId).eq(
        "activity_type",
        "contact_restored"
      );
      expect(activityRows ?? []).toHaveLength(0);
    });

    it("is a safe no-op when the contact is not archived", async () => {
      const { data: contact } = await aClient
        .rpc("create_client_contact", { p_client_id: clientAId, p_first_name: "Never", p_last_name: "Archived" })
        .single();
      const id = (contact as { id: string }).id;
      const { error } = await aClient.rpc("restore_client_contact", { p_contact_id: id });
      expect(error).toBeNull();
    });

    it("Viewer cannot restore", async () => {
      const id = await archivedContact();
      const { error } = await viewerClient.rpc("restore_client_contact", { p_contact_id: id });
      expect(error).not.toBeNull();
    });

    it("Tenant A cannot restore Tenant B's contact", async () => {
      const { data: contactB } = await bClient
        .rpc("create_client_contact", { p_client_id: clientBId, p_first_name: "B", p_last_name: "Contact" })
        .single();
      const idB = (contactB as { id: string }).id;
      await bClient.rpc("archive_client_contact", { p_contact_id: idB });

      const { error } = await aClient.rpc("restore_client_contact", { p_contact_id: idB });
      expect(error).not.toBeNull();
    });

    it("a suspended user's existing session cannot restore", async () => {
      const id = await archivedContact();
      await aClient.rpc("update_membership", { p_membership_id: adminMembershipId, p_new_status: "suspended" });
      const { error } = await adminClientA.rpc("restore_client_contact", { p_contact_id: id });
      expect(error).not.toBeNull();
      await aClient.rpc("update_membership", { p_membership_id: adminMembershipId, p_new_status: "active" });
    });
  });

  // ===========================================================================
  // restore_opportunity
  // ===========================================================================
  describe("restore_opportunity", () => {
    async function archivedOpportunity(client: SupabaseClient, tId: string, cId: string) {
      const { data: opp } = await client
        .rpc("create_opportunity", { p_tenant_id: tId, p_client_id: cId, p_title: "Restore Opp" })
        .single();
      const id = (opp as { id: string }).id;
      await client.rpc("change_opportunity_status", { p_opportunity_id: id, p_new_status: "contacted" });
      await client.rpc("change_opportunity_status", {
        p_opportunity_id: id,
        p_new_status: "lost",
        p_lost_reason: "Budget cut",
      });
      await client.rpc("archive_opportunity", { p_opportunity_id: id });
      return id;
    }

    it("restores an archived opportunity back to its pre-archive status (lost), clears archived_at/by, logs audit (no crm_activity for archive/restore)", async () => {
      const id = await archivedOpportunity(aClient, tenantAId, clientAId);
      const { data: restored, error } = await aClient.rpc("restore_opportunity", { p_opportunity_id: id }).single();
      expect(error).toBeNull();
      expect((restored as { status: string }).status).toBe("lost");
      expect((restored as { archived_at: string | null }).archived_at).toBeNull();
      expect((restored as { archived_by: string | null }).archived_by).toBeNull();
      expect((restored as { pre_archive_status: string | null }).pre_archive_status).toBeNull();

      const { data: auditRows } = await admin
        .from("audit_logs")
        .select("id")
        .eq("entity_id", id)
        .eq("action", "opportunity.restored");
      expect(auditRows).toHaveLength(1);
      // archive_opportunity()/restore_opportunity() do not call
      // log_crm_activity() (verified against
      // 20260702130700_crm_functions_opportunities.sql) — unlike clients/projects.
      const { data: activityRows } = await admin
        .from("crm_activities")
        .select("id")
        .eq("opportunity_id", id)
        .eq("activity_type", "opportunity_restored");
      expect(activityRows ?? []).toHaveLength(0);
    });

    it("is a safe no-op when the opportunity is not archived", async () => {
      const { data: opp } = await aClient
        .rpc("create_opportunity", { p_tenant_id: tenantAId, p_client_id: clientAId, p_title: "Not Archived Opp" })
        .single();
      const id = (opp as { id: string }).id;
      const { data: result, error } = await aClient.rpc("restore_opportunity", { p_opportunity_id: id }).single();
      expect(error).toBeNull();
      expect((result as { status: string }).status).toBe("new");
    });

    it("Viewer cannot restore", async () => {
      const id = await archivedOpportunity(aClient, tenantAId, clientAId);
      const { error } = await viewerClient.rpc("restore_opportunity", { p_opportunity_id: id });
      expect(error).not.toBeNull();
    });

    it("Tenant A cannot restore Tenant B's opportunity", async () => {
      const idB = await archivedOpportunity(bClient, tenantBId, clientBId);
      const { error } = await aClient.rpc("restore_opportunity", { p_opportunity_id: idB });
      expect(error).not.toBeNull();
    });

    it("a suspended user's existing session cannot restore", async () => {
      const id = await archivedOpportunity(aClient, tenantAId, clientAId);
      await aClient.rpc("update_membership", { p_membership_id: adminMembershipId, p_new_status: "suspended" });
      const { error } = await adminClientA.rpc("restore_opportunity", { p_opportunity_id: id });
      expect(error).not.toBeNull();
      await aClient.rpc("update_membership", { p_membership_id: adminMembershipId, p_new_status: "active" });
    });
  });

  // ===========================================================================
  // restore_project
  // ===========================================================================
  describe("restore_project", () => {
    async function archivedProject(client: SupabaseClient, tId: string, cId: string) {
      const { data: project } = await client
        .rpc("create_project", { p_tenant_id: tId, p_client_id: cId, p_name: "Restore Project" })
        .single();
      const id = (project as { id: string }).id;
      await client.rpc("change_project_status", { p_project_id: id, p_new_status: "cancelled" });
      await client.rpc("archive_project", { p_project_id: id });
      return id;
    }

    it("restores an archived project back to its pre-archive status (cancelled), clears archived_at/by, logs audit + activity", async () => {
      const id = await archivedProject(aClient, tenantAId, clientAId);
      const { data: restored, error } = await aClient.rpc("restore_project", { p_project_id: id }).single();
      expect(error).toBeNull();
      expect((restored as { status: string }).status).toBe("cancelled");
      expect((restored as { archived_at: string | null }).archived_at).toBeNull();
      expect((restored as { archived_by: string | null }).archived_by).toBeNull();

      const { data: auditRows } = await admin
        .from("audit_logs")
        .select("id")
        .eq("entity_id", id)
        .eq("action", "project.restored");
      expect(auditRows).toHaveLength(1);
      const { data: activityRows } = await admin
        .from("crm_activities")
        .select("id")
        .eq("project_id", id)
        .eq("activity_type", "project_restored");
      expect(activityRows).toHaveLength(1);
    });

    it("is a safe no-op when the project is not archived", async () => {
      const { data: project } = await aClient
        .rpc("create_project", { p_tenant_id: tenantAId, p_client_id: clientAId, p_name: "Not Archived Project" })
        .single();
      const id = (project as { id: string }).id;
      const { data: result, error } = await aClient.rpc("restore_project", { p_project_id: id }).single();
      expect(error).toBeNull();
      expect((result as { status: string }).status).toBe("draft");
    });

    it("Viewer cannot restore", async () => {
      const id = await archivedProject(aClient, tenantAId, clientAId);
      const { error } = await viewerClient.rpc("restore_project", { p_project_id: id });
      expect(error).not.toBeNull();
    });

    it("Tenant A cannot restore Tenant B's project", async () => {
      const idB = await archivedProject(bClient, tenantBId, clientBId);
      const { error } = await aClient.rpc("restore_project", { p_project_id: idB });
      expect(error).not.toBeNull();
    });

    it("a suspended user's existing session cannot restore", async () => {
      const id = await archivedProject(aClient, tenantAId, clientAId);
      await aClient.rpc("update_membership", { p_membership_id: adminMembershipId, p_new_status: "suspended" });
      const { error } = await adminClientA.rpc("restore_project", { p_project_id: id });
      expect(error).not.toBeNull();
      await aClient.rpc("update_membership", { p_membership_id: adminMembershipId, p_new_status: "active" });
    });
  });

  // ===========================================================================
  // restore_project_address
  // ===========================================================================
  describe("restore_project_address", () => {
    async function archivedAddress(client: SupabaseClient, tId: string, cId: string) {
      const { data: project } = await client
        .rpc("create_project", { p_tenant_id: tId, p_client_id: cId, p_name: "Address Restore Project" })
        .single();
      const projectId = (project as { id: string }).id;
      const { data: addr } = await client
        .rpc("create_project_address", {
          p_project_id: projectId,
          p_address_line_1: "1 Test St",
          p_city: "Testville",
          p_state: "TS",
          p_postal_code: "00000",
        })
        .single();
      const addressId = (addr as { id: string }).id;
      await client.rpc("archive_project_address", { p_address_id: addressId });
      return { addressId, projectId };
    }

    it("restores an archived address, clears archived_at/archived_by, logs audit (no crm_activity), never restores as primary", async () => {
      const { addressId } = await archivedAddress(aClient, tenantAId, clientAId);
      const { data: restored, error } = await aClient.rpc("restore_project_address", { p_address_id: addressId }).single();
      expect(error).toBeNull();
      expect((restored as { archived_at: string | null }).archived_at).toBeNull();
      expect((restored as { archived_by: string | null }).archived_by).toBeNull();
      // archive_project_address() clears is_primary when archiving, and
      // restore does not re-promote it — see 20260702130800's comment.
      expect((restored as { is_primary: boolean }).is_primary).toBe(false);

      const { data: auditRows } = await admin
        .from("audit_logs")
        .select("id")
        .eq("entity_id", addressId)
        .eq("action", "project_address.updated")
        .contains("metadata", { restored: true });
      expect(auditRows).toHaveLength(1);
    });

    it("is a safe no-op when the address is not archived", async () => {
      const { data: project } = await aClient
        .rpc("create_project", { p_tenant_id: tenantAId, p_client_id: clientAId, p_name: "Fresh Address Project" })
        .single();
      const { data: addr } = await aClient
        .rpc("create_project_address", {
          p_project_id: (project as { id: string }).id,
          p_address_line_1: "2 Test St",
          p_city: "Testville",
          p_state: "TS",
          p_postal_code: "00000",
        })
        .single();
      const { error } = await aClient.rpc("restore_project_address", { p_address_id: (addr as { id: string }).id });
      expect(error).toBeNull();
    });

    it("Viewer cannot restore", async () => {
      const { addressId } = await archivedAddress(aClient, tenantAId, clientAId);
      const { error } = await viewerClient.rpc("restore_project_address", { p_address_id: addressId });
      expect(error).not.toBeNull();
    });

    it("Tenant A cannot restore Tenant B's address", async () => {
      const { addressId: addressIdB } = await archivedAddress(bClient, tenantBId, clientBId);
      const { error } = await aClient.rpc("restore_project_address", { p_address_id: addressIdB });
      expect(error).not.toBeNull();
    });

    it("a suspended user's existing session cannot restore", async () => {
      const { addressId } = await archivedAddress(aClient, tenantAId, clientAId);
      await aClient.rpc("update_membership", { p_membership_id: adminMembershipId, p_new_status: "suspended" });
      const { error } = await adminClientA.rpc("restore_project_address", { p_address_id: addressId });
      expect(error).not.toBeNull();
      await aClient.rpc("update_membership", { p_membership_id: adminMembershipId, p_new_status: "active" });
    });
  });

  // ===========================================================================
  // Concurrency — restore races
  // ===========================================================================
  describe("Restore concurrency", () => {
    it("two concurrent restores of the same archived client never error and converge to one consistent, restored state", async () => {
      const { data: c } = await aClient
        .rpc("create_client", { p_tenant_id: tenantAId, p_client_type: "individual", p_display_name: "Concurrent Restore Client" })
        .single();
      const id = (c as { id: string }).id;
      await aClient.rpc("archive_client", { p_client_id: id });

      const [r1, r2] = await Promise.all([
        aClient.rpc("restore_client", { p_client_id: id }),
        aClient.rpc("restore_client", { p_client_id: id }),
      ]);
      expect(r1.error).toBeNull();
      expect(r2.error).toBeNull();

      const { data: row } = await admin.from("clients").select("archived_at").eq("id", id).single();
      expect((row as { archived_at: string | null }).archived_at).toBeNull();
    });

    it("archive and restore racing on the same opportunity never leaves an inconsistent status — exactly one of the two states holds", async () => {
      const { data: opp } = await aClient
        .rpc("create_opportunity", { p_tenant_id: tenantAId, p_client_id: clientAId, p_title: "Archive-Restore Race Opp" })
        .single();
      const id = (opp as { id: string }).id;
      await aClient.rpc("change_opportunity_status", { p_opportunity_id: id, p_new_status: "contacted" });
      await aClient.rpc("change_opportunity_status", {
        p_opportunity_id: id,
        p_new_status: "lost",
        p_lost_reason: "Race test",
      });
      await aClient.rpc("archive_opportunity", { p_opportunity_id: id });

      // Racing a restore (archived -> lost) against a second archive attempt
      // (already archived -> idempotent no-op) must never corrupt the row:
      // the final state must be exactly one valid, self-consistent status,
      // never a half-applied mix of archived + non-null pre_archive_status
      // pointing nowhere, and never an error from either call.
      const [restoreResult, archiveResult] = await Promise.all([
        aClient.rpc("restore_opportunity", { p_opportunity_id: id }),
        aClient.rpc("archive_opportunity", { p_opportunity_id: id }),
      ]);
      expect(restoreResult.error).toBeNull();
      expect(archiveResult.error).toBeNull();

      const { data: row } = await admin
        .from("opportunities")
        .select("status, pre_archive_status, archived_at, archived_by")
        .eq("id", id)
        .single();
      const final = row as { status: string; pre_archive_status: string | null; archived_at: string | null; archived_by: string | null };
      if (final.status === "archived") {
        expect(final.pre_archive_status).toBe("lost");
        expect(final.archived_at).not.toBeNull();
        expect(final.archived_by).not.toBeNull();
      } else {
        expect(final.status).toBe("lost");
        expect(final.pre_archive_status).toBeNull();
        expect(final.archived_at).toBeNull();
        expect(final.archived_by).toBeNull();
      }
    });
  });
});
