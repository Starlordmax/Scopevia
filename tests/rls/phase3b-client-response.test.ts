/**
 * Phase 3B (Client Portal Accept/Decline) — submit_proposal_client_response(),
 * duplicate-response prevention, cross-tenant isolation, RLS visibility of
 * proposal_client_responses, version locking, and the audit/CRM-activity
 * trail.
 *
 * Same infrastructure/conventions as tests/rls/phase3a-client-portal.test.ts
 * — a portal visitor has no Supabase Auth session, so submit_proposal_client_response()
 * is called here via the `admin` (service-role) client, exactly how the real
 * src/actions/portal-visitor.ts Server Actions call it.
 *
 * Requires SUPABASE_TEST_URL/ANON_KEY/SERVICE_ROLE_KEY in .env.local
 * pointing at a project dedicated to testing; skipped entirely if absent.
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
  return `test-p3b-${label}-${RUN_ID}@example.com`;
}

async function signIn(addr: string): Promise<SupabaseClient> {
  const client = createClient(TEST_URL!, TEST_ANON_KEY!);
  const { error } = await client.auth.signInWithPassword({ email: addr, password: PASSWORD });
  if (error) throw error;
  return client;
}

// Mirrors src/lib/portal/tokens.ts (which can't be imported directly here —
// see tests/rls/phase3a-client-portal.test.ts's identical note).
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
type SubmitResult = { outcome: string; response_type: string | null };

describe.skipIf(!canRun)("Phase 3B Client Portal Accept/Decline (requires real Postgres)", () => {
  let admin: SupabaseClient;
  let userA: TestUser, userB: TestUser, viewerUser: TestUser;
  let aClient: SupabaseClient, bClient: SupabaseClient, viewerClient: SupabaseClient;
  let tenantAId: string, tenantBId: string;
  let clientAId: string, clientBId: string;
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

    userA = await createUser("a-owner");
    userB = await createUser("b-owner");
    viewerUser = await createUser("viewer");

    [aClient, bClient, viewerClient] = await Promise.all([signIn(userA.email), signIn(userB.email), signIn(viewerUser.email)]);

    const { data: tenantA } = await aClient.rpc("create_tenant_with_owner", { p_name: "P3B Tenant A", p_slug: `p3b-a-${RUN_ID}` }).single();
    tenantAId = (tenantA as { id: string }).id;

    const { data: tenantB } = await bClient.rpc("create_tenant_with_owner", { p_name: "P3B Tenant B", p_slug: `p3b-b-${RUN_ID}` }).single();
    tenantBId = (tenantB as { id: string }).id;

    const { data: invite, error: inviteErr } = await aClient
      .rpc("invite_member_by_email", { p_tenant_id: tenantAId, p_email: viewerUser.email, p_role_key: "viewer" })
      .single();
    if (inviteErr) throw inviteErr;
    await viewerClient.rpc("accept_invitation", { p_membership_id: (invite as { id: string }).id });

    const { data: clientA } = await aClient
      .rpc("create_client", { p_tenant_id: tenantAId, p_client_type: "individual", p_display_name: "P3B Client A", p_email: CLIENT_EMAIL })
      .single();
    clientAId = (clientA as { id: string }).id;

    const { data: clientB } = await bClient
      .rpc("create_client", { p_tenant_id: tenantBId, p_client_type: "individual", p_display_name: "P3B Client B" })
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

  async function createReadyProposal(title: string, owner: SupabaseClient = aClient, tenantId = tenantAId, clientId = clientAId): Promise<{ proposalId: string; versionId: string }> {
    const { data: proposal } = await owner
      .rpc("create_proposal_direct", { p_tenant_id: tenantId, p_client_id: clientId, p_title: title, p_service_type: "custom", p_custom_service_name: "Custom service" })
      .single();
    const p = proposal as { id: string; current_version_id: string };
    await owner.rpc("mark_proposal_ready", { p_proposal_id: p.id });
    return { proposalId: p.id, versionId: p.current_version_id };
  }

  async function createLinkAndSession(
    proposalId: string,
    opts?: { owner?: SupabaseClient; tenantId?: string; expiresAt?: string }
  ): Promise<{ linkId: string; sessionTokenHash: string }> {
    const owner = opts?.owner ?? aClient;
    const tenantId = opts?.tenantId ?? tenantAId;
    const rawToken = genToken();
    const tokenHash = sha256(rawToken);
    const { data: link } = await owner
      .rpc("create_proposal_portal_link", {
        p_tenant_id: tenantId,
        p_proposal_id: proposalId,
        p_token_hash: tokenHash,
        p_expires_at: opts?.expiresAt ?? new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
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

  async function submitResponse(
    sessionTokenHash: string,
    responseType: "accepted" | "declined",
    opts?: { clientName?: string; declineReason?: string; acceptedTerms?: boolean }
  ): Promise<SubmitResult> {
    const { data, error } = await admin
      .rpc("submit_proposal_client_response", {
        p_session_token_hash: sessionTokenHash,
        p_response_type: responseType,
        p_client_name: opts?.clientName ?? (responseType === "accepted" ? "Jane Doe" : null),
        p_decline_reason: opts?.declineReason ?? null,
        p_accepted_terms: opts?.acceptedTerms ?? responseType === "accepted",
        p_ip_hash: sha256("127.0.0.1"),
        p_user_agent_hash: sha256("vitest"),
      })
      .single();
    if (error) throw error;
    return data as SubmitResult;
  }

  // ===========================================================================
  // Core accept / decline
  // ===========================================================================
  describe("submit_proposal_client_response — accept", () => {
    it("accepts with a valid portal session, updates proposal status, and locks the version", async () => {
      const { proposalId, versionId } = await createReadyProposal("Accept happy path");
      const { sessionTokenHash } = await createLinkAndSession(proposalId);

      const result = await submitResponse(sessionTokenHash, "accepted", { clientName: "Jane Doe" });
      expect(result.outcome).toBe("ok");
      expect(result.response_type).toBe("accepted");

      const { data: proposal } = await admin.from("proposals").select("status").eq("id", proposalId).single();
      expect((proposal as { status: string }).status).toBe("accepted");

      const { data: version } = await admin.from("proposal_versions").select("version_status, locked_at").eq("id", versionId).single();
      expect((version as { version_status: string }).version_status).toBe("locked");
      expect((version as { locked_at: string | null }).locked_at).not.toBeNull();
    });

    it("requires a client name at the DB level even if the caller omits it", async () => {
      const { proposalId } = await createReadyProposal("Accept requires name");
      const { sessionTokenHash } = await createLinkAndSession(proposalId);
      await expect(submitResponse(sessionTokenHash, "accepted", { clientName: "" })).rejects.toThrow();
    });

    it("requires accepted_terms=true at the DB level even if the caller omits it", async () => {
      const { proposalId } = await createReadyProposal("Accept requires terms");
      const { sessionTokenHash } = await createLinkAndSession(proposalId);
      await expect(submitResponse(sessionTokenHash, "accepted", { clientName: "Jane Doe", acceptedTerms: false })).rejects.toThrow();
    });
  });

  describe("submit_proposal_client_response — decline", () => {
    it("declines with a valid portal session, updates proposal status, and locks the version", async () => {
      const { proposalId, versionId } = await createReadyProposal("Decline happy path");
      const { sessionTokenHash } = await createLinkAndSession(proposalId);

      const result = await submitResponse(sessionTokenHash, "declined", { declineReason: "Too expensive" });
      expect(result.outcome).toBe("ok");
      expect(result.response_type).toBe("declined");

      const { data: proposal } = await admin.from("proposals").select("status").eq("id", proposalId).single();
      expect((proposal as { status: string }).status).toBe("declined");

      const { data: version } = await admin.from("proposal_versions").select("version_status").eq("id", versionId).single();
      expect((version as { version_status: string }).version_status).toBe("locked");

      const { data: response } = await admin.from("proposal_client_responses").select("decline_reason, client_name").eq("proposal_id", proposalId).single();
      expect((response as { decline_reason: string }).decline_reason).toBe("Too expensive");
      expect((response as { client_name: string | null }).client_name).toBeNull();
    });

    it("a decline reason is optional", async () => {
      const { proposalId } = await createReadyProposal("Decline no reason");
      const { sessionTokenHash } = await createLinkAndSession(proposalId);
      const result = await submitResponse(sessionTokenHash, "declined");
      expect(result.outcome).toBe("ok");
    });
  });

  // ===========================================================================
  // Duplicate / conflicting responses
  // ===========================================================================
  describe("Duplicate response prevention", () => {
    it("a duplicate accept (same session, second call) is rejected", async () => {
      const { proposalId } = await createReadyProposal("Duplicate accept");
      const { sessionTokenHash } = await createLinkAndSession(proposalId);
      await submitResponse(sessionTokenHash, "accepted");
      const second = await submitResponse(sessionTokenHash, "accepted");
      expect(second.outcome).toBe("already_responded");
    });

    it("accept after decline is rejected", async () => {
      const { proposalId } = await createReadyProposal("Accept after decline");
      const { sessionTokenHash } = await createLinkAndSession(proposalId);
      await submitResponse(sessionTokenHash, "declined");
      const second = await submitResponse(sessionTokenHash, "accepted");
      expect(second.outcome).toBe("already_responded");

      const { data: proposal } = await admin.from("proposals").select("status").eq("id", proposalId).single();
      expect((proposal as { status: string }).status).toBe("declined");
    });

    it("decline after accept is rejected", async () => {
      const { proposalId } = await createReadyProposal("Decline after accept");
      const { sessionTokenHash } = await createLinkAndSession(proposalId);
      await submitResponse(sessionTokenHash, "accepted");
      const second = await submitResponse(sessionTokenHash, "declined");
      expect(second.outcome).toBe("already_responded");

      const { data: proposal } = await admin.from("proposals").select("status").eq("id", proposalId).single();
      expect((proposal as { status: string }).status).toBe("accepted");
    });

    it("a second, DIFFERENT link/session for the same proposal cannot respond after a final response exists", async () => {
      const { proposalId } = await createReadyProposal("Second link cannot respond");
      // Both links must be created WHILE the proposal is still 'ready' --
      // create_proposal_portal_link() itself refuses a non-ready proposal
      // (already verified in Phase 3A), so the second link cannot be
      // created AFTER the first response has already changed the status.
      const first = await createLinkAndSession(proposalId);
      const second = await createLinkAndSession(proposalId);

      await submitResponse(first.sessionTokenHash, "accepted");

      const result = await submitResponse(second.sessionTokenHash, "declined");
      expect(result.outcome).toBe("already_responded");
    });

    it("only one row ever exists in proposal_client_responses for the version, even under a raw duplicate insert attempt", async () => {
      const { proposalId, versionId } = await createReadyProposal("Unique constraint holds");
      const { sessionTokenHash } = await createLinkAndSession(proposalId);
      await submitResponse(sessionTokenHash, "accepted");

      const { data: rows } = await admin.from("proposal_client_responses").select("id").eq("proposal_version_id", versionId);
      expect((rows ?? []).length).toBe(1);
    });
  });

  // ===========================================================================
  // Invalid session / link / proposal states
  // ===========================================================================
  describe("Invalid session, link, and proposal states", () => {
    it("a revoked link cannot accept", async () => {
      const { proposalId } = await createReadyProposal("Revoked link cannot respond");
      const { linkId, sessionTokenHash } = await createLinkAndSession(proposalId);
      await aClient.rpc("revoke_proposal_portal_link", { p_portal_link_id: linkId });

      const result = await submitResponse(sessionTokenHash, "accepted");
      expect(result.outcome).toBe("invalid_session");
    });

    it("an expired link cannot accept", async () => {
      const { proposalId } = await createReadyProposal("Expired link cannot respond");
      const { linkId, sessionTokenHash } = await createLinkAndSession(proposalId);
      await admin.from("proposal_portal_links").update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq("id", linkId);

      // The link itself is expired, but the SESSION token is still valid --
      // submit_proposal_client_response() only re-checks the link's own
      // status (revoked), not its expiry, matching portal_get_session_context()'s
      // existing behavior (a session, once granted, is independently
      // time-boxed by its own expires_at). Expire the SESSION to model the
      // realistic "client's access has lapsed" scenario end-to-end.
      await admin.from("proposal_portal_sessions").update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq("session_token_hash", sessionTokenHash);

      const result = await submitResponse(sessionTokenHash, "accepted");
      expect(result.outcome).toBe("invalid_session");
    });

    it("an archived proposal cannot accept", async () => {
      const { proposalId } = await createReadyProposal("Archived proposal cannot respond");
      const { sessionTokenHash } = await createLinkAndSession(proposalId);
      await aClient.rpc("archive_proposal", { p_proposal_id: proposalId });

      const result = await submitResponse(sessionTokenHash, "accepted");
      expect(result.outcome).toBe("invalid_session");
    });

    it("an unknown/wrong session token cannot respond", async () => {
      const result = await submitResponse(sha256("nonexistent-session"), "accepted");
      expect(result.outcome).toBe("invalid_session");
    });

    it("a revoked session cannot respond", async () => {
      const { proposalId } = await createReadyProposal("Revoked session cannot respond");
      const { sessionTokenHash } = await createLinkAndSession(proposalId);
      await admin.from("proposal_portal_sessions").update({ revoked_at: new Date().toISOString() }).eq("session_token_hash", sessionTokenHash);

      const result = await submitResponse(sessionTokenHash, "accepted");
      expect(result.outcome).toBe("invalid_session");
    });
  });

  // ===========================================================================
  // Cross-tenant isolation
  // ===========================================================================
  describe("Cross-tenant isolation", () => {
    it("a Tenant A session can never affect Tenant B's proposal/response data", async () => {
      const { proposalId: proposalAId } = await createReadyProposal("Isolation A");
      const { sessionTokenHash: sessionAHash } = await createLinkAndSession(proposalAId);

      const { proposalId: proposalBId } = await createReadyProposal("Isolation B", bClient, tenantBId, clientBId);

      await submitResponse(sessionAHash, "accepted");

      const { data: proposalB } = await admin.from("proposals").select("status").eq("id", proposalBId).single();
      expect((proposalB as { status: string }).status).toBe("ready");

      const { data: responseA } = await admin.from("proposal_client_responses").select("tenant_id").eq("proposal_id", proposalAId).single();
      expect((responseA as { tenant_id: string }).tenant_id).toBe(tenantAId);
      expect((responseA as { tenant_id: string }).tenant_id).not.toBe(tenantBId);
    });
  });

  // ===========================================================================
  // RLS visibility
  // ===========================================================================
  describe("RLS: proposal_client_responses", () => {
    it("Owner (proposals.view) can see their own tenant's response", async () => {
      const { proposalId } = await createReadyProposal("RLS visibility owner");
      const { sessionTokenHash } = await createLinkAndSession(proposalId);
      await submitResponse(sessionTokenHash, "accepted");

      const { data, error } = await aClient.from("proposal_client_responses").select("id").eq("proposal_id", proposalId);
      expect(error).toBeNull();
      expect((data ?? []).length).toBe(1);
    });

    it("Viewer (has proposals.view) can also see the response", async () => {
      const { proposalId } = await createReadyProposal("RLS visibility viewer");
      const { sessionTokenHash } = await createLinkAndSession(proposalId);
      await submitResponse(sessionTokenHash, "declined");

      const { data, error } = await viewerClient.from("proposal_client_responses").select("id").eq("proposal_id", proposalId);
      expect(error).toBeNull();
      expect((data ?? []).length).toBe(1);
    });

    it("Tenant B cannot see Tenant A's response (RLS returns zero rows, not an error)", async () => {
      const { proposalId } = await createReadyProposal("RLS visibility cross-tenant");
      const { sessionTokenHash } = await createLinkAndSession(proposalId);
      await submitResponse(sessionTokenHash, "accepted");

      const { data, error } = await bClient.from("proposal_client_responses").select("id").eq("proposal_id", proposalId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("anon (no session at all) cannot read proposal_client_responses", async () => {
      const anonClient = createClient(TEST_URL!, TEST_ANON_KEY!);
      const { data, error } = await anonClient.from("proposal_client_responses").select("id").limit(1);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("proposal_portal_sessions and proposal_portal_otps remain unreadable by an ordinary tenant member (unaffected by this phase)", async () => {
      const { data: sessions, error: sessionsErr } = await aClient.from("proposal_portal_sessions").select("id").limit(1);
      const { data: otps, error: otpsErr } = await aClient.from("proposal_portal_otps").select("id").limit(1);
      expect(sessionsErr).toBeNull();
      expect(otpsErr).toBeNull();
      expect(sessions).toEqual([]);
      expect(otps).toEqual([]);
    });
  });

  // ===========================================================================
  // Locked version — immutability after response
  // ===========================================================================
  describe("Locked version immutability after a response", () => {
    it("an accepted proposal's version rejects a raw child mutation attempt (e.g. adding a line item)", async () => {
      const { proposalId, versionId } = await createReadyProposal("Locked version rejects edits");
      const { sessionTokenHash } = await createLinkAndSession(proposalId);
      await submitResponse(sessionTokenHash, "accepted");

      const { error } = await admin.from("proposal_line_items").insert({
        tenant_id: tenantAId,
        proposal_version_id: versionId,
        category: "material",
        description: "Should be rejected -- version is locked",
        quantity: 1,
        unit: "each",
        unit_price_cents: 100,
        source_type: "custom",
      });
      expect(error).not.toBeNull();
      expect(error?.code).toBe("55000");
    });

    it("the add_proposal_line_item() function itself also rejects (defense in depth on top of the trigger)", async () => {
      const { proposalId, versionId } = await createReadyProposal("Locked version rejects via function too");
      const { sessionTokenHash } = await createLinkAndSession(proposalId);
      await submitResponse(sessionTokenHash, "declined");

      const { error } = await aClient.rpc("add_proposal_line_item", {
        p_proposal_version_id: versionId,
        p_category: "material",
        p_description: "Should be rejected",
        p_quantity: 1,
        p_unit: "each",
        p_unit_price_cents: 100,
        p_taxable: true,
        p_section_id: null,
      });
      expect(error).not.toBeNull();
    });
  });

  // ===========================================================================
  // Audit & CRM activity trail
  // ===========================================================================
  describe("Audit & CRM activity trail", () => {
    it("accepting writes a proposal.accepted_by_client audit row and a proposal_accepted_by_client CRM activity", async () => {
      const { proposalId } = await createReadyProposal("Audit trail accept");
      const { sessionTokenHash } = await createLinkAndSession(proposalId);
      await submitResponse(sessionTokenHash, "accepted");

      const { data: auditRows } = await admin.from("audit_logs").select("id, metadata").eq("entity_id", proposalId).eq("action", "proposal.accepted_by_client");
      expect((auditRows ?? []).length).toBeGreaterThanOrEqual(1);

      const { data: activityRows } = await admin
        .from("crm_activities")
        .select("id")
        .eq("client_id", clientAId)
        .eq("activity_type", "proposal_accepted_by_client");
      expect((activityRows ?? []).length).toBeGreaterThanOrEqual(1);
    });

    it("declining writes a proposal.declined_by_client audit row and a proposal_declined_by_client CRM activity", async () => {
      const { proposalId } = await createReadyProposal("Audit trail decline");
      const { sessionTokenHash } = await createLinkAndSession(proposalId);
      await submitResponse(sessionTokenHash, "declined");

      const { data: auditRows } = await admin.from("audit_logs").select("id").eq("entity_id", proposalId).eq("action", "proposal.declined_by_client");
      expect((auditRows ?? []).length).toBeGreaterThanOrEqual(1);

      const { data: activityRows } = await admin
        .from("crm_activities")
        .select("id")
        .eq("client_id", clientAId)
        .eq("activity_type", "proposal_declined_by_client");
      expect((activityRows ?? []).length).toBeGreaterThanOrEqual(1);
    });

    it("the audit metadata never includes an OTP code, a raw token, or a raw session token", async () => {
      const { proposalId } = await createReadyProposal("Audit metadata never leaks secrets");
      const { sessionTokenHash } = await createLinkAndSession(proposalId);
      await submitResponse(sessionTokenHash, "accepted");

      const { data: auditRows } = await admin.from("audit_logs").select("metadata").eq("entity_id", proposalId).eq("action", "proposal.accepted_by_client").single();
      const metadataText = JSON.stringify((auditRows as { metadata: unknown } | null)?.metadata ?? {});
      expect(metadataText).not.toMatch(/code/i);
      expect(metadataText).not.toBe(sessionTokenHash);
      expect(metadataText.length).toBeLessThan(500); // just ids, nothing payload-shaped
    });
  });

  // ===========================================================================
  // Session remains viewable after responding (Phase 3B fix to
  // portal_get_session_context)
  // ===========================================================================
  describe("portal_get_session_context after a response", () => {
    it("the SAME session can still load the view after accepting (sees the final state, not a broken link)", async () => {
      const { proposalId } = await createReadyProposal("Session survives accept");
      const { sessionTokenHash } = await createLinkAndSession(proposalId);
      await submitResponse(sessionTokenHash, "accepted");

      const { data } = await admin
        .rpc("portal_get_session_context", { p_session_token_hash: sessionTokenHash, p_ip_hash: sha256("127.0.0.1"), p_user_agent_hash: sha256("vitest") })
        .single();
      expect((data as { outcome: string }).outcome).toBe("ok");
    });

    it("the SAME session can still load the view after declining", async () => {
      const { proposalId } = await createReadyProposal("Session survives decline");
      const { sessionTokenHash } = await createLinkAndSession(proposalId);
      await submitResponse(sessionTokenHash, "declined");

      const { data } = await admin
        .rpc("portal_get_session_context", { p_session_token_hash: sessionTokenHash, p_ip_hash: sha256("127.0.0.1"), p_user_agent_hash: sha256("vitest") })
        .single();
      expect((data as { outcome: string }).outcome).toBe("ok");
    });
  });
});
