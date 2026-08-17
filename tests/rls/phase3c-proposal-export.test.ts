/**
 * Phase 3C (Proposal PDF / Print Export) — security and version-safety
 * tests for the export routes. Phase 3C introduces ZERO new SQL functions
 * and ZERO new RLS policies: the contractor print route
 * (/proposals/[id]/print) reuses getFullProposal() (Phase 2A's own RLS-
 * protected data loader, now with an optional explicit version id), and
 * the portal print route (/p/[token]/print) reuses portal_get_session_context()
 * + getFullProposalForPortal() verbatim, unchanged from Phase 3A/3B.1. This
 * file exists to confirm those existing protections actually hold when
 * exercised THROUGH the new entry points this phase adds, not to re-derive
 * them from scratch — see docs/61-export-version-safety.md.
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
  return `test-p3c-${label}-${RUN_ID}@example.com`;
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

describe.skipIf(!canRun)("Phase 3C Proposal Export — security & version safety (requires real Postgres)", () => {
  let admin: SupabaseClient;
  let ownerA: TestUser, ownerB: TestUser;
  let aClient: SupabaseClient, bClient: SupabaseClient;
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

    ownerA = await createUser("a-owner");
    ownerB = await createUser("b-owner");
    [aClient, bClient] = await Promise.all([signIn(ownerA.email), signIn(ownerB.email)]);

    const { data: tenantA } = await aClient.rpc("create_tenant_with_owner", { p_name: "P3C Tenant A", p_slug: `p3c-a-${RUN_ID}` }).single();
    tenantAId = (tenantA as { id: string }).id;
    const { data: tenantB } = await bClient.rpc("create_tenant_with_owner", { p_name: "P3C Tenant B", p_slug: `p3c-b-${RUN_ID}` }).single();
    tenantBId = (tenantB as { id: string }).id;

    const { data: clientA } = await aClient
      .rpc("create_client", { p_tenant_id: tenantAId, p_client_type: "individual", p_display_name: "P3C Client A", p_email: CLIENT_EMAIL })
      .single();
    clientAId = (clientA as { id: string }).id;
    const { data: clientB } = await bClient
      .rpc("create_client", { p_tenant_id: tenantBId, p_client_type: "individual", p_display_name: "P3C Client B" })
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

  async function createReadyProposal(title: string, owner: SupabaseClient = aClient, tenantId = tenantAId, clientId = clientAId) {
    const { data: proposal } = await owner
      .rpc("create_proposal_direct", { p_tenant_id: tenantId, p_client_id: clientId, p_title: title, p_service_type: "custom", p_custom_service_name: "Custom service" })
      .single();
    const p = proposal as { id: string; current_version_id: string };
    await owner.rpc("mark_proposal_ready", { p_proposal_id: p.id });
    return { proposalId: p.id, versionId: p.current_version_id };
  }

  async function createLinkAndSession(proposalId: string, opts?: { owner?: SupabaseClient; tenantId?: string; expiresAt?: string }) {
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

    return { linkId, tokenHash, sessionTokenHash };
  }

  async function respond(sessionTokenHash: string, responseType: "accepted" | "declined", declineReason?: string) {
    const { data, error } = await admin
      .rpc("submit_proposal_client_response", {
        p_session_token_hash: sessionTokenHash,
        p_response_type: responseType,
        p_client_name: responseType === "accepted" ? "Jane Doe" : null,
        p_decline_reason: declineReason ?? null,
        p_accepted_terms: responseType === "accepted",
        p_ip_hash: sha256("127.0.0.1"),
        p_user_agent_hash: sha256("vitest"),
      })
      .single();
    if (error) throw error;
    return data as { outcome: string };
  }

  async function sessionContext(sessionTokenHash: string) {
    const { data } = await admin
      .rpc("portal_get_session_context", { p_session_token_hash: sessionTokenHash, p_ip_hash: sha256("127.0.0.1"), p_user_agent_hash: sha256("vitest") })
      .single();
    return data as { outcome: string; tenant_id: string | null; proposal_id: string | null; proposal_version_id: string | null };
  }

  // ===========================================================================
  // Contractor export: ownership + cross-proposal/cross-tenant version safety
  // ===========================================================================
  describe("Contractor export data access", () => {
    it("the owning tenant can read its own proposal + version (what getFullProposal's export path reads)", async () => {
      const { proposalId, versionId } = await createReadyProposal("Export owned proposal");
      const { data: version, error } = await aClient.from("proposal_versions").select("id, proposal_id").eq("id", versionId).eq("proposal_id", proposalId).single();
      expect(error).toBeNull();
      expect((version as { id: string }).id).toBe(versionId);
    });

    it("Tenant B cannot read Tenant A's proposal_versions row at all (RLS)", async () => {
      const { versionId, proposalId } = await createReadyProposal("Export cross-tenant blocked");
      const { data, error } = await bClient.from("proposal_versions").select("id").eq("id", versionId).eq("proposal_id", proposalId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("a version id that belongs to a DIFFERENT proposal never resolves, even within the same tenant (getFullProposal's own guard)", async () => {
      const { proposalId: proposalAId } = await createReadyProposal("Export proposal A");
      const { versionId: versionBId } = await createReadyProposal("Export proposal B (different proposal, same tenant)");

      // This mirrors exactly what getFullProposal() does: fetch the version
      // by id AND proposal_id together. A version belonging to a different
      // proposal must resolve to nothing, never proposal B's content under
      // proposal A's id.
      const { data, error } = await aClient.from("proposal_versions").select("id").eq("id", versionBId).eq("proposal_id", proposalAId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("a historical (superseded) version is still readable by its owning tenant for export", async () => {
      const { proposalId } = await createReadyProposal("Export historical version");
      const { sessionTokenHash } = await createLinkAndSession(proposalId);
      await respond(sessionTokenHash, "declined", "Need to revise");

      const { data: revision, error: revErr } = await aClient.rpc("create_proposal_revision", { p_proposal_id: proposalId }).single();
      expect(revErr).toBeNull();
      const oldVersionId = (await admin.from("proposals").select("current_version_id").eq("id", proposalId).single()).data;
      expect(oldVersionId).not.toBeNull();

      // Fetch the FIRST version explicitly (version_number = 1), which is now superseded.
      const { data: firstVersion } = await admin.from("proposal_versions").select("id").eq("proposal_id", proposalId).eq("version_number", 1).single();
      const { data: exportRow, error } = await aClient
        .from("proposal_versions")
        .select("id, version_status")
        .eq("id", (firstVersion as { id: string }).id)
        .eq("proposal_id", proposalId)
        .single();
      expect(error).toBeNull();
      expect((exportRow as { version_status: string }).version_status).toBe("superseded");
      expect((revision as { id: string }).id).not.toBe((firstVersion as { id: string }).id);
    });
  });

  // ===========================================================================
  // Portal export: the exact session -> version resolution the print route uses
  // ===========================================================================
  describe("Portal export version safety", () => {
    it("a revoked link's session cannot resolve a version to export", async () => {
      const { proposalId } = await createReadyProposal("Export revoked link blocked");
      const { linkId, sessionTokenHash } = await createLinkAndSession(proposalId);
      await aClient.rpc("revoke_proposal_portal_link", { p_portal_link_id: linkId });

      const ctx = await sessionContext(sessionTokenHash);
      expect(ctx.outcome).toBe("invalid_session");
    });

    it("an expired link's session cannot resolve a version to export", async () => {
      const { proposalId } = await createReadyProposal("Export expired link blocked");
      const { linkId, sessionTokenHash } = await createLinkAndSession(proposalId);
      await admin.from("proposal_portal_links").update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq("id", linkId);
      await admin.from("proposal_portal_sessions").update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq("session_token_hash", sessionTokenHash);

      const ctx = await sessionContext(sessionTokenHash);
      expect(ctx.outcome).toBe("invalid_session");
    });

    it("an archived proposal cannot resolve a version to export", async () => {
      const { proposalId } = await createReadyProposal("Export archived proposal blocked");
      const { sessionTokenHash } = await createLinkAndSession(proposalId);
      await aClient.rpc("archive_proposal", { p_proposal_id: proposalId });

      const ctx = await sessionContext(sessionTokenHash);
      expect(ctx.outcome).toBe("invalid_session");
    });

    it("after a revision, the OLD link's session still resolves the OLD version for export", async () => {
      const { proposalId, versionId: oldVersionId } = await createReadyProposal("Export old link after revision");
      const { sessionTokenHash: oldSessionHash } = await createLinkAndSession(proposalId);
      await respond(oldSessionHash, "declined", "Wrong scope");
      await aClient.rpc("create_proposal_revision", { p_proposal_id: proposalId });

      const ctx = await sessionContext(oldSessionHash);
      expect(ctx.outcome).toBe("ok");
      expect(ctx.proposal_version_id).toBe(oldVersionId);
    });

    it("a NEW link created after the revision resolves the NEW version for export", async () => {
      const { proposalId } = await createReadyProposal("Export new link after revision");
      const { sessionTokenHash: oldSessionHash } = await createLinkAndSession(proposalId);
      await respond(oldSessionHash, "declined");
      const { data: newVersion } = await aClient.rpc("create_proposal_revision", { p_proposal_id: proposalId }).single();
      await aClient.rpc("mark_proposal_ready", { p_proposal_id: proposalId });

      const { sessionTokenHash: newSessionHash } = await createLinkAndSession(proposalId);
      const ctx = await sessionContext(newSessionHash);
      expect(ctx.outcome).toBe("ok");
      expect(ctx.proposal_version_id).toBe((newVersion as { id: string }).id);
    });

    it("the client response is attached to the exact version exported (accepted case)", async () => {
      const { proposalId, versionId } = await createReadyProposal("Export includes response");
      const { sessionTokenHash } = await createLinkAndSession(proposalId);
      await respond(sessionTokenHash, "accepted");

      const { data: response } = await admin.from("proposal_client_responses").select("response_type, client_name").eq("proposal_version_id", versionId).single();
      expect((response as { response_type: string }).response_type).toBe("accepted");
      expect((response as { client_name: string }).client_name).toBe("Jane Doe");
    });
  });

  // ===========================================================================
  // Cross-tenant isolation, one more time, from a fresh angle: never leaks
  // ===========================================================================
  describe("Cross-tenant isolation", () => {
    it("Tenant B's own proposal is completely unaffected by Tenant A's export activity", async () => {
      const { proposalId: proposalAId } = await createReadyProposal("Isolation A export");
      const { proposalId: proposalBId } = await createReadyProposal("Isolation B export (untouched)", bClient, tenantBId, clientBId);

      const { sessionTokenHash } = await createLinkAndSession(proposalAId);
      await respond(sessionTokenHash, "declined");

      const { data: proposalB } = await admin.from("proposals").select("status").eq("id", proposalBId).single();
      expect((proposalB as { status: string }).status).toBe("ready");
    });
  });
});
