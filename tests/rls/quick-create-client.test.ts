/**
 * Quick Create Client (proposal form) — RLS/integration tests. The Server
 * Action (createQuickClientAction, src/actions/clients.ts) reuses the
 * EXACT SAME create_client() RPC and clients.create permission as the
 * general /clients/new form, so no new permission model exists to test —
 * this file confirms that reuse actually holds: the same role matrix,
 * the same cross-tenant blocking, already proven by Phase 1's own RLS
 * suite (tests/rls/phase1-crm.test.ts), also protects this new entry
 * point. It also validates the tenant-scoped duplicate-email lookup query
 * the action performs before calling create_client() — that check lives
 * in application code, not the RPC, so it's exercised here directly
 * against real Postgres/RLS rather than assumed.
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
  return `test-qcc-${label}-${RUN_ID}@example.com`;
}

async function signIn(addr: string): Promise<SupabaseClient> {
  const client = createClient(TEST_URL!, TEST_ANON_KEY!);
  const { error } = await client.auth.signInWithPassword({ email: addr, password: PASSWORD });
  if (error) throw error;
  return client;
}

type TestUser = { id: string; email: string };
type ClientRow = { id: string; display_name: string; client_type: string; email: string | null; phone: string | null };

describe.skipIf(!canRun)("Quick Create Client (requires real Postgres)", () => {
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
      .rpc("create_tenant_with_owner", { p_name: "QCC Tenant A", p_slug: `qcc-a-${RUN_ID}` })
      .single();
    tenantAId = (tenantA as { id: string }).id;

    const { data: tenantB } = await ownerBClient
      .rpc("create_tenant_with_owner", { p_name: "QCC Tenant B", p_slug: `qcc-b-${RUN_ID}` })
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

  it("Owner can quick-create a client (individual)", async () => {
    const { data, error } = await ownerAClient
      .rpc("create_client", {
        p_tenant_id: tenantAId,
        p_client_type: "individual",
        p_display_name: "John Smith",
        p_first_name: "John",
        p_last_name: "Smith",
        p_email: `owner-created-${RUN_ID}@example.com`,
        p_phone: "555-100-1000",
      })
      .single();
    expect(error).toBeNull();
    expect((data as ClientRow).display_name).toBe("John Smith");
  });

  it("Admin can quick-create a client", async () => {
    const { error } = await adminAClient.rpc("create_client", {
      p_tenant_id: tenantAId,
      p_client_type: "individual",
      p_display_name: "Admin Created",
      p_first_name: "Admin",
      p_last_name: "Created",
      p_email: `admin-created-${RUN_ID}@example.com`,
      p_phone: "555-100-1001",
    });
    expect(error).toBeNull();
  });

  it("Estimator can quick-create a client", async () => {
    const { error } = await estimatorAClient.rpc("create_client", {
      p_tenant_id: tenantAId,
      p_client_type: "individual",
      p_display_name: "Estimator Created",
      p_first_name: "Estimator",
      p_last_name: "Created",
      p_email: `estimator-created-${RUN_ID}@example.com`,
      p_phone: "555-100-1002",
    });
    expect(error).toBeNull();
  });

  it("Sales can quick-create a client", async () => {
    const { error } = await salesAClient.rpc("create_client", {
      p_tenant_id: tenantAId,
      p_client_type: "business",
      p_display_name: "Sales Created",
      p_first_name: "Sales",
      p_last_name: "Created",
      p_email: `sales-created-${RUN_ID}@example.com`,
      p_phone: "555-100-1003",
    });
    expect(error).toBeNull();
  });

  it("Viewer CANNOT quick-create a client", async () => {
    const { error } = await viewerAClient.rpc("create_client", {
      p_tenant_id: tenantAId,
      p_client_type: "individual",
      p_display_name: "Viewer Attempt",
      p_first_name: "Viewer",
      p_last_name: "Attempt",
      p_email: `viewer-attempt-${RUN_ID}@example.com`,
      p_phone: "555-100-1004",
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/permission/i);
  });

  it("Field Worker CANNOT quick-create a client (matches: doesn't create proposals either)", async () => {
    const { error } = await fieldWorkerAClient.rpc("create_client", {
      p_tenant_id: tenantAId,
      p_client_type: "individual",
      p_display_name: "Field Worker Attempt",
      p_first_name: "Field",
      p_last_name: "Worker",
      p_email: `field-worker-attempt-${RUN_ID}@example.com`,
      p_phone: "555-100-1005",
    });
    expect(error).not.toBeNull();
  });

  it("Tenant B's owner cannot create a client under Tenant A (cross-tenant insert blocked)", async () => {
    const { error } = await ownerBClient.rpc("create_client", {
      p_tenant_id: tenantAId,
      p_client_type: "individual",
      p_display_name: "Cross Tenant Attempt",
      p_first_name: "Cross",
      p_last_name: "Tenant",
      p_email: `cross-tenant-${RUN_ID}@example.com`,
      p_phone: "555-100-1006",
    });
    expect(error).not.toBeNull();
  });

  it("a newly quick-created client is immediately visible to the same tenant (available for proposals)", async () => {
    const uniqueEmail = `visible-${RUN_ID}@example.com`;
    const { data: created } = await ownerAClient
      .rpc("create_client", {
        p_tenant_id: tenantAId,
        p_client_type: "individual",
        p_display_name: "Visible Client",
        p_first_name: "Visible",
        p_last_name: "Client",
        p_email: uniqueEmail,
        p_phone: "555-100-1007",
      })
      .single();

    const { data: options } = await ownerAClient
      .from("clients")
      .select("id, display_name")
      .eq("tenant_id", tenantAId)
      .eq("id", (created as ClientRow).id);
    expect(options).toHaveLength(1);
    expect(options?.[0]?.display_name).toBe("Visible Client");
  });

  it("the tenant-scoped duplicate-email lookup the action performs finds an existing active client", async () => {
    const dupEmail = `dup-lookup-${RUN_ID}@example.com`;
    await ownerAClient.rpc("create_client", {
      p_tenant_id: tenantAId,
      p_client_type: "individual",
      p_display_name: "First One",
      p_first_name: "First",
      p_last_name: "One",
      p_email: dupEmail,
      p_phone: "555-100-1008",
    });

    // Exactly the query createQuickClientAction runs before calling
    // create_client() — see src/actions/clients.ts.
    const { data: existing } = await ownerAClient
      .from("clients")
      .select("id")
      .eq("tenant_id", tenantAId)
      .ilike("email", dupEmail)
      .is("archived_at", null)
      .limit(1);
    expect(existing).toHaveLength(1);
  });

  it("the duplicate-email lookup is tenant-scoped — the same email in a DIFFERENT tenant is not found", async () => {
    const crossEmail = `cross-dup-${RUN_ID}@example.com`;
    await ownerBClient.rpc("create_client", {
      p_tenant_id: tenantBId,
      p_client_type: "individual",
      p_display_name: "Tenant B Client",
      p_first_name: "Tenant",
      p_last_name: "B",
      p_email: crossEmail,
      p_phone: "555-100-1009",
    });

    // Owner A looking for that same email, scoped to THEIR OWN tenant.
    const { data: existing } = await ownerAClient
      .from("clients")
      .select("id")
      .eq("tenant_id", tenantAId)
      .ilike("email", crossEmail)
      .is("archived_at", null)
      .limit(1);
    expect(existing ?? []).toHaveLength(0);
  });

  it("a business client's first/last name can also be registered as its primary contact", async () => {
    const { data: created } = await ownerAClient
      .rpc("create_client", {
        p_tenant_id: tenantAId,
        p_client_type: "business",
        p_display_name: "Acme Contact Person",
        p_first_name: "Acme",
        p_last_name: "ContactPerson",
        p_email: `acme-${RUN_ID}@example.com`,
        p_phone: "555-100-1010",
      })
      .single();

    const { data: contact, error } = await ownerAClient
      .rpc("create_client_contact", {
        p_client_id: (created as ClientRow).id,
        p_first_name: "Acme",
        p_last_name: "ContactPerson",
        p_email: `acme-${RUN_ID}@example.com`,
        p_phone: "555-100-1010",
        p_is_primary: true,
      })
      .single();
    expect(error).toBeNull();
    expect((contact as { is_primary: boolean }).is_primary).toBe(true);
  });
});
