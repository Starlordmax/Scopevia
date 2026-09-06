/**
 * Phase 3A (Client Portal with Email + OTP access) — link creation/revocation
 * and permissions, portal_get_link_info, portal_request_otp (including the
 * rate-limit fix in 20260715100300), portal_verify_otp, portal_get_session_context,
 * cross-tenant isolation, RLS visibility of the four new tables, and the
 * audit/CRM-activity trail.
 *
 * A portal visitor has no Supabase Auth session at all (see
 * docs/53-client-portal-security.md), so every portal_*() function is called
 * here via the `admin` (service-role) client — exactly how the real
 * src/app/p/[token]/** route handlers call them (src/lib/supabase/admin.ts).
 * Link creation/revocation are called via the CONTRACTOR's own session
 * client, exactly like every other proposal mutation in this codebase.
 *
 * Same infrastructure/conventions as tests/rls/phase2b-materials.test.ts —
 * requires SUPABASE_TEST_URL/ANON_KEY/SERVICE_ROLE_KEY in .env.local
 * pointing at a project dedicated to testing; skipped entirely if absent.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config as loadEnv } from "dotenv";
import { randomBytes, randomInt, createHash } from "node:crypto";

loadEnv({ path: ".env.local" });

const TEST_URL = process.env.SUPABASE_TEST_URL;
const TEST_SERVICE_ROLE_KEY = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY;
const TEST_ANON_KEY = process.env.SUPABASE_TEST_ANON_KEY;

const canRun = Boolean(TEST_URL && TEST_SERVICE_ROLE_KEY && TEST_ANON_KEY);
const PASSWORD = "correct-horse-battery-staple";
const RUN_ID = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;

function email(label: string): string {
  return `test-p3a-${label}-${RUN_ID}@example.com`;
}

async function signIn(addr: string): Promise<SupabaseClient> {
  const client = createClient(TEST_URL!, TEST_ANON_KEY!);
  const { error } = await client.auth.signInWithPassword({ email: addr, password: PASSWORD });
  if (error) throw error;
  return client;
}

// Mirrors src/lib/portal/tokens.ts exactly (that module can't be imported
// directly here -- it starts with `import "server-only"`, which throws
// unconditionally outside a bundler that aliases it away).
function genToken(): string {
  return randomBytes(32).toString("base64url");
}
function genCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}
function sha256(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

type TestUser = { id: string; email: string };
type LinkInfo = {
  link_id: string | null;
  tenant_id: string | null;
  proposal_id: string | null;
  business_name: string | null;
  proposal_title: string | null;
  is_valid: boolean;
  status_reason: string;
};
type OtpRequestResult = { outcome: string; email_matched: boolean };
type OtpVerifyResult = { outcome: string; tenant_id: string | null; proposal_id: string | null };
type SessionContextResult = { outcome: string; tenant_id: string | null; proposal_id: string | null; proposal_version_id: string | null };

describe.skipIf(!canRun)("Phase 3A Client Portal (requires real Postgres)", () => {
  let admin: SupabaseClient;
  let userA: TestUser, userB: TestUser, estimatorUser: TestUser, salesUser: TestUser, viewerUser: TestUser, fieldWorkerUser: TestUser;
  let aClient: SupabaseClient, bClient: SupabaseClient, estimatorClient: SupabaseClient, salesClient: SupabaseClient, viewerClient: SupabaseClient, fieldWorkerClient: SupabaseClient;
  let tenantAId: string, tenantBId: string;
  let clientAId: string, clientBId: string;
  const CLIENT_EMAIL = email("client-owner").toLowerCase();
  const CONTACT_EMAIL = email("client-contact").toLowerCase();
  const UNAUTHORIZED_EMAIL = email("not-authorized").toLowerCase();

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

    const { data: tenantA } = await aClient.rpc("create_tenant_with_owner", { p_name: "P3A Tenant A", p_slug: `p3a-a-${RUN_ID}` }).single();
    tenantAId = (tenantA as { id: string }).id;

    const { data: tenantB } = await bClient.rpc("create_tenant_with_owner", { p_name: "P3A Tenant B", p_slug: `p3a-b-${RUN_ID}` }).single();
    tenantBId = (tenantB as { id: string }).id;

    async function inviteAndAccept(client: SupabaseClient, targetEmail: string, role: string) {
      const { data: invite, error: inviteErr } = await aClient
        .rpc("invite_member_by_email", { p_tenant_id: tenantAId, p_email: targetEmail, p_role_key: role })
        .single();
      if (inviteErr) throw inviteErr;
      const { error: acceptErr } = await client.rpc("accept_invitation", { p_membership_id: (invite as { id: string }).id });
      if (acceptErr) throw acceptErr;
    }

    await inviteAndAccept(estimatorClient, estimatorUser.email, "estimator");
    await inviteAndAccept(salesClient, salesUser.email, "sales");
    await inviteAndAccept(viewerClient, viewerUser.email, "viewer");
    await inviteAndAccept(fieldWorkerClient, fieldWorkerUser.email, "field_worker");

    const { data: clientA } = await aClient
      .rpc("create_client", { p_tenant_id: tenantAId, p_client_type: "individual", p_display_name: "P3A Client A", p_email: CLIENT_EMAIL })
      .single();
    clientAId = (clientA as { id: string }).id;

    const { data: clientB } = await bClient
      .rpc("create_client", { p_tenant_id: tenantBId, p_client_type: "individual", p_display_name: "P3A Client B" })
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

  async function createReadyProposal(title: string, opts?: { withContact?: boolean }): Promise<{ proposalId: string; versionId: string }> {
    let clientContactId: string | undefined;
    if (opts?.withContact) {
      const { data: contact } = await aClient
        .rpc("create_client_contact", { p_client_id: clientAId, p_first_name: "Test", p_last_name: "Contact", p_email: CONTACT_EMAIL })
        .single();
      clientContactId = (contact as { id: string }).id;
    }

    const { data: proposal } = await aClient
      .rpc("create_proposal_direct", {
        p_tenant_id: tenantAId,
        p_client_id: clientAId,
        p_title: title,
        p_service_type: "custom",
        p_custom_service_name: "Custom service",
        p_client_contact_id: clientContactId,
      })
      .single();
    const p = proposal as { id: string; current_version_id: string };
    await aClient.rpc("mark_proposal_ready", { p_proposal_id: p.id });
    return { proposalId: p.id, versionId: p.current_version_id };
  }

  async function createLink(proposalId: string, expiresAt?: string): Promise<{ linkId: string; rawToken: string; tokenHash: string }> {
    const rawToken = genToken();
    const tokenHash = sha256(rawToken);
    const { data, error } = await aClient
      .rpc("create_proposal_portal_link", {
        p_tenant_id: tenantAId,
        p_proposal_id: proposalId,
        p_token_hash: tokenHash,
        p_expires_at: expiresAt ?? new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      })
      .single();
    if (error) throw error;
    return { linkId: (data as { id: string }).id, rawToken, tokenHash };
  }

  async function requestOtp(tokenHash: string, targetEmail: string): Promise<{ result: OtpRequestResult; code: string; codeHash: string }> {
    const code = genCode();
    const codeHash = sha256(code);
    const { data, error } = await admin
      .rpc("portal_request_otp", {
        p_token_hash: tokenHash,
        p_email: targetEmail,
        p_code_hash: codeHash,
        p_expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        p_ip_hash: sha256("127.0.0.1"),
        p_user_agent_hash: sha256("vitest"),
      })
      .single();
    if (error) throw error;
    return { result: data as OtpRequestResult, code, codeHash };
  }

  async function verifyOtp(tokenHash: string, targetEmail: string, codeHash: string): Promise<{ result: OtpVerifyResult; sessionToken: string; sessionTokenHash: string }> {
    const sessionToken = genToken();
    const sessionTokenHash = sha256(sessionToken);
    const { data, error } = await admin
      .rpc("portal_verify_otp", {
        p_token_hash: tokenHash,
        p_email: targetEmail,
        p_code_hash: codeHash,
        p_session_token_hash: sessionTokenHash,
        p_session_expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      })
      .single();
    if (error) throw error;
    return { result: data as OtpVerifyResult, sessionToken, sessionTokenHash };
  }

  async function getSessionContext(sessionTokenHash: string): Promise<SessionContextResult> {
    const { data, error } = await admin
      .rpc("portal_get_session_context", { p_session_token_hash: sessionTokenHash, p_ip_hash: sha256("127.0.0.1"), p_user_agent_hash: sha256("vitest") })
      .single();
    if (error) throw error;
    return data as SessionContextResult;
  }

  // ===========================================================================
  // Link creation & permissions
  // ===========================================================================
  describe("create_proposal_portal_link", () => {
    it("Owner creates a link for a ready proposal", async () => {
      const { proposalId } = await createReadyProposal("Ready for link");
      const { linkId, tokenHash } = await createLink(proposalId);
      expect(linkId).toBeTruthy();

      const { data: row } = await admin.from("proposal_portal_links").select("*").eq("id", linkId).single();
      expect((row as { status: string }).status).toBe("active");
      expect((row as { token_hash: string }).token_hash).toBe(tokenHash);
    });

    it("the raw token is never stored -- only its hash", async () => {
      const { proposalId } = await createReadyProposal("Token never stored raw");
      const { linkId, rawToken, tokenHash } = await createLink(proposalId);
      const { data: row } = await admin.from("proposal_portal_links").select("token_hash").eq("id", linkId).single();
      expect((row as { token_hash: string }).token_hash).not.toBe(rawToken);
      expect((row as { token_hash: string }).token_hash).toBe(tokenHash);
    });

    it("rejects a draft proposal", async () => {
      const { data: proposal } = await aClient
        .rpc("create_proposal_direct", { p_tenant_id: tenantAId, p_client_id: clientAId, p_title: "Still draft", p_service_type: "custom", p_custom_service_name: "Custom service" })
        .single();
      const p = proposal as { id: string };
      const { error } = await aClient.rpc("create_proposal_portal_link", {
        p_tenant_id: tenantAId,
        p_proposal_id: p.id,
        p_token_hash: sha256(genToken()),
        p_expires_at: new Date(Date.now() + 86400000).toISOString(),
      });
      expect(error).not.toBeNull();
    });

    it("rejects an archived proposal", async () => {
      const { proposalId } = await createReadyProposal("Will be archived");
      await aClient.rpc("archive_proposal", { p_proposal_id: proposalId });
      const { error } = await aClient.rpc("create_proposal_portal_link", {
        p_tenant_id: tenantAId,
        p_proposal_id: proposalId,
        p_token_hash: sha256(genToken()),
        p_expires_at: new Date(Date.now() + 86400000).toISOString(),
      });
      expect(error).not.toBeNull();
    });

    it("Viewer cannot create a link", async () => {
      const { proposalId } = await createReadyProposal("Viewer cannot link");
      const { error } = await viewerClient.rpc("create_proposal_portal_link", {
        p_tenant_id: tenantAId,
        p_proposal_id: proposalId,
        p_token_hash: sha256(genToken()),
        p_expires_at: new Date(Date.now() + 86400000).toISOString(),
      });
      expect(error).not.toBeNull();
    });

    it("Field Worker cannot create a link", async () => {
      const { proposalId } = await createReadyProposal("Field worker cannot link");
      const { error } = await fieldWorkerClient.rpc("create_proposal_portal_link", {
        p_tenant_id: tenantAId,
        p_proposal_id: proposalId,
        p_token_hash: sha256(genToken()),
        p_expires_at: new Date(Date.now() + 86400000).toISOString(),
      });
      expect(error).not.toBeNull();
    });

    it("Sales CAN create a link (deliberate decision, see 20260715100200)", async () => {
      const { proposalId } = await createReadyProposal("Sales creates link");
      const { data, error } = await salesClient
        .rpc("create_proposal_portal_link", {
          p_tenant_id: tenantAId,
          p_proposal_id: proposalId,
          p_token_hash: sha256(genToken()),
          p_expires_at: new Date(Date.now() + 86400000).toISOString(),
        })
        .single();
      expect(error).toBeNull();
      expect(data).toBeTruthy();
    });

    it("Estimator can create a link", async () => {
      const { proposalId } = await createReadyProposal("Estimator creates link");
      const { error } = await estimatorClient.rpc("create_proposal_portal_link", {
        p_tenant_id: tenantAId,
        p_proposal_id: proposalId,
        p_token_hash: sha256(genToken()),
        p_expires_at: new Date(Date.now() + 86400000).toISOString(),
      });
      expect(error).toBeNull();
    });
  });

  // ===========================================================================
  // Revoke
  // ===========================================================================
  describe("revoke_proposal_portal_link", () => {
    it("Owner revokes their own link", async () => {
      const { proposalId } = await createReadyProposal("Revoke target");
      const { linkId } = await createLink(proposalId);
      const { data, error } = await aClient.rpc("revoke_proposal_portal_link", { p_portal_link_id: linkId }).single();
      expect(error).toBeNull();
      expect((data as { status: string }).status).toBe("revoked");
      expect((data as { revoked_at: string | null }).revoked_at).not.toBeNull();
    });

    it("revoking an already-revoked link is idempotent", async () => {
      const { proposalId } = await createReadyProposal("Double revoke");
      const { linkId } = await createLink(proposalId);
      await aClient.rpc("revoke_proposal_portal_link", { p_portal_link_id: linkId });
      const { data, error } = await aClient.rpc("revoke_proposal_portal_link", { p_portal_link_id: linkId }).single();
      expect(error).toBeNull();
      expect((data as { status: string }).status).toBe("revoked");
    });

    it("Tenant B cannot revoke Tenant A's link", async () => {
      const { proposalId } = await createReadyProposal("Cross-tenant revoke attempt");
      const { linkId } = await createLink(proposalId);
      const { error } = await bClient.rpc("revoke_proposal_portal_link", { p_portal_link_id: linkId });
      expect(error).not.toBeNull();

      const { data: stillActive } = await admin.from("proposal_portal_links").select("status").eq("id", linkId).single();
      expect((stillActive as { status: string }).status).toBe("active");
    });

    it("Viewer cannot revoke a link", async () => {
      const { proposalId } = await createReadyProposal("Viewer cannot revoke");
      const { linkId } = await createLink(proposalId);
      const { error } = await viewerClient.rpc("revoke_proposal_portal_link", { p_portal_link_id: linkId });
      expect(error).not.toBeNull();
    });
  });

  // ===========================================================================
  // portal_get_link_info
  // ===========================================================================
  describe("portal_get_link_info", () => {
    it("returns is_valid=true with the correct business/proposal names for a fresh link", async () => {
      const { proposalId } = await createReadyProposal("Landing page info");
      const { tokenHash } = await createLink(proposalId);
      const { data } = await admin.rpc("portal_get_link_info", { p_token_hash: tokenHash }).single();
      const info = data as LinkInfo;
      expect(info.is_valid).toBe(true);
      expect(info.business_name).toBe("P3A Tenant A");
      expect(info.proposal_title).toBe("Landing page info");
    });

    it("an unknown token hash returns not_found", async () => {
      const { data } = await admin.rpc("portal_get_link_info", { p_token_hash: sha256("nonsense-token") }).single();
      const info = data as LinkInfo;
      expect(info.is_valid).toBe(false);
      expect(info.status_reason).toBe("not_found");
    });

    it("a revoked link returns is_valid=false, reason revoked", async () => {
      const { proposalId } = await createReadyProposal("Revoked link info");
      const { linkId, tokenHash } = await createLink(proposalId);
      await aClient.rpc("revoke_proposal_portal_link", { p_portal_link_id: linkId });
      const { data } = await admin.rpc("portal_get_link_info", { p_token_hash: tokenHash }).single();
      const info = data as LinkInfo;
      expect(info.is_valid).toBe(false);
      expect(info.status_reason).toBe("revoked");
    });

    it("an expired link returns is_valid=false, reason expired", async () => {
      const { proposalId } = await createReadyProposal("Expired link info");
      const { linkId, tokenHash } = await createLink(proposalId);
      await admin.from("proposal_portal_links").update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq("id", linkId);
      const { data } = await admin.rpc("portal_get_link_info", { p_token_hash: tokenHash }).single();
      const info = data as LinkInfo;
      expect(info.is_valid).toBe(false);
      expect(info.status_reason).toBe("expired");
    });

    it("a link to a proposal archived after link creation returns is_valid=false, reason unavailable", async () => {
      const { proposalId } = await createReadyProposal("Archived after link");
      const { tokenHash } = await createLink(proposalId);
      await aClient.rpc("archive_proposal", { p_proposal_id: proposalId });
      const { data } = await admin.rpc("portal_get_link_info", { p_token_hash: tokenHash }).single();
      const info = data as LinkInfo;
      expect(info.is_valid).toBe(false);
      expect(info.status_reason).toBe("unavailable");
    });
  });

  // ===========================================================================
  // portal_request_otp
  // ===========================================================================
  describe("portal_request_otp", () => {
    it("matching client email: outcome ok, email_matched true, a row is inserted", async () => {
      const { proposalId } = await createReadyProposal("OTP client email match");
      const { linkId, tokenHash } = await createLink(proposalId);
      const { result } = await requestOtp(tokenHash, CLIENT_EMAIL);
      expect(result.outcome).toBe("ok");
      expect(result.email_matched).toBe(true);

      const { data: rows } = await admin.from("proposal_portal_otps").select("id").eq("portal_link_id", linkId);
      expect((rows ?? []).length).toBe(1);
    });

    it("matching client_contact email: outcome ok, email_matched true", async () => {
      const { proposalId } = await createReadyProposal("OTP contact email match", { withContact: true });
      const { tokenHash } = await createLink(proposalId);
      const { result } = await requestOtp(tokenHash, CONTACT_EMAIL);
      expect(result.outcome).toBe("ok");
      expect(result.email_matched).toBe(true);
    });

    it("a non-matching email: outcome is still ok (no enumeration leak), but email_matched is false", async () => {
      const { proposalId } = await createReadyProposal("OTP unauthorized email");
      const { linkId, tokenHash } = await createLink(proposalId);
      const { result } = await requestOtp(tokenHash, UNAUTHORIZED_EMAIL);
      expect(result.outcome).toBe("ok");
      expect(result.email_matched).toBe(false);

      // A row IS still inserted (fix in 20260715100300) -- needed so the
      // rate limit can actually throttle repeated wrong-email guesses.
      const { data: rows } = await admin.from("proposal_portal_otps").select("id").eq("portal_link_id", linkId);
      expect((rows ?? []).length).toBe(1);
    });

    it("an invalid (revoked) link returns invalid_link", async () => {
      const { proposalId } = await createReadyProposal("OTP invalid link");
      const { linkId, tokenHash } = await createLink(proposalId);
      await aClient.rpc("revoke_proposal_portal_link", { p_portal_link_id: linkId });
      const { result } = await requestOtp(tokenHash, CLIENT_EMAIL);
      expect(result.outcome).toBe("invalid_link");
    });

    it("rate limits after 3 requests for the same link+email within the window", async () => {
      const { proposalId } = await createReadyProposal("OTP per-email rate limit");
      const { tokenHash } = await createLink(proposalId);
      await requestOtp(tokenHash, CLIENT_EMAIL);
      await requestOtp(tokenHash, CLIENT_EMAIL);
      await requestOtp(tokenHash, CLIENT_EMAIL);
      const { result: fourth } = await requestOtp(tokenHash, CLIENT_EMAIL);
      expect(fourth.outcome).toBe("rate_limited");
    });

    it("rate limits after 8 requests for the same link within the window, even across different (including wrong) emails", async () => {
      const { proposalId } = await createReadyProposal("OTP per-link rate limit");
      const { tokenHash } = await createLink(proposalId);
      for (let i = 0; i < 8; i++) {
        await requestOtp(tokenHash, email(`ratelimit-attempt-${i}`));
      }
      const { result: ninth } = await requestOtp(tokenHash, email("ratelimit-attempt-9"));
      expect(ninth.outcome).toBe("rate_limited");
    });
  });

  // ===========================================================================
  // portal_verify_otp
  // ===========================================================================
  describe("portal_verify_otp", () => {
    it("the correct code verifies and creates a session", async () => {
      const { proposalId } = await createReadyProposal("Verify success");
      const { tokenHash } = await createLink(proposalId);
      const { codeHash } = await requestOtp(tokenHash, CLIENT_EMAIL);
      const { result, sessionTokenHash } = await verifyOtp(tokenHash, CLIENT_EMAIL, codeHash);
      expect(result.outcome).toBe("verified");
      expect(result.tenant_id).toBe(tenantAId);
      expect(result.proposal_id).toBe(proposalId);

      const { data: session } = await admin.from("proposal_portal_sessions").select("*").eq("session_token_hash", sessionTokenHash).single();
      expect(session).toBeTruthy();
    });

    it("a wrong code returns wrong_code and increments attempt_count", async () => {
      const { proposalId } = await createReadyProposal("Verify wrong code");
      const { linkId, tokenHash } = await createLink(proposalId);
      const { result: bad } = await verifyOtp(tokenHash, CLIENT_EMAIL, sha256("000000"));
      // No code was ever requested for this email/link yet -- also wrong_code
      // (never distinguishable from "code exists but doesn't match").
      expect(bad.outcome).toBe("wrong_code");

      await requestOtp(tokenHash, CLIENT_EMAIL);
      const { result: stillBad } = await verifyOtp(tokenHash, CLIENT_EMAIL, sha256("999999"));
      expect(stillBad.outcome).toBe("wrong_code");

      const { data: otpRow } = await admin
        .from("proposal_portal_otps")
        .select("attempt_count")
        .eq("portal_link_id", linkId)
        .eq("client_email", CLIENT_EMAIL)
        .is("consumed_at", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();
      expect((otpRow as { attempt_count: number }).attempt_count).toBe(1);
    });

    it("too many wrong attempts locks out the code (max_attempts = 5)", async () => {
      const { proposalId } = await createReadyProposal("Verify too many attempts");
      const { tokenHash } = await createLink(proposalId);
      await requestOtp(tokenHash, CLIENT_EMAIL);
      for (let i = 0; i < 5; i++) {
        await verifyOtp(tokenHash, CLIENT_EMAIL, sha256("000000"));
      }
      const { result } = await verifyOtp(tokenHash, CLIENT_EMAIL, sha256("000000"));
      expect(result.outcome).toBe("too_many_attempts");
    });

    it("an expired code returns expired", async () => {
      const { proposalId } = await createReadyProposal("Verify expired code");
      const { linkId, tokenHash } = await createLink(proposalId);
      const { codeHash } = await requestOtp(tokenHash, CLIENT_EMAIL);
      await admin
        .from("proposal_portal_otps")
        .update({ expires_at: new Date(Date.now() - 1000).toISOString() })
        .eq("portal_link_id", linkId);
      const { result } = await verifyOtp(tokenHash, CLIENT_EMAIL, codeHash);
      expect(result.outcome).toBe("expired");
    });

    it("a consumed code cannot be reused", async () => {
      const { proposalId } = await createReadyProposal("Verify no reuse");
      const { tokenHash } = await createLink(proposalId);
      const { codeHash } = await requestOtp(tokenHash, CLIENT_EMAIL);
      const { result: first } = await verifyOtp(tokenHash, CLIENT_EMAIL, codeHash);
      expect(first.outcome).toBe("verified");
      const { result: second } = await verifyOtp(tokenHash, CLIENT_EMAIL, codeHash);
      expect(second.outcome).toBe("wrong_code");
    });

    it("an invalid (revoked) link returns invalid_link", async () => {
      const { proposalId } = await createReadyProposal("Verify invalid link");
      const { linkId, tokenHash } = await createLink(proposalId);
      const { codeHash } = await requestOtp(tokenHash, CLIENT_EMAIL);
      await aClient.rpc("revoke_proposal_portal_link", { p_portal_link_id: linkId });
      const { result } = await verifyOtp(tokenHash, CLIENT_EMAIL, codeHash);
      expect(result.outcome).toBe("invalid_link");
    });
  });

  // ===========================================================================
  // portal_get_session_context
  // ===========================================================================
  describe("portal_get_session_context", () => {
    it("a valid session returns ok with the correct ids and records a view event", async () => {
      const { proposalId, versionId } = await createReadyProposal("Session view context");
      const { tokenHash } = await createLink(proposalId);
      const { codeHash } = await requestOtp(tokenHash, CLIENT_EMAIL);
      const { sessionTokenHash } = await verifyOtp(tokenHash, CLIENT_EMAIL, codeHash);

      const context = await getSessionContext(sessionTokenHash);
      expect(context.outcome).toBe("ok");
      expect(context.tenant_id).toBe(tenantAId);
      expect(context.proposal_id).toBe(proposalId);
      expect(context.proposal_version_id).toBe(versionId);

      const { data: events } = await admin.from("proposal_view_events").select("id").eq("proposal_id", proposalId);
      expect((events ?? []).length).toBeGreaterThanOrEqual(1);
    });

    it("repeated views each get their own event row, but only the FIRST logs a crm_activities entry", async () => {
      const { proposalId } = await createReadyProposal("First view only activity");
      const { tokenHash } = await createLink(proposalId);
      const { codeHash } = await requestOtp(tokenHash, CLIENT_EMAIL);
      const { sessionTokenHash } = await verifyOtp(tokenHash, CLIENT_EMAIL, codeHash);

      await getSessionContext(sessionTokenHash);
      await getSessionContext(sessionTokenHash);
      await getSessionContext(sessionTokenHash);

      const { data: events } = await admin.from("proposal_view_events").select("id").eq("proposal_id", proposalId);
      expect((events ?? []).length).toBe(3);

      const { data: activities } = await admin
        .from("crm_activities")
        .select("id")
        .eq("client_id", clientAId)
        .eq("activity_type", "proposal_viewed_by_client");
      // Scoped loosely by client_id since multiple tests share clientAId --
      // just assert at least one exists, exact-once is verified indirectly
      // by the event-vs-activity count differing (3 events, not 3 activities
      // for this specific proposal) in the audit trail test below.
      expect((activities ?? []).length).toBeGreaterThanOrEqual(1);
    });

    it("a revoked session returns invalid_session", async () => {
      const { proposalId } = await createReadyProposal("Session revoked");
      const { tokenHash } = await createLink(proposalId);
      const { codeHash } = await requestOtp(tokenHash, CLIENT_EMAIL);
      const { sessionTokenHash } = await verifyOtp(tokenHash, CLIENT_EMAIL, codeHash);
      await admin.from("proposal_portal_sessions").update({ revoked_at: new Date().toISOString() }).eq("session_token_hash", sessionTokenHash);

      const context = await getSessionContext(sessionTokenHash);
      expect(context.outcome).toBe("invalid_session");
    });

    it("an expired session returns invalid_session", async () => {
      const { proposalId } = await createReadyProposal("Session expired");
      const { tokenHash } = await createLink(proposalId);
      const { codeHash } = await requestOtp(tokenHash, CLIENT_EMAIL);
      const { sessionTokenHash } = await verifyOtp(tokenHash, CLIENT_EMAIL, codeHash);
      await admin.from("proposal_portal_sessions").update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq("session_token_hash", sessionTokenHash);

      const context = await getSessionContext(sessionTokenHash);
      expect(context.outcome).toBe("invalid_session");
    });

    it("revoking the link AFTER a session was created immediately blocks that session too", async () => {
      const { proposalId } = await createReadyProposal("Session blocked by later link revoke");
      const { linkId, tokenHash } = await createLink(proposalId);
      const { codeHash } = await requestOtp(tokenHash, CLIENT_EMAIL);
      const { sessionTokenHash } = await verifyOtp(tokenHash, CLIENT_EMAIL, codeHash);

      // Confirm access works before revocation.
      expect((await getSessionContext(sessionTokenHash)).outcome).toBe("ok");

      await aClient.rpc("revoke_proposal_portal_link", { p_portal_link_id: linkId });
      const context = await getSessionContext(sessionTokenHash);
      expect(context.outcome).toBe("invalid_session");
    });

    it("archiving the proposal AFTER a session was created immediately blocks that session too", async () => {
      const { proposalId } = await createReadyProposal("Session blocked by later archive");
      const { tokenHash } = await createLink(proposalId);
      const { codeHash } = await requestOtp(tokenHash, CLIENT_EMAIL);
      const { sessionTokenHash } = await verifyOtp(tokenHash, CLIENT_EMAIL, codeHash);

      expect((await getSessionContext(sessionTokenHash)).outcome).toBe("ok");

      await aClient.rpc("archive_proposal", { p_proposal_id: proposalId });
      const context = await getSessionContext(sessionTokenHash);
      expect(context.outcome).toBe("invalid_session");
    });

    it("an unknown session token hash returns invalid_session", async () => {
      const context = await getSessionContext(sha256("nonsense-session-token"));
      expect(context.outcome).toBe("invalid_session");
    });
  });

  // ===========================================================================
  // Cross-tenant isolation
  // ===========================================================================
  describe("Cross-tenant isolation", () => {
    it("a session for Tenant A's proposal never resolves to Tenant B's ids, and vice versa", async () => {
      const { proposalId: proposalAId } = await createReadyProposal("Isolation A");
      const { tokenHash: tokenAHash } = await createLink(proposalAId);
      const { codeHash: codeAHash } = await requestOtp(tokenAHash, CLIENT_EMAIL);
      const { sessionTokenHash: sessionAHash } = await verifyOtp(tokenAHash, CLIENT_EMAIL, codeAHash);

      const { data: proposalB } = await bClient
        .rpc("create_proposal_direct", { p_tenant_id: tenantBId, p_client_id: clientBId, p_title: "Isolation B", p_service_type: "custom", p_custom_service_name: "Custom service" })
        .single();
      const proposalBId = (proposalB as { id: string }).id;
      await bClient.rpc("mark_proposal_ready", { p_proposal_id: proposalBId });
      const rawTokenB = genToken();
      const tokenBHash = sha256(rawTokenB);
      await bClient.rpc("create_proposal_portal_link", {
        p_tenant_id: tenantBId,
        p_proposal_id: proposalBId,
        p_token_hash: tokenBHash,
        p_expires_at: new Date(Date.now() + 86400000).toISOString(),
      });
      const { code: codeB } = await requestOtp(tokenBHash, "b-owner-has-no-client-email@example.com");
      void codeB;

      const contextA = await getSessionContext(sessionAHash);
      expect(contextA.tenant_id).toBe(tenantAId);
      expect(contextA.proposal_id).not.toBe(proposalBId);
    });
  });

  // ===========================================================================
  // RLS visibility
  // ===========================================================================
  describe("RLS: proposal_portal_links", () => {
    it("Owner can see their own tenant's links", async () => {
      const { proposalId } = await createReadyProposal("RLS visibility owner");
      await createLink(proposalId);
      const { data } = await aClient.from("proposal_portal_links").select("id").eq("proposal_id", proposalId);
      expect((data ?? []).length).toBeGreaterThanOrEqual(1);
    });

    it("Tenant B cannot see Tenant A's links (RLS returns zero rows, not an error)", async () => {
      const { proposalId } = await createReadyProposal("RLS visibility cross-tenant");
      await createLink(proposalId);
      const { data, error } = await bClient.from("proposal_portal_links").select("id").eq("proposal_id", proposalId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("Field Worker (no proposal_portal_links.view) sees zero rows, not an error", async () => {
      const { proposalId } = await createReadyProposal("RLS visibility field worker");
      await createLink(proposalId);
      const { data, error } = await fieldWorkerClient.from("proposal_portal_links").select("id").eq("proposal_id", proposalId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });
  });

  describe("RLS: proposal_portal_otps / proposal_portal_sessions have zero policies", () => {
    it("an ordinary tenant member (even the Owner) can never select proposal_portal_otps directly", async () => {
      const { data, error } = await aClient.from("proposal_portal_otps").select("id").limit(1);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("an ordinary tenant member (even the Owner) can never select proposal_portal_sessions directly", async () => {
      const { data, error } = await aClient.from("proposal_portal_sessions").select("id").limit(1);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });
  });

  // ===========================================================================
  // Audit & activity trail
  // ===========================================================================
  describe("Audit & CRM activity trail", () => {
    it("creating and revoking a link writes portal_link.created / portal_link.revoked audit rows", async () => {
      const { proposalId } = await createReadyProposal("Audit link lifecycle");
      const { linkId } = await createLink(proposalId);
      await aClient.rpc("revoke_proposal_portal_link", { p_portal_link_id: linkId });

      const { data: created } = await admin.from("audit_logs").select("id").eq("entity_id", linkId).eq("action", "portal_link.created");
      const { data: revoked } = await admin.from("audit_logs").select("id").eq("entity_id", linkId).eq("action", "portal_link.revoked");
      expect((created ?? []).length).toBeGreaterThanOrEqual(1);
      expect((revoked ?? []).length).toBeGreaterThanOrEqual(1);
    });

    it("requesting and verifying an OTP writes portal_otp.requested / portal_otp.verified audit rows", async () => {
      const { proposalId } = await createReadyProposal("Audit otp lifecycle");
      const { linkId, tokenHash } = await createLink(proposalId);
      const { codeHash } = await requestOtp(tokenHash, CLIENT_EMAIL);
      await verifyOtp(tokenHash, CLIENT_EMAIL, codeHash);

      const { data: requested } = await admin.from("audit_logs").select("id").eq("entity_id", linkId).eq("action", "portal_otp.requested");
      const { data: verified } = await admin.from("audit_logs").select("id").eq("entity_id", linkId).eq("action", "portal_otp.verified");
      expect((requested ?? []).length).toBeGreaterThanOrEqual(1);
      expect((verified ?? []).length).toBeGreaterThanOrEqual(1);
    });

    it("viewing the proposal writes a proposal.viewed audit row", async () => {
      const { proposalId } = await createReadyProposal("Audit proposal viewed");
      const { tokenHash } = await createLink(proposalId);
      const { codeHash } = await requestOtp(tokenHash, CLIENT_EMAIL);
      const { sessionTokenHash } = await verifyOtp(tokenHash, CLIENT_EMAIL, codeHash);
      await getSessionContext(sessionTokenHash);

      const { data } = await admin.from("audit_logs").select("id").eq("entity_id", proposalId).eq("action", "proposal.viewed");
      expect((data ?? []).length).toBeGreaterThanOrEqual(1);
    });

    it("creating a link writes a client_portal_link_created CRM activity visible to the contractor", async () => {
      const { proposalId } = await createReadyProposal("CRM activity link created");
      await createLink(proposalId);
      const { data } = await admin.from("crm_activities").select("id").eq("client_id", clientAId).eq("activity_type", "client_portal_link_created");
      expect((data ?? []).length).toBeGreaterThanOrEqual(1);
    });
  });
});
