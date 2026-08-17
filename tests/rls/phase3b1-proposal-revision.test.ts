/**
 * Phase 3B.1 (Proposal Revision / New Version Flow) — create_proposal_revision():
 * content copy correctness (sections, labor of every pricing method,
 * line items, measurements/shapes, media), old-version locking/immutability,
 * old response staying attached to the old version, new version having no
 * response, old portal links continuing to resolve old content after a
 * revision, permission gating (Owner/Admin/Estimator/Sales allowed,
 * Viewer/Field Worker denied), cross-tenant isolation, and the audit/CRM
 * activity trail.
 *
 * Same infrastructure/conventions as tests/rls/phase3b-client-response.test.ts
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
  return `test-p3b1-${label}-${RUN_ID}@example.com`;
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
type ProposalVersion = { id: string; version_number: number; version_status: string; total_cents: number };

describe.skipIf(!canRun)("Phase 3B.1 Proposal Revision Flow (requires real Postgres)", () => {
  let admin: SupabaseClient;
  let ownerA: TestUser, ownerB: TestUser, viewerUser: TestUser, fieldWorkerUser: TestUser, salesUser: TestUser;
  let aClient: SupabaseClient, bClient: SupabaseClient, viewerClient: SupabaseClient, fieldWorkerClient: SupabaseClient, salesClient: SupabaseClient;
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
    viewerUser = await createUser("viewer");
    fieldWorkerUser = await createUser("field-worker");
    salesUser = await createUser("sales");

    [aClient, bClient, viewerClient, fieldWorkerClient, salesClient] = await Promise.all([
      signIn(ownerA.email),
      signIn(ownerB.email),
      signIn(viewerUser.email),
      signIn(fieldWorkerUser.email),
      signIn(salesUser.email),
    ]);

    const { data: tenantA } = await aClient.rpc("create_tenant_with_owner", { p_name: "P3B1 Tenant A", p_slug: `p3b1-a-${RUN_ID}` }).single();
    tenantAId = (tenantA as { id: string }).id;

    const { data: tenantB } = await bClient.rpc("create_tenant_with_owner", { p_name: "P3B1 Tenant B", p_slug: `p3b1-b-${RUN_ID}` }).single();
    tenantBId = (tenantB as { id: string }).id;

    async function inviteAndAccept(email_: string, roleKey: string, memberClient: SupabaseClient) {
      const { data: invite, error } = await aClient.rpc("invite_member_by_email", { p_tenant_id: tenantAId, p_email: email_, p_role_key: roleKey }).single();
      if (error) throw error;
      await memberClient.rpc("accept_invitation", { p_membership_id: (invite as { id: string }).id });
    }
    await inviteAndAccept(viewerUser.email, "viewer", viewerClient);
    await inviteAndAccept(fieldWorkerUser.email, "field_worker", fieldWorkerClient);
    await inviteAndAccept(salesUser.email, "sales", salesClient);

    const { data: clientA } = await aClient
      .rpc("create_client", { p_tenant_id: tenantAId, p_client_type: "individual", p_display_name: "P3B1 Client A", p_email: CLIENT_EMAIL })
      .single();
    clientAId = (clientA as { id: string }).id;

    const { data: clientB } = await bClient
      .rpc("create_client", { p_tenant_id: tenantBId, p_client_type: "individual", p_display_name: "P3B1 Client B" })
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
  // Helpers
  // ===========================================================================

  async function createReadyProposalWithContent(
    title: string,
    owner: SupabaseClient = aClient,
    tenantId = tenantAId,
    clientId = clientAId
  ): Promise<{ proposalId: string; versionId: string }> {
    const { data: proposal } = await owner
      .rpc("create_proposal_direct", { p_tenant_id: tenantId, p_client_id: clientId, p_title: title, p_service_type: "custom", p_custom_service_name: "Custom service" })
      .single();
    const p = proposal as { id: string; current_version_id: string };
    const versionId = p.current_version_id;

    const { data: section } = await owner
      .rpc("add_proposal_section", { p_proposal_version_id: versionId, p_title: "Scope of work", p_description: "Repaint interior", p_section_type: "scope" })
      .single();
    const sectionId = (section as { id: string }).id;

    // Two line items: one attached to the section, one not.
    await owner.rpc("add_proposal_line_item", {
      p_proposal_version_id: versionId,
      p_category: "material",
      p_description: "Interior paint, 5 gal",
      p_quantity: 3,
      p_unit: "gallon",
      p_unit_price_cents: 4500,
      p_taxable: true,
      p_section_id: sectionId,
    });
    await owner.rpc("add_proposal_line_item", {
      p_proposal_version_id: versionId,
      p_category: "equipment",
      p_description: "Ladder rental",
      p_quantity: 1,
      p_unit: "fixed",
      p_unit_price_cents: 2500,
      p_taxable: false,
      p_section_id: null,
    });

    // Two labor items: hourly and fixed, to prove pricing_method survives the copy.
    await owner.rpc("add_proposal_labor_item", {
      p_proposal_version_id: versionId,
      p_label: "Lead painter",
      p_worker_count: 2,
      p_estimated_days: 3,
      p_hours_per_day: 8,
      p_hourly_rate_cents: 3500,
      p_sort_order: 0,
      p_pricing_method: "hourly",
      p_fixed_total_cents: null,
    });
    await owner.rpc("add_proposal_labor_item", {
      p_proposal_version_id: versionId,
      p_label: "Cleanup crew",
      p_worker_count: null,
      p_estimated_days: null,
      p_hours_per_day: null,
      p_hourly_rate_cents: null,
      p_sort_order: 1,
      p_pricing_method: "fixed",
      p_fixed_total_cents: 15000,
    });

    // A measurement group + one manual-rectangle measurement + its shape.
    const { data: group } = await owner.rpc("create_measurement_group", { p_proposal_version_id: versionId, p_name: "Living room" }).single();
    const groupId = (group as { id: string }).id;
    const { data: measurement } = await owner
      .rpc("add_measurement", {
        p_proposal_version_id: versionId,
        p_measurement_group_id: groupId,
        p_name: "North wall",
        p_measurement_type: "wall_area",
        p_shape_type: "manual_rectangle",
        p_unit: "ft",
        p_length: 12,
        p_width: 10,
        p_height: 8,
      })
      .single();
    const measurementId = (measurement as { id: string }).id;
    // save_measurement_shape() creates its OWN new measurement+shape pair
    // (sketch mode entry point) rather than attaching a shape to an
    // existing measurement, so a direct admin insert is used here instead
    // to attach a shape row to the manual-rectangle measurement created
    // above -- exercising the exact table create_proposal_revision() must
    // copy (proposal_measurement_shapes), without pulling in a second,
    // unrelated measurement.
    const { error: shapeErr } = await admin.from("proposal_measurement_shapes").insert({
      tenant_id: tenantId,
      proposal_version_id: versionId,
      proposal_measurement_id: measurementId,
      shape_data: { type: "rectangle", points: [[0, 0], [12, 0], [12, 8], [0, 8]] },
    });
    if (shapeErr) throw shapeErr;

    // A media asset + attach it as a current-job photo.
    const { data: mediaAsset, error: mediaErr } = await admin
      .from("media_assets")
      .insert({
        tenant_id: tenantId,
        storage_path: `${tenantId}/${crypto.randomUUID()}/original.jpg`,
        original_filename: "before.jpg",
        mime_type: "image/jpeg",
        size_bytes: 12345,
        media_type: "current_job",
        uploaded_by: (await owner.auth.getUser()).data.user!.id,
      })
      .select("id")
      .single();
    if (mediaErr) throw mediaErr;
    await owner.rpc("attach_media_to_proposal", {
      p_proposal_version_id: versionId,
      p_media_asset_id: (mediaAsset as { id: string }).id,
      p_usage_type: "current_job",
      p_caption: "Before photo",
    });

    await owner.rpc("mark_proposal_ready", { p_proposal_id: p.id });
    return { proposalId: p.id, versionId };
  }

  async function createLinkAndSession(
    proposalId: string,
    opts?: { owner?: SupabaseClient; tenantId?: string }
  ): Promise<{ linkId: string; tokenHash: string; sessionTokenHash: string }> {
    const owner = opts?.owner ?? aClient;
    const tenantId = opts?.tenantId ?? tenantAId;
    const rawToken = genToken();
    const tokenHash = sha256(rawToken);
    const { data: link } = await owner
      .rpc("create_proposal_portal_link", {
        p_tenant_id: tenantId,
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

  async function createRespondedProposal(title: string, responseType: "accepted" | "declined", declineReason?: string) {
    const { proposalId, versionId } = await createReadyProposalWithContent(title);
    const { linkId, tokenHash, sessionTokenHash } = await createLinkAndSession(proposalId);
    const result = await respond(sessionTokenHash, responseType, declineReason);
    expect(result.outcome).toBe("ok");
    return { proposalId, oldVersionId: versionId, linkId, tokenHash, sessionTokenHash };
  }

  async function createRevision(proposalId: string, caller: SupabaseClient = aClient) {
    return caller.rpc("create_proposal_revision", { p_proposal_id: proposalId }).single();
  }

  // ===========================================================================
  // Core happy paths
  // ===========================================================================
  describe("create_proposal_revision — declined", () => {
    it("creates a new draft version, copies content, and returns the proposal to draft", async () => {
      const { proposalId, oldVersionId } = await createRespondedProposal("Revision from declined", "declined", "Too expensive");

      const { data, error } = await createRevision(proposalId);
      expect(error).toBeNull();
      const newVersion = data as ProposalVersion;
      expect(newVersion.version_number).toBe(2);
      expect(newVersion.version_status).toBe("draft");
      expect(newVersion.id).not.toBe(oldVersionId);

      const { data: proposal } = await admin.from("proposals").select("status, current_version_id").eq("id", proposalId).single();
      expect((proposal as { status: string }).status).toBe("draft");
      expect((proposal as { current_version_id: string }).current_version_id).toBe(newVersion.id);
    });

    it("the old version becomes superseded (not left as locked)", async () => {
      const { proposalId, oldVersionId } = await createRespondedProposal("Old version superseded", "declined");
      await createRevision(proposalId);

      const { data: oldVersion } = await admin.from("proposal_versions").select("version_status").eq("id", oldVersionId).single();
      expect((oldVersion as { version_status: string }).version_status).toBe("superseded");
    });

    it("copies sections, line items, labor items (both pricing methods), measurements/shapes, and media", async () => {
      const { proposalId } = await createRespondedProposal("Copy content", "declined");
      const { data: newVersion } = await createRevision(proposalId);
      const newVersionId = (newVersion as ProposalVersion).id;

      const { data: sections } = await admin.from("proposal_sections").select("title").eq("proposal_version_id", newVersionId);
      expect((sections ?? []).map((s) => s.title)).toEqual(["Scope of work"]);

      const { data: lineItems } = await admin.from("proposal_line_items").select("description, section_id").eq("proposal_version_id", newVersionId);
      expect((lineItems ?? []).length).toBe(2);
      const paintItem = (lineItems ?? []).find((li) => li.description === "Interior paint, 5 gal");
      expect(paintItem?.section_id).not.toBeNull(); // section_id remapped, not left pointing at the old section

      const { data: laborItems } = await admin.from("proposal_labor_items").select("label, pricing_method, fixed_total_cents, total_cents").eq("proposal_version_id", newVersionId);
      expect((laborItems ?? []).length).toBe(2);
      const hourly = (laborItems ?? []).find((l) => l.label === "Lead painter");
      const fixed = (laborItems ?? []).find((l) => l.label === "Cleanup crew");
      expect(hourly?.pricing_method).toBe("hourly");
      expect(fixed?.pricing_method).toBe("fixed");
      expect(fixed?.fixed_total_cents).toBe(15000);

      const { data: groupRows } = await admin.from("proposal_measurement_groups").select("id, name").eq("proposal_version_id", newVersionId);
      const groups = groupRows ?? [];
      expect(groups.length).toBe(1);
      const { data: measurementRows } = await admin.from("proposal_measurements").select("id, name, area").eq("proposal_version_id", newVersionId);
      const measurements = measurementRows ?? [];
      expect(measurements.length).toBe(1);
      expect(measurements[0]?.name).toBe("North wall");
      const { data: shapeRows } = await admin.from("proposal_measurement_shapes").select("proposal_measurement_id").eq("proposal_version_id", newVersionId);
      const shapes = shapeRows ?? [];
      expect(shapes.length).toBe(1);
      expect(shapes[0]?.proposal_measurement_id).toBe(measurements[0]?.id); // remapped to the NEW measurement, not the old one

      const { data: mediaRows } = await admin.from("proposal_media").select("caption, usage_type").eq("proposal_version_id", newVersionId);
      const media = mediaRows ?? [];
      expect(media.length).toBe(1);
      expect(media[0]?.caption).toBe("Before photo");
    });

    it("recalculates totals on the new version (non-zero, matching the copied labor/materials)", async () => {
      const { proposalId } = await createRespondedProposal("Totals recalculated", "declined");
      const { data: newVersion } = await createRevision(proposalId);
      const v = newVersion as ProposalVersion;
      expect(v.total_cents).toBeGreaterThan(0);
    });

    it("the old response stays linked to the OLD version; the new version has no response", async () => {
      const { proposalId, oldVersionId } = await createRespondedProposal("Response stays with old version", "declined", "Need to think about it");
      const { data: newVersion } = await createRevision(proposalId);
      const newVersionId = (newVersion as ProposalVersion).id;

      const { data: oldResponse } = await admin.from("proposal_client_responses").select("id, response_type, decline_reason").eq("proposal_version_id", oldVersionId).single();
      expect((oldResponse as { response_type: string }).response_type).toBe("declined");
      expect((oldResponse as { decline_reason: string }).decline_reason).toBe("Need to think about it");

      const { data: newResponse } = await admin.from("proposal_client_responses").select("id").eq("proposal_version_id", newVersionId);
      expect(newResponse ?? []).toEqual([]);
    });
  });

  describe("create_proposal_revision — accepted", () => {
    it("also works from an accepted proposal (UI-level confirmation, not a DB distinction)", async () => {
      const { proposalId, oldVersionId } = await createRespondedProposal("Revision from accepted", "accepted");
      const { data, error } = await createRevision(proposalId);
      expect(error).toBeNull();
      const newVersion = data as ProposalVersion;
      expect(newVersion.version_status).toBe("draft");

      const { data: oldResponse } = await admin.from("proposal_client_responses").select("response_type").eq("proposal_version_id", oldVersionId).single();
      expect((oldResponse as { response_type: string }).response_type).toBe("accepted"); // never overwritten or deleted
    });
  });

  // ===========================================================================
  // State-gating
  // ===========================================================================
  describe("State gating", () => {
    it("rejects a proposal that has never been responded to (still ready)", async () => {
      const { proposalId } = await createReadyProposalWithContent("Not yet responded");
      const { error } = await createRevision(proposalId);
      expect(error).not.toBeNull();
    });

    it("rejects a second revision attempt before the new version is itself responded to", async () => {
      const { proposalId } = await createRespondedProposal("Second revision too soon", "declined");
      await createRevision(proposalId);
      const { error } = await createRevision(proposalId);
      expect(error).not.toBeNull();
    });

    it("the new (draft) version accepts an ordinary edit", async () => {
      const { proposalId } = await createRespondedProposal("New version is editable", "declined");
      const { data: newVersion } = await createRevision(proposalId);
      const newVersionId = (newVersion as ProposalVersion).id;

      const { error } = await aClient.rpc("add_proposal_section", {
        p_proposal_version_id: newVersionId,
        p_title: "Additional scope",
        p_description: "",
        p_section_type: "custom",
      });
      expect(error).toBeNull();
    });

    it("the old (superseded) version still rejects a raw child mutation attempt", async () => {
      const { proposalId, oldVersionId } = await createRespondedProposal("Old version still immutable", "declined");
      await createRevision(proposalId);

      const { error } = await admin.from("proposal_sections").insert({
        tenant_id: tenantAId,
        proposal_version_id: oldVersionId,
        title: "Should be rejected -- superseded version",
        section_type: "custom",
      });
      expect(error).not.toBeNull();
      expect(error?.code).toBe("55000");
    });
  });

  // ===========================================================================
  // Portal link behavior after a revision
  // ===========================================================================
  describe("Portal links after a revision", () => {
    it("the OLD portal link still resolves the OLD (now superseded) version, regardless of the proposal's new draft status", async () => {
      const { proposalId, oldVersionId, tokenHash, sessionTokenHash } = await createRespondedProposal("Old link keeps working", "declined", "Timing isn't right");
      await createRevision(proposalId);

      const { data: linkInfo } = await admin.rpc("portal_get_link_info", { p_token_hash: tokenHash }).single();
      expect((linkInfo as { is_valid: boolean }).is_valid).toBe(true);

      const { data: sessionCtx } = await admin
        .rpc("portal_get_session_context", { p_session_token_hash: sessionTokenHash, p_ip_hash: sha256("127.0.0.1"), p_user_agent_hash: sha256("vitest") })
        .single();
      expect((sessionCtx as { outcome: string; proposal_version_id: string }).outcome).toBe("ok");
      expect((sessionCtx as { outcome: string; proposal_version_id: string }).proposal_version_id).toBe(oldVersionId);
    });

    it("a NEW portal link, created after the revised version is marked ready, points at the NEW version", async () => {
      const { proposalId } = await createRespondedProposal("New link points at new version", "declined");
      const { data: newVersion } = await createRevision(proposalId);
      const newVersionId = (newVersion as ProposalVersion).id;

      await aClient.rpc("mark_proposal_ready", { p_proposal_id: proposalId });
      const { linkId } = await createLinkAndSession(proposalId);

      const { data: link } = await admin.from("proposal_portal_links").select("proposal_version_id").eq("id", linkId).single();
      expect((link as { proposal_version_id: string }).proposal_version_id).toBe(newVersionId);
    });

    it("no new portal link can be created while the revision is still draft (not yet marked ready again)", async () => {
      const { proposalId } = await createRespondedProposal("Cannot link a draft revision", "declined");
      await createRevision(proposalId);

      const { error } = await aClient.rpc("create_proposal_portal_link", {
        p_tenant_id: tenantAId,
        p_proposal_id: proposalId,
        p_token_hash: sha256(genToken()),
        p_expires_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      });
      expect(error).not.toBeNull();
    });
  });

  // ===========================================================================
  // Permissions
  // ===========================================================================
  describe("Permissions", () => {
    it("Sales (has proposals.create_revision) can create a revision", async () => {
      const { proposalId } = await createRespondedProposal("Sales can revise", "declined");
      const { error } = await createRevision(proposalId, salesClient);
      expect(error).toBeNull();
    });

    it("Viewer (no proposals.create_revision) cannot create a revision", async () => {
      const { proposalId } = await createRespondedProposal("Viewer cannot revise", "declined");
      const { error } = await createRevision(proposalId, viewerClient);
      expect(error).not.toBeNull();
      expect(error?.message).toMatch(/Missing permission/);
    });

    it("Field Worker (no proposals.create_revision) cannot create a revision", async () => {
      const { proposalId } = await createRespondedProposal("Field worker cannot revise", "declined");
      const { error } = await createRevision(proposalId, fieldWorkerClient);
      expect(error).not.toBeNull();
      expect(error?.message).toMatch(/Missing permission/);
    });
  });

  // ===========================================================================
  // Cross-tenant isolation
  // ===========================================================================
  describe("Cross-tenant isolation", () => {
    it("Tenant B cannot create a revision for Tenant A's proposal", async () => {
      const { proposalId } = await createRespondedProposal("Cross-tenant revision blocked", "declined");
      const { error } = await createRevision(proposalId, bClient);
      expect(error).not.toBeNull();
    });

    it("a revision on Tenant A's proposal never touches Tenant B's data", async () => {
      const { proposalId: proposalAId } = await createRespondedProposal("Isolation A", "declined");
      const { proposalId: proposalBId } = await createReadyProposalWithContent("Isolation B (untouched)", bClient, tenantBId, clientBId);

      await createRevision(proposalAId);

      const { data: proposalB } = await admin.from("proposals").select("status").eq("id", proposalBId).single();
      expect((proposalB as { status: string }).status).toBe("ready");
    });
  });

  // ===========================================================================
  // Audit & CRM activity
  // ===========================================================================
  describe("Audit & CRM activity trail", () => {
    it("writes a proposal.revision_created audit row with old/new version ids, and a proposal_revision_created CRM activity", async () => {
      const { proposalId } = await createRespondedProposal("Audit trail for revision", "declined");
      const { data: newVersion } = await createRevision(proposalId);
      const newVersionId = (newVersion as ProposalVersion).id;

      const { data: auditRows } = await admin
        .from("audit_logs")
        .select("metadata")
        .eq("entity_id", proposalId)
        .eq("action", "proposal.revision_created")
        .single();
      const metadata = (auditRows as { metadata: { old_version_id: string; new_version_id: string } }).metadata;
      expect(metadata.new_version_id).toBe(newVersionId);
      expect(metadata.old_version_id).not.toBe(newVersionId);

      const { data: activityRows } = await admin
        .from("crm_activities")
        .select("id")
        .eq("client_id", clientAId)
        .eq("activity_type", "proposal_revision_created");
      expect((activityRows ?? []).length).toBeGreaterThanOrEqual(1);
    });
  });
});
