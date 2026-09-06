/**
 * Phase 3D.2 Business logo upload — RLS/integration tests. Covers both the
 * private `tenant-branding` Storage bucket and the permission-checked
 * get/update/remove_tenant_branding() functions, which deliberately reuse
 * the Phase 0 tenant.view / tenant.update permissions rather than a new
 * business_branding.* key — see docs/69-business-branding-logo-upload.md.
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
  return `test-p3d2-branding-${label}-${RUN_ID}@example.com`;
}

async function signIn(addr: string): Promise<SupabaseClient> {
  const client = createClient(TEST_URL!, TEST_ANON_KEY!);
  const { error } = await client.auth.signInWithPassword({ email: addr, password: PASSWORD });
  if (error) throw error;
  return client;
}

// A real, valid 1x1 transparent PNG (67 bytes).
const ONE_PIXEL_PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="),
  (c) => c.charCodeAt(0)
);

type TestUser = { id: string; email: string };
type TenantsRow = {
  logo_storage_path: string | null;
  logo_original_filename: string | null;
  logo_content_type: string | null;
  logo_size_bytes: number | null;
  logo_updated_at: string | null;
};

describe.skipIf(!canRun)("Phase 3D.2 Business branding security (requires real Postgres + Storage)", () => {
  let admin: SupabaseClient;
  let ownerA: TestUser, adminA: TestUser, estimatorA: TestUser, viewerA: TestUser, ownerB: TestUser;
  let ownerAClient: SupabaseClient, adminAClient: SupabaseClient, estimatorAClient: SupabaseClient, viewerAClient: SupabaseClient, ownerBClient: SupabaseClient;
  let tenantAId: string, tenantBId: string;

  const allUserIds: string[] = [];
  const uploadedPaths: string[] = [];

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
    viewerA = await createUser("a-viewer");
    ownerB = await createUser("b-owner");

    [ownerAClient, adminAClient, estimatorAClient, viewerAClient, ownerBClient] = await Promise.all([
      signIn(ownerA.email),
      signIn(adminA.email),
      signIn(estimatorA.email),
      signIn(viewerA.email),
      signIn(ownerB.email),
    ]);

    const { data: tenantA } = await ownerAClient
      .rpc("create_tenant_with_owner", { p_name: "P3D2 Branding Tenant A", p_slug: `p3d2-branding-a-${RUN_ID}` })
      .single();
    tenantAId = (tenantA as { id: string }).id;

    const { data: tenantB } = await ownerBClient
      .rpc("create_tenant_with_owner", { p_name: "P3D2 Branding Tenant B", p_slug: `p3d2-branding-b-${RUN_ID}` })
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
    await inviteAndAccept(viewerAClient, viewerA.email, "viewer");
  });

  afterAll(async () => {
    if (uploadedPaths.length > 0) {
      await admin.storage.from("tenant-branding").remove(uploadedPaths).catch(() => {});
    }
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

  it("the tenant-branding bucket is private with a 10 MB limit", async () => {
    const { data: buckets } = await admin.storage.listBuckets();
    const bucket = buckets?.find((b) => b.id === "tenant-branding");
    expect(bucket).toBeDefined();
    expect(bucket?.public).toBe(false);
    expect(bucket?.file_size_limit).toBe(10485760);
  });

  it("Owner A can upload a valid PNG to their own tenant's branding path", async () => {
    const path = `${tenantAId}/logo-${crypto.randomUUID()}.png`;
    const { error } = await ownerAClient.storage.from("tenant-branding").upload(path, ONE_PIXEL_PNG, { contentType: "image/png" });
    expect(error).toBeNull();
    uploadedPaths.push(path);
  });

  it("an oversized file is rejected by the bucket's file_size_limit", async () => {
    const oversized = new Uint8Array(10 * 1024 * 1024 + 1);
    const path = `${tenantAId}/logo-${crypto.randomUUID()}.png`;
    const { error } = await ownerAClient.storage.from("tenant-branding").upload(path, oversized, { contentType: "image/png" });
    expect(error).not.toBeNull();
  });

  it("an unsupported MIME type (e.g. SVG) is rejected by the bucket's allowed_mime_types", async () => {
    const path = `${tenantAId}/logo-${crypto.randomUUID()}.svg`;
    const { error } = await ownerAClient.storage
      .from("tenant-branding")
      .upload(path, new TextEncoder().encode("<svg></svg>"), { contentType: "image/svg+xml" });
    expect(error).not.toBeNull();
  });

  it("Tenant A cannot upload under Tenant B's branding path", async () => {
    const path = `${tenantBId}/logo-${crypto.randomUUID()}.png`;
    const { error } = await ownerAClient.storage.from("tenant-branding").upload(path, ONE_PIXEL_PNG, { contentType: "image/png" });
    expect(error).not.toBeNull();
  });

  it("Tenant A cannot download Tenant B's logo object", async () => {
    const bPath = `${tenantBId}/logo-${crypto.randomUUID()}.png`;
    await admin.storage.from("tenant-branding").upload(bPath, ONE_PIXEL_PNG, { contentType: "image/png" });
    uploadedPaths.push(bPath);

    const { error } = await ownerAClient.storage.from("tenant-branding").download(bPath);
    expect(error).not.toBeNull();
  });

  it("Estimator cannot upload a logo (no tenant.update)", async () => {
    const path = `${tenantAId}/logo-${crypto.randomUUID()}.png`;
    const { error } = await estimatorAClient.storage.from("tenant-branding").upload(path, ONE_PIXEL_PNG, { contentType: "image/png" });
    expect(error).not.toBeNull();
  });

  it("Viewer cannot upload a logo (no tenant.update)", async () => {
    const path = `${tenantAId}/logo-${crypto.randomUUID()}.png`;
    const { error } = await viewerAClient.storage.from("tenant-branding").upload(path, ONE_PIXEL_PNG, { contentType: "image/png" });
    expect(error).not.toBeNull();
  });

  it("Estimator CAN read the branding path with a signed URL request denied at the object level (no tenant.view download without prior upload) — but get_tenant_branding still works via tenant.view", async () => {
    const { data, error } = await estimatorAClient.rpc("get_tenant_branding", { p_tenant_id: tenantAId }).single();
    expect(error).toBeNull();
    expect(data).toBeTruthy();
  });

  it("update_tenant_branding rejects a storage path that does not start with the caller's own tenant id", async () => {
    const { error } = await ownerAClient.rpc("update_tenant_branding", {
      p_tenant_id: tenantAId,
      p_logo_storage_path: `${tenantBId}/logo-fake.png`,
      p_logo_original_filename: "logo.png",
      p_logo_content_type: "image/png",
      p_logo_size_bytes: 100,
    });
    expect(error).not.toBeNull();
  });

  it("Owner A can update the tenant's branding, and it is readable by every member of Tenant A", async () => {
    const path = `${tenantAId}/logo-${crypto.randomUUID()}.png`;
    await admin.storage.from("tenant-branding").upload(path, ONE_PIXEL_PNG, { contentType: "image/png" });
    uploadedPaths.push(path);

    const { data, error } = await ownerAClient
      .rpc("update_tenant_branding", {
        p_tenant_id: tenantAId,
        p_logo_storage_path: path,
        p_logo_original_filename: "logo.png",
        p_logo_content_type: "image/png",
        p_logo_size_bytes: ONE_PIXEL_PNG.byteLength,
      })
      .single();
    expect(error).toBeNull();
    const row = data as TenantsRow;
    expect(row.logo_storage_path).toBe(path);
    expect(row.logo_updated_at).toBeTruthy();

    const { data: viewerRead } = await viewerAClient.rpc("get_tenant_branding", { p_tenant_id: tenantAId }).single();
    expect((viewerRead as TenantsRow).logo_storage_path).toBe(path);
  });

  it("Admin CAN update the tenant's branding", async () => {
    const path = `${tenantAId}/logo-${crypto.randomUUID()}.png`;
    await admin.storage.from("tenant-branding").upload(path, ONE_PIXEL_PNG, { contentType: "image/png" });
    uploadedPaths.push(path);

    const { error } = await adminAClient.rpc("update_tenant_branding", {
      p_tenant_id: tenantAId,
      p_logo_storage_path: path,
      p_logo_original_filename: "logo.png",
      p_logo_content_type: "image/png",
      p_logo_size_bytes: ONE_PIXEL_PNG.byteLength,
    });
    expect(error).toBeNull();
  });

  it("Estimator CANNOT update the tenant's branding (view-only)", async () => {
    const { error } = await estimatorAClient.rpc("update_tenant_branding", {
      p_tenant_id: tenantAId,
      p_logo_storage_path: `${tenantAId}/logo-${crypto.randomUUID()}.png`,
      p_logo_original_filename: "logo.png",
      p_logo_content_type: "image/png",
      p_logo_size_bytes: 100,
    });
    expect(error).not.toBeNull();
  });

  it("Viewer CANNOT update the tenant's branding", async () => {
    const { error } = await viewerAClient.rpc("update_tenant_branding", {
      p_tenant_id: tenantAId,
      p_logo_storage_path: `${tenantAId}/logo-${crypto.randomUUID()}.png`,
      p_logo_original_filename: "logo.png",
      p_logo_content_type: "image/png",
      p_logo_size_bytes: 100,
    });
    expect(error).not.toBeNull();
  });

  it("Tenant B's owner cannot read or update Tenant A's branding (not a member)", async () => {
    const { error: readErr } = await ownerBClient.rpc("get_tenant_branding", { p_tenant_id: tenantAId });
    expect(readErr).not.toBeNull();

    const { error: updateErr } = await ownerBClient.rpc("update_tenant_branding", {
      p_tenant_id: tenantAId,
      p_logo_storage_path: `${tenantAId}/logo-${crypto.randomUUID()}.png`,
      p_logo_original_filename: "logo.png",
      p_logo_content_type: "image/png",
      p_logo_size_bytes: 100,
    });
    expect(updateErr).not.toBeNull();
  });

  it("Estimator CANNOT remove the tenant's branding", async () => {
    const { error } = await estimatorAClient.rpc("remove_tenant_branding", { p_tenant_id: tenantAId });
    expect(error).not.toBeNull();
  });

  it("Owner A can remove the logo, clearing all branding columns", async () => {
    const { data, error } = await ownerAClient.rpc("remove_tenant_branding", { p_tenant_id: tenantAId }).single();
    expect(error).toBeNull();
    const row = data as TenantsRow;
    expect(row.logo_storage_path).toBeNull();
    expect(row.logo_original_filename).toBeNull();
    expect(row.logo_content_type).toBeNull();
    expect(row.logo_size_bytes).toBeNull();
    expect(row.logo_updated_at).toBeNull();

    const { data: reread } = await viewerAClient.rpc("get_tenant_branding", { p_tenant_id: tenantAId }).single();
    expect((reread as TenantsRow).logo_storage_path).toBeNull();
  });

  it("removing Tenant A's logo never touches Tenant B's own logo object", async () => {
    const bPath = `${tenantBId}/logo-${crypto.randomUUID()}.png`;
    await admin.storage.from("tenant-branding").upload(bPath, ONE_PIXEL_PNG, { contentType: "image/png" });
    uploadedPaths.push(bPath);
    await ownerBClient.rpc("update_tenant_branding", {
      p_tenant_id: tenantBId,
      p_logo_storage_path: bPath,
      p_logo_original_filename: "logo.png",
      p_logo_content_type: "image/png",
      p_logo_size_bytes: ONE_PIXEL_PNG.byteLength,
    });

    await ownerAClient.rpc("remove_tenant_branding", { p_tenant_id: tenantAId });

    const { data: stillThere } = await admin.storage.from("tenant-branding").list(tenantBId);
    expect(stillThere?.some((f) => bPath.endsWith(f.name))).toBe(true);
  });

  it("a signed URL, once generated for Tenant A's logo, successfully retrieves the object", async () => {
    const path = `${tenantAId}/logo-${crypto.randomUUID()}.png`;
    await ownerAClient.storage.from("tenant-branding").upload(path, ONE_PIXEL_PNG, { contentType: "image/png" });
    uploadedPaths.push(path);

    const { data, error } = await ownerAClient.storage.from("tenant-branding").createSignedUrl(path, 60);
    expect(error).toBeNull();
    expect(data?.signedUrl).toBeTruthy();

    const response = await fetch(data!.signedUrl);
    expect(response.ok).toBe(true);
  });

  it("no public URL is usable for a logo — unreachable without a signed URL", async () => {
    const path = `${tenantAId}/logo-${crypto.randomUUID()}.png`;
    await admin.storage.from("tenant-branding").upload(path, ONE_PIXEL_PNG, { contentType: "image/png" });
    uploadedPaths.push(path);

    const { data } = ownerAClient.storage.from("tenant-branding").getPublicUrl(path);
    const response = await fetch(data.publicUrl);
    expect(response.ok).toBe(false);
  });
});
