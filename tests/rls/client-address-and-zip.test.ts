/**
 * Client Address + Material ZIP Defaults — RLS/integration tests. Covers
 * two things against real Postgres: (1) the new address columns/params on
 * create_client()/update_client() respect the exact same clients.create/
 * clients.update permission model and tenant isolation as every other
 * client field (no new permission surface was added), and (2) the new
 * ZIP-default wiring in create_proposal_direct()/create_initial_proposal_version()
 * — a proposal's pricing_zip_code is seeded from its client's postal_code
 * when it looks like a valid 5-digit US ZIP, never otherwise, and a
 * manual override via update_proposal_pricing_zip() is never re-clobbered.
 *
 * Runs against the same real, dedicated test Supabase project as every
 * other RLS suite; skipped entirely if the env vars are absent.
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
  return `test-addrzip-${label}-${RUN_ID}@example.com`;
}

async function signIn(addr: string): Promise<SupabaseClient> {
  const client = createClient(TEST_URL!, TEST_ANON_KEY!);
  const { error } = await client.auth.signInWithPassword({ email: addr, password: PASSWORD });
  if (error) throw error;
  return client;
}

type TestUser = { id: string; email: string };
type ClientRow = {
  id: string;
  display_name: string;
  address_line_1: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country_code: string | null;
};
type ProposalRow = { id: string };
type ProposalVersionRow = { id: string; pricing_zip_code: string | null };

describe.skipIf(!canRun)("Client Address + Material ZIP Defaults (requires real Postgres)", () => {
  let admin: SupabaseClient;
  let ownerA: TestUser, viewerA: TestUser, ownerB: TestUser;
  let ownerAClient: SupabaseClient, viewerAClient: SupabaseClient, ownerBClient: SupabaseClient;
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
    viewerA = await createUser("a-viewer");
    ownerB = await createUser("b-owner");

    [ownerAClient, viewerAClient, ownerBClient] = await Promise.all([signIn(ownerA.email), signIn(viewerA.email), signIn(ownerB.email)]);

    const { data: tenantA } = await ownerAClient
      .rpc("create_tenant_with_owner", { p_name: "AddrZip Tenant A", p_slug: `addrzip-a-${RUN_ID}` })
      .single();
    tenantAId = (tenantA as { id: string }).id;

    const { data: tenantB } = await ownerBClient
      .rpc("create_tenant_with_owner", { p_name: "AddrZip Tenant B", p_slug: `addrzip-b-${RUN_ID}` })
      .single();
    tenantBId = (tenantB as { id: string }).id;

    const { data: invite, error: inviteErr } = await ownerAClient
      .rpc("invite_member_by_email", { p_tenant_id: tenantAId, p_email: viewerA.email, p_role_key: "viewer" })
      .single();
    if (inviteErr) throw inviteErr;
    const { error: acceptErr } = await viewerAClient.rpc("accept_invitation", { p_membership_id: (invite as { id: string }).id });
    if (acceptErr) throw acceptErr;
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

  it("Owner/Admin can create a client with a full address", async () => {
    const { data, error } = await ownerAClient
      .rpc("create_client", {
        p_tenant_id: tenantAId,
        p_client_type: "individual",
        p_display_name: "Address Test Client",
        p_address_line1: "123 Main St",
        p_city: "Miami",
        p_state: "FL",
        p_postal_code: "33101",
        p_country_code: "US",
      })
      .single();
    expect(error).toBeNull();
    const row = data as ClientRow;
    expect(row.address_line_1).toBe("123 Main St");
    expect(row.postal_code).toBe("33101");
  });

  it("Viewer CANNOT create a client with an address (same clients.create gate as every other field)", async () => {
    const { error } = await viewerAClient.rpc("create_client", {
      p_tenant_id: tenantAId,
      p_client_type: "individual",
      p_display_name: "Viewer Attempt",
      p_postal_code: "33101",
    });
    expect(error).not.toBeNull();
  });

  it("rejects a malformed postal code with a friendly error, not a raw constraint violation", async () => {
    const { error } = await ownerAClient.rpc("create_client", {
      p_tenant_id: tenantAId,
      p_client_type: "individual",
      p_display_name: "Bad Zip Client",
      p_postal_code: "!!!",
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/valid ZIP or postal code/i);
  });

  it("Tenant B's owner cannot read or update Tenant A's client address (cross-tenant blocked)", async () => {
    const { data: created } = await ownerAClient
      .rpc("create_client", {
        p_tenant_id: tenantAId,
        p_client_type: "individual",
        p_display_name: "Cross Tenant Address Client",
        p_postal_code: "10001",
      })
      .single();
    const clientId = (created as ClientRow).id;

    const { data: readAttempt } = await ownerBClient.from("clients").select("id, postal_code").eq("id", clientId);
    expect(readAttempt ?? []).toHaveLength(0);

    const { error: updateErr } = await ownerBClient.rpc("update_client", {
      p_client_id: clientId,
      p_client_type: "individual",
      p_display_name: "Hijacked",
      p_legal_name: null,
      p_first_name: null,
      p_last_name: null,
      p_email: null,
      p_phone: null,
      p_secondary_phone: null,
      p_website: null,
      p_tax_exempt: false,
      p_preferred_contact_method: null,
      p_source: null,
      p_postal_code: "99999",
    });
    expect(updateErr).not.toBeNull();
  });

  it("a proposal created for a client with a valid 5-digit US ZIP gets that ZIP as its default pricing ZIP", async () => {
    const { data: client } = await ownerAClient
      .rpc("create_client", {
        p_tenant_id: tenantAId,
        p_client_type: "individual",
        p_display_name: "Zip Default Client",
        p_postal_code: "94105",
      })
      .single();
    const clientId = (client as ClientRow).id;

    const { data: proposal, error: proposalErr } = await ownerAClient
      .rpc("create_proposal_direct", {
        p_tenant_id: tenantAId,
        p_client_id: clientId,
        p_title: `ZIP default proposal ${RUN_ID}`,
        p_service_type: "custom",
      })
      .single();
    expect(proposalErr).toBeNull();
    const proposalId = (proposal as ProposalRow).id;

    const { data: version } = await ownerAClient
      .from("proposal_versions")
      .select("id, pricing_zip_code")
      .eq("proposal_id", proposalId)
      .single();
    expect((version as ProposalVersionRow).pricing_zip_code).toBe("94105");
  });

  it("a proposal created for a client with a NON-US-ZIP-shaped postal code gets no default pricing ZIP (never blocks creation)", async () => {
    const { data: client } = await ownerAClient
      .rpc("create_client", {
        p_tenant_id: tenantAId,
        p_client_type: "individual",
        p_display_name: "Intl Zip Client",
        p_postal_code: "SW1A 2AA",
        p_country_code: "GB",
      })
      .single();
    const clientId = (client as ClientRow).id;

    const { data: proposal, error: proposalErr } = await ownerAClient
      .rpc("create_proposal_direct", {
        p_tenant_id: tenantAId,
        p_client_id: clientId,
        p_title: `Intl proposal ${RUN_ID}`,
        p_service_type: "custom",
      })
      .single();
    expect(proposalErr).toBeNull();
    const proposalId = (proposal as ProposalRow).id;

    const { data: version } = await ownerAClient
      .from("proposal_versions")
      .select("id, pricing_zip_code")
      .eq("proposal_id", proposalId)
      .single();
    expect((version as ProposalVersionRow).pricing_zip_code).toBeNull();
  });

  it("a proposal created for a client with a ZIP+4 postal code gets the first 5 digits as its default", async () => {
    const { data: client } = await ownerAClient
      .rpc("create_client", {
        p_tenant_id: tenantAId,
        p_client_type: "individual",
        p_display_name: "Zip Plus Four Client",
        p_postal_code: "10001-1234",
      })
      .single();
    const clientId = (client as ClientRow).id;

    const { data: proposal } = await ownerAClient
      .rpc("create_proposal_direct", {
        p_tenant_id: tenantAId,
        p_client_id: clientId,
        p_title: `Zip plus four proposal ${RUN_ID}`,
        p_service_type: "custom",
      })
      .single();
    const proposalId = (proposal as ProposalRow).id;

    const { data: version } = await ownerAClient.from("proposal_versions").select("pricing_zip_code").eq("proposal_id", proposalId).single();
    expect((version as ProposalVersionRow).pricing_zip_code).toBe("10001");
  });

  it("a manual ZIP override via update_proposal_pricing_zip() is never re-clobbered by the client's own ZIP", async () => {
    const { data: client } = await ownerAClient
      .rpc("create_client", {
        p_tenant_id: tenantAId,
        p_client_type: "individual",
        p_display_name: "Override Client",
        p_postal_code: "30301",
      })
      .single();
    const clientId = (client as ClientRow).id;

    const { data: proposal } = await ownerAClient
      .rpc("create_proposal_direct", {
        p_tenant_id: tenantAId,
        p_client_id: clientId,
        p_title: `Override proposal ${RUN_ID}`,
        p_service_type: "custom",
      })
      .single();
    const proposalId = (proposal as ProposalRow).id;

    const { data: versionBefore } = await ownerAClient.from("proposal_versions").select("id, pricing_zip_code").eq("proposal_id", proposalId).single();
    expect((versionBefore as ProposalVersionRow).pricing_zip_code).toBe("30301");
    const versionId = (versionBefore as ProposalVersionRow).id;

    const { error: updateErr } = await ownerAClient.rpc("update_proposal_pricing_zip", {
      p_proposal_version_id: versionId,
      p_zip_code: "90210",
    });
    expect(updateErr).toBeNull();

    // Nothing else in the app ever re-runs the client-default logic after
    // creation -- confirm the override sticks by re-reading.
    const { data: versionAfter } = await ownerAClient.from("proposal_versions").select("pricing_zip_code").eq("id", versionId).single();
    expect((versionAfter as { pricing_zip_code: string | null }).pricing_zip_code).toBe("90210");
  });

  it("Materials search honors the proposal's own saved ZIP", async () => {
    const { data: client } = await ownerAClient
      .rpc("create_client", {
        p_tenant_id: tenantAId,
        p_client_type: "individual",
        p_display_name: "Materials Search Client",
        p_postal_code: "33101",
      })
      .single();
    const clientId = (client as ClientRow).id;

    const { data: proposal } = await ownerAClient
      .rpc("create_proposal_direct", {
        p_tenant_id: tenantAId,
        p_client_id: clientId,
        p_title: `Materials search proposal ${RUN_ID}`,
        p_service_type: "custom",
      })
      .single();
    const proposalId = (proposal as ProposalRow).id;

    const { data: version } = await ownerAClient.from("proposal_versions").select("pricing_zip_code").eq("proposal_id", proposalId).single();
    expect((version as { pricing_zip_code: string | null }).pricing_zip_code).toBe("33101");

    const { data: results, error: searchErr } = await ownerAClient.rpc("search_material_catalog", {
      p_tenant_id: tenantAId,
      p_zip_code: (version as { pricing_zip_code: string | null }).pricing_zip_code as string,
      p_limit: 5,
      p_offset: 0,
    });
    expect(searchErr).toBeNull();
    expect(Array.isArray(results)).toBe(true);
  });
});
