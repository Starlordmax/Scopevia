/**
 * Phase 3D (Email Notifications for Client Portal Events) — everything
 * testable at the SQL/RLS level: recipient selection
 * (get_proposal_notification_recipients), the dedupe constraint that IS
 * the entire duplicate-email guard, RLS on proposal_notification_deliveries,
 * and the two RPC return-shape extensions
 * (portal_get_session_context/submit_proposal_client_response) the
 * TypeScript notification module (src/lib/notifications/proposals.ts)
 * depends on.
 *
 * The notification module itself has `import "server-only"` and cannot be
 * imported into a plain Vitest test (same constraint as every other
 * server-only module in this codebase) — its actual email-sending
 * behavior (does a real portal view/accept/decline trigger a captured
 * notification) is verified end-to-end instead, in
 * tests/e2e/proposal-notifications.spec.ts. See
 * docs/62-proposal-email-notifications.md, "Why some checks are RLS-level
 * and some are E2E-level."
 *
 * Same infrastructure/conventions as tests/rls/phase3b1-proposal-revision.test.ts
 * — self-contained, own helpers, requires SUPABASE_TEST_URL/ANON_KEY/
 * SERVICE_ROLE_KEY in .env.local; skipped entirely if absent.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config as loadEnv } from "dotenv";
import { randomBytes, createHash } from "node:crypto";

loadEnv({ path: ".env.local" });

const TEST_URL = process.env.SUPABASE_TEST_URL;
const TEST_SERVICE_ROLE_KEY = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY;
const TEST_ANON_KEY = process.env.SUPABASE_TEST_ANON_KEY;

const canRun = Boolean(TEST_URL && TEST_SERVICE_ROLE_KEY && TEST_ANON_KEY);
const PASSWORD = "correct-horse-battery-staple";
const RUN_ID = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;

function email(label: string): string {
  return `test-p3d-${label}-${RUN_ID}@example.com`;
}

async function signIn(addr: string): Promise<SupabaseClient> {
  const client = createClient(TEST_URL!, TEST_ANON_KEY!);
  const { error } = await client.auth.signInWithPassword({ email: addr, password: PASSWORD });
  if (error) throw error;
  return client;
}

function genToken(): string {
  return randomBytes(32).toString("base64url");
}
function genCode(): string {
  return randomBytes(4).toString("hex").slice(0, 6);
}
function sha256(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

type TestUser = { id: string; email: string };
type Recipient = { user_id: string; email: string };

describe.skipIf(!canRun)("Phase 3D Email Notifications (requires real Postgres)", () => {
  let admin: SupabaseClient;
  let ownerA: TestUser, adminA: TestUser, estimatorA: TestUser, salesA: TestUser, viewerA: TestUser, fieldWorkerA: TestUser, suspendedA: TestUser, removedA: TestUser, invitedOnlyA: TestUser;
  let ownerB: TestUser;
  let aClient: SupabaseClient, bClient: SupabaseClient;
  let tenantAId: string, tenantBId: string;
  let clientAId: string;
  const CLIENT_EMAIL = email("client").toLowerCase();

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

    [ownerA, adminA, estimatorA, salesA, viewerA, fieldWorkerA, suspendedA, removedA, invitedOnlyA, ownerB] = await Promise.all([
      createUser("a-owner"),
      createUser("a-admin"),
      createUser("a-estimator"),
      createUser("a-sales"),
      createUser("a-viewer"),
      createUser("a-fieldworker"),
      createUser("a-suspended"),
      createUser("a-removed"),
      createUser("a-invited-only"),
      createUser("b-owner"),
    ]);

    [aClient, bClient] = await Promise.all([signIn(ownerA.email), signIn(ownerB.email)]);

    const { data: tenantA } = await aClient.rpc("create_tenant_with_owner", { p_name: "P3D Tenant A", p_slug: `p3d-a-${RUN_ID}` }).single();
    tenantAId = (tenantA as { id: string }).id;
    const { data: tenantB } = await bClient.rpc("create_tenant_with_owner", { p_name: "P3D Tenant B", p_slug: `p3d-b-${RUN_ID}` }).single();
    tenantBId = (tenantB as { id: string }).id;

    async function inviteAndAccept(user: TestUser, roleKey: string) {
      const memberClient = await signIn(user.email);
      const { data: invite, error } = await aClient.rpc("invite_member_by_email", { p_tenant_id: tenantAId, p_email: user.email, p_role_key: roleKey }).single();
      if (error) throw error;
      await memberClient.rpc("accept_invitation", { p_membership_id: (invite as { id: string }).id });
      return (invite as { id: string }).id;
    }

    await Promise.all([
      inviteAndAccept(adminA, "admin"),
      inviteAndAccept(estimatorA, "estimator"),
      inviteAndAccept(salesA, "sales"),
      inviteAndAccept(viewerA, "viewer"),
      inviteAndAccept(fieldWorkerA, "field_worker"),
    ]);

    const suspendedMembershipId = await inviteAndAccept(suspendedA, "estimator");
    await aClient.rpc("update_membership", { p_membership_id: suspendedMembershipId, p_new_status: "suspended" });

    const removedMembershipId = await inviteAndAccept(removedA, "sales");
    await aClient.rpc("update_membership", { p_membership_id: removedMembershipId, p_new_status: "removed" });

    // Invited but never accepted -- status stays 'invited', never 'active'.
    await aClient.rpc("invite_member_by_email", { p_tenant_id: tenantAId, p_email: invitedOnlyA.email, p_role_key: "estimator" });

    const { data: clientA } = await aClient
      .rpc("create_client", { p_tenant_id: tenantAId, p_client_type: "individual", p_display_name: "P3D Client A", p_email: CLIENT_EMAIL })
      .single();
    clientAId = (clientA as { id: string }).id;
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

  async function createReadyProposal(title: string, owner: SupabaseClient = aClient, tenantId = tenantAId, clientId = clientAId) {
    const { data: proposal } = await owner
      .rpc("create_proposal_direct", { p_tenant_id: tenantId, p_client_id: clientId, p_title: title, p_service_type: "custom", p_custom_service_name: "Custom service" })
      .single();
    const p = proposal as { id: string; current_version_id: string };
    await owner.rpc("mark_proposal_ready", { p_proposal_id: p.id });
    return { proposalId: p.id, versionId: p.current_version_id };
  }

  async function createLinkAndSession(proposalId: string) {
    const rawToken = genToken();
    const tokenHash = sha256(rawToken);
    const { data: link } = await aClient
      .rpc("create_proposal_portal_link", {
        p_tenant_id: tenantAId,
        p_proposal_id: proposalId,
        p_token_hash: tokenHash,
        p_expires_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      })
      .single();
    const linkId = (link as { id: string }).id;

    const code = genCode();
    const codeHash = sha256(code);
    await admin.rpc("portal_request_otp", {
      p_token_hash: tokenHash,
      p_email: CLIENT_EMAIL,
      p_code_hash: codeHash,
      p_expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      p_ip_hash: sha256("127.0.0.1"),
      p_user_agent_hash: sha256("vitest"),
    });

    const sessionToken = genToken();
    const sessionTokenHash = sha256(sessionToken);
    const { data: verify } = await admin
      .rpc("portal_verify_otp", {
        p_token_hash: tokenHash,
        p_email: CLIENT_EMAIL,
        p_code_hash: codeHash,
        p_session_token_hash: sessionTokenHash,
        p_session_expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      })
      .single();
    expect((verify as { outcome: string }).outcome).toBe("verified");

    return { linkId, sessionTokenHash };
  }

  // ===========================================================================
  // Recipient selection (get_proposal_notification_recipients)
  // ===========================================================================
  describe("get_proposal_notification_recipients", () => {
    it("includes active Owner/Admin/Estimator/Sales, excludes Viewer/Field Worker/suspended/removed/invited-only", async () => {
      const { data, error } = await admin.rpc("get_proposal_notification_recipients", { p_tenant_id: tenantAId });
      expect(error).toBeNull();
      const emails = (data as Recipient[]).map((r) => r.email.toLowerCase());

      expect(emails).toContain(ownerA.email.toLowerCase());
      expect(emails).toContain(adminA.email.toLowerCase());
      expect(emails).toContain(estimatorA.email.toLowerCase());
      expect(emails).toContain(salesA.email.toLowerCase());

      expect(emails).not.toContain(viewerA.email.toLowerCase());
      expect(emails).not.toContain(fieldWorkerA.email.toLowerCase());
      expect(emails).not.toContain(suspendedA.email.toLowerCase());
      expect(emails).not.toContain(removedA.email.toLowerCase());
      expect(emails).not.toContain(invitedOnlyA.email.toLowerCase());
    });

    it("never includes a different tenant's members (cross-tenant isolation)", async () => {
      const { data } = await admin.rpc("get_proposal_notification_recipients", { p_tenant_id: tenantAId });
      const emails = (data as Recipient[]).map((r) => r.email.toLowerCase());
      expect(emails).not.toContain(ownerB.email.toLowerCase());
    });

    it("Tenant B's recipient list is exactly its own owner, not Tenant A's team", async () => {
      const { data } = await admin.rpc("get_proposal_notification_recipients", { p_tenant_id: tenantBId });
      const emails = (data as Recipient[]).map((r) => r.email.toLowerCase());
      expect(emails).toEqual([ownerB.email.toLowerCase()]);
    });

    it("is not callable by an ordinary authenticated client (service_role only, same discipline as every portal_*() function)", async () => {
      const { error } = await aClient.rpc("get_proposal_notification_recipients", { p_tenant_id: tenantAId });
      expect(error).not.toBeNull();
    });
  });

  // ===========================================================================
  // Dedupe: the unique(dedupe_key) constraint IS the guard
  // ===========================================================================
  describe("proposal_notification_deliveries dedupe", () => {
    it("a second insert with the same dedupe_key fails (duplicate email prevented)", async () => {
      const { proposalId, versionId } = await createReadyProposal("Dedupe test");
      const dedupeKey = `proposal_viewed:${versionId}:${ownerA.email.toLowerCase()}`;

      const first = await admin.from("proposal_notification_deliveries").insert({
        tenant_id: tenantAId,
        proposal_id: proposalId,
        proposal_version_id: versionId,
        event_type: "proposal_viewed",
        recipient_email: ownerA.email,
        status: "sent",
        provider: "dev",
        dedupe_key: dedupeKey,
      });
      expect(first.error).toBeNull();

      const second = await admin.from("proposal_notification_deliveries").insert({
        tenant_id: tenantAId,
        proposal_id: proposalId,
        proposal_version_id: versionId,
        event_type: "proposal_viewed",
        recipient_email: ownerA.email,
        status: "sent",
        provider: "dev",
        dedupe_key: dedupeKey,
      });
      expect(second.error).not.toBeNull();
      expect(second.error?.code).toBe("23505");

      const { data: rows } = await admin.from("proposal_notification_deliveries").select("id").eq("dedupe_key", dedupeKey);
      expect((rows ?? []).length).toBe(1);
    });

    it("different recipients for the same event/version get independent rows (not deduped against each other)", async () => {
      const { proposalId, versionId } = await createReadyProposal("Dedupe per-recipient test");

      for (const recipientEmail of [adminA.email, salesA.email]) {
        const { error } = await admin.from("proposal_notification_deliveries").insert({
          tenant_id: tenantAId,
          proposal_id: proposalId,
          proposal_version_id: versionId,
          event_type: "proposal_accepted",
          recipient_email: recipientEmail,
          status: "sent",
          provider: "dev",
          dedupe_key: `proposal_accepted:${versionId}:${recipientEmail.toLowerCase()}`,
        });
        expect(error).toBeNull();
      }
    });
  });

  // ===========================================================================
  // RLS: proposal_notification_deliveries
  // ===========================================================================
  describe("RLS: proposal_notification_deliveries", () => {
    it("Owner (has audit.view) can read their own tenant's delivery rows", async () => {
      const { proposalId, versionId } = await createReadyProposal("RLS read owner");
      await admin.from("proposal_notification_deliveries").insert({
        tenant_id: tenantAId,
        proposal_id: proposalId,
        proposal_version_id: versionId,
        event_type: "proposal_viewed",
        recipient_email: ownerA.email,
        status: "sent",
        provider: "dev",
        dedupe_key: `proposal_viewed:${versionId}:rls-owner-${RUN_ID}@example.com`,
      });

      const { data, error } = await aClient.from("proposal_notification_deliveries").select("id").eq("proposal_id", proposalId);
      expect(error).toBeNull();
      expect((data ?? []).length).toBe(1);
    });

    it("Tenant B cannot see Tenant A's delivery rows (RLS returns zero rows, not an error)", async () => {
      const { proposalId, versionId } = await createReadyProposal("RLS cross-tenant");
      await admin.from("proposal_notification_deliveries").insert({
        tenant_id: tenantAId,
        proposal_id: proposalId,
        proposal_version_id: versionId,
        event_type: "proposal_viewed",
        recipient_email: ownerA.email,
        status: "sent",
        provider: "dev",
        dedupe_key: `proposal_viewed:${versionId}:rls-crosstenant-${RUN_ID}@example.com`,
      });

      const { data, error } = await bClient.from("proposal_notification_deliveries").select("id").eq("proposal_id", proposalId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("anon (no session at all) cannot read proposal_notification_deliveries", async () => {
      const anonClient = createClient(TEST_URL!, TEST_ANON_KEY!);
      const { data, error } = await anonClient.from("proposal_notification_deliveries").select("id").limit(1);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("a client portal visitor (service-role-authenticated session context, but no tenant membership) has no way to read this table either -- only the admin client (service_role) or a tenant member with audit.view can", async () => {
      // There is no "client portal user" Supabase session at all (see
      // docs/53-client-portal-security.md) -- a portal visitor's only
      // possible read path would be the anon key, already covered above.
      // This test instead confirms the table has NO policy granting
      // access to anyone lacking audit.view, by checking a tenant member
      // WITHOUT it (Viewer only has proposals.view, not audit.view).
      const viewerClient = await signIn(viewerA.email);
      const { proposalId, versionId } = await createReadyProposal("RLS viewer excluded");
      await admin.from("proposal_notification_deliveries").insert({
        tenant_id: tenantAId,
        proposal_id: proposalId,
        proposal_version_id: versionId,
        event_type: "proposal_viewed",
        recipient_email: ownerA.email,
        status: "sent",
        provider: "dev",
        dedupe_key: `proposal_viewed:${versionId}:rls-viewer-excluded-${RUN_ID}@example.com`,
      });

      const { data, error } = await viewerClient.from("proposal_notification_deliveries").select("id").eq("proposal_id", proposalId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("an ordinary authenticated client cannot INSERT a delivery row directly (no insert policy -- admin client only)", async () => {
      const { proposalId, versionId } = await createReadyProposal("RLS insert blocked");
      const { error } = await aClient.from("proposal_notification_deliveries").insert({
        tenant_id: tenantAId,
        proposal_id: proposalId,
        proposal_version_id: versionId,
        event_type: "proposal_viewed",
        recipient_email: ownerA.email,
        status: "sent",
        provider: "dev",
        dedupe_key: `proposal_viewed:${versionId}:rls-insert-blocked-${RUN_ID}@example.com`,
      });
      expect(error).not.toBeNull();
    });
  });

  // ===========================================================================
  // portal_get_session_context() — is_first_view / client_email (Phase 3D additions)
  // ===========================================================================
  describe("portal_get_session_context is_first_view/client_email", () => {
    it("is_first_view is true on the first call and false on a subsequent call for the same session", async () => {
      const { proposalId } = await createReadyProposal("First view flag");
      const { sessionTokenHash } = await createLinkAndSession(proposalId);

      const first = await admin
        .rpc("portal_get_session_context", { p_session_token_hash: sessionTokenHash, p_ip_hash: sha256("1"), p_user_agent_hash: sha256("vitest") })
        .single();
      expect((first.data as { outcome: string; is_first_view: boolean }).outcome).toBe("ok");
      expect((first.data as { is_first_view: boolean }).is_first_view).toBe(true);

      const second = await admin
        .rpc("portal_get_session_context", { p_session_token_hash: sessionTokenHash, p_ip_hash: sha256("1"), p_user_agent_hash: sha256("vitest") })
        .single();
      expect((second.data as { is_first_view: boolean }).is_first_view).toBe(false);
    });

    it("returns the session's client_email", async () => {
      const { proposalId } = await createReadyProposal("Client email in session context");
      const { sessionTokenHash } = await createLinkAndSession(proposalId);

      const { data } = await admin
        .rpc("portal_get_session_context", { p_session_token_hash: sessionTokenHash, p_ip_hash: sha256("1"), p_user_agent_hash: sha256("vitest") })
        .single();
      expect((data as { client_email: string }).client_email.toLowerCase()).toBe(CLIENT_EMAIL);
    });

    it("an invalid session returns null for the new fields too", async () => {
      const { data } = await admin
        .rpc("portal_get_session_context", { p_session_token_hash: sha256("nonexistent"), p_ip_hash: sha256("1"), p_user_agent_hash: sha256("vitest") })
        .single();
      expect((data as { outcome: string }).outcome).toBe("invalid_session");
      expect((data as { is_first_view: boolean | null }).is_first_view).toBeNull();
      expect((data as { client_email: string | null }).client_email).toBeNull();
    });
  });

  // ===========================================================================
  // submit_proposal_client_response() — new returned context (Phase 3D)
  // ===========================================================================
  describe("submit_proposal_client_response returned notification context", () => {
    it("a successful accept returns tenant_id/proposal_id/proposal_version_id/client_email/responded_at", async () => {
      const { proposalId, versionId } = await createReadyProposal("Accept returns context");
      const { sessionTokenHash } = await createLinkAndSession(proposalId);

      const { data } = await admin
        .rpc("submit_proposal_client_response", {
          p_session_token_hash: sessionTokenHash,
          p_response_type: "accepted",
          p_client_name: "Jane Doe",
          p_decline_reason: null,
          p_accepted_terms: true,
          p_ip_hash: sha256("1"),
          p_user_agent_hash: sha256("vitest"),
        })
        .single();

      const result = data as { outcome: string; tenant_id: string; proposal_id: string; proposal_version_id: string; client_email: string; responded_at: string };
      expect(result.outcome).toBe("ok");
      expect(result.tenant_id).toBe(tenantAId);
      expect(result.proposal_id).toBe(proposalId);
      expect(result.proposal_version_id).toBe(versionId);
      expect(result.client_email.toLowerCase()).toBe(CLIENT_EMAIL);
      expect(result.responded_at).not.toBeNull();
    });

    it("an already_responded outcome returns null context (no stale data reused for a notification)", async () => {
      const { proposalId } = await createReadyProposal("Duplicate accept returns no context");
      const { sessionTokenHash } = await createLinkAndSession(proposalId);

      await admin.rpc("submit_proposal_client_response", {
        p_session_token_hash: sessionTokenHash,
        p_response_type: "accepted",
        p_client_name: "Jane Doe",
        p_decline_reason: null,
        p_accepted_terms: true,
        p_ip_hash: sha256("1"),
        p_user_agent_hash: sha256("vitest"),
      });

      const { data } = await admin
        .rpc("submit_proposal_client_response", {
          p_session_token_hash: sessionTokenHash,
          p_response_type: "accepted",
          p_client_name: "Jane Doe",
          p_decline_reason: null,
          p_accepted_terms: true,
          p_ip_hash: sha256("1"),
          p_user_agent_hash: sha256("vitest"),
        })
        .single();
      const result = data as { outcome: string; tenant_id: string | null };
      expect(result.outcome).toBe("already_responded");
      expect(result.tenant_id).toBeNull();
    });
  });
});
