/**
 * Phase 2A Storage security tests — the private `scopevia-media` bucket.
 * Runs against the same real, dedicated test Supabase project as every
 * other RLS/integration suite; skipped entirely if the env vars are absent.
 *
 * A 1x1 pixel PNG/JPEG/WebP is used as real upload bytes (small, valid,
 * deterministic) rather than a mocked upload — this exercises Supabase
 * Storage's own bucket-level MIME/size enforcement for real, not just our
 * application code's redundant checks.
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
  return `test-p2a-storage-${label}-${RUN_ID}@example.com`;
}

async function signIn(addr: string): Promise<SupabaseClient> {
  const client = createClient(TEST_URL!, TEST_ANON_KEY!);
  const { error } = await client.auth.signInWithPassword({ email: addr, password: PASSWORD });
  if (error) throw error;
  return client;
}

// A real, valid 1x1 transparent PNG (67 bytes).
const ONE_PIXEL_PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
  ),
  (c) => c.charCodeAt(0)
);

type TestUser = { id: string; email: string };

describe.skipIf(!canRun)("Phase 2A Storage security (requires real Postgres + Storage)", () => {
  let admin: SupabaseClient;
  let userA: TestUser, userB: TestUser, viewerUser: TestUser, fieldWorkerUser: TestUser;
  let aClient: SupabaseClient, bClient: SupabaseClient, viewerClient: SupabaseClient, fieldWorkerClient: SupabaseClient;
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

    userA = await createUser("a-owner");
    userB = await createUser("b-owner");
    viewerUser = await createUser("viewer");
    fieldWorkerUser = await createUser("field-worker");

    [aClient, bClient, viewerClient, fieldWorkerClient] = await Promise.all([
      signIn(userA.email),
      signIn(userB.email),
      signIn(viewerUser.email),
      signIn(fieldWorkerUser.email),
    ]);

    const { data: tenantA } = await aClient
      .rpc("create_tenant_with_owner", { p_name: "P2A Storage Tenant A", p_slug: `p2a-storage-a-${RUN_ID}` })
      .single();
    tenantAId = (tenantA as { id: string }).id;

    const { data: tenantB } = await bClient
      .rpc("create_tenant_with_owner", { p_name: "P2A Storage Tenant B", p_slug: `p2a-storage-b-${RUN_ID}` })
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

    await inviteAndAccept(viewerClient, viewerUser.email, "viewer");
    await inviteAndAccept(fieldWorkerClient, fieldWorkerUser.email, "field_worker");
  });

  afterAll(async () => {
    if (uploadedPaths.length > 0) {
      await admin.storage.from("scopevia-media").remove(uploadedPaths).catch(() => {});
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

  it("the bucket is private (public = false)", async () => {
    const { data: buckets } = await admin.storage.listBuckets();
    const bucket = buckets?.find((b) => b.id === "scopevia-media");
    expect(bucket).toBeDefined();
    expect(bucket?.public).toBe(false);
  });

  it("Owner A can upload a valid PNG to their own tenant path", async () => {
    const path = `${tenantAId}/${crypto.randomUUID()}/original.png`;
    const { error } = await aClient.storage.from("scopevia-media").upload(path, ONE_PIXEL_PNG, { contentType: "image/png" });
    expect(error).toBeNull();
    uploadedPaths.push(path);
  });

  it("an oversized declared content-length is rejected by the bucket's file_size_limit", async () => {
    // Build a buffer larger than the 10 MB bucket limit — real bytes, not a
    // spoofed header, so this exercises Storage's own enforcement.
    const oversized = new Uint8Array(10 * 1024 * 1024 + 1);
    const path = `${tenantAId}/${crypto.randomUUID()}/oversized.png`;
    const { error } = await aClient.storage.from("scopevia-media").upload(path, oversized, { contentType: "image/png" });
    expect(error).not.toBeNull();
  });

  it("an unsupported MIME type is rejected by the bucket's allowed_mime_types", async () => {
    const path = `${tenantAId}/${crypto.randomUUID()}/not-an-image.txt`;
    const { error } = await aClient.storage
      .from("scopevia-media")
      .upload(path, new TextEncoder().encode("not an image"), { contentType: "text/plain" });
    expect(error).not.toBeNull();
  });

  it("Tenant A cannot upload to a path under Tenant B's id", async () => {
    const path = `${tenantBId}/${crypto.randomUUID()}/original.png`;
    const { error } = await aClient.storage.from("scopevia-media").upload(path, ONE_PIXEL_PNG, { contentType: "image/png" });
    expect(error).not.toBeNull();
  });

  it("Tenant A cannot download an object under Tenant B's path", async () => {
    const bPath = `${tenantBId}/${crypto.randomUUID()}/original.png`;
    await admin.storage.from("scopevia-media").upload(bPath, ONE_PIXEL_PNG, { contentType: "image/png" });
    uploadedPaths.push(bPath);

    const { error } = await aClient.storage.from("scopevia-media").download(bPath);
    expect(error).not.toBeNull();
  });

  it("Tenant A cannot list Tenant B's folder", async () => {
    const { data, error } = await aClient.storage.from("scopevia-media").list(tenantBId);
    // RLS-filtered listing returns an empty (or errored) result — never
    // Tenant B's real objects.
    if (!error) {
      expect(data ?? []).toHaveLength(0);
    }
  });

  it("no public URL is usable — the object is unreachable without a signed URL", async () => {
    const path = `${tenantAId}/${crypto.randomUUID()}/original.png`;
    await admin.storage.from("scopevia-media").upload(path, ONE_PIXEL_PNG, { contentType: "image/png" });
    uploadedPaths.push(path);

    const { data } = aClient.storage.from("scopevia-media").getPublicUrl(path);
    const response = await fetch(data.publicUrl);
    expect(response.ok).toBe(false);
  });

  it("a signed URL, once generated, successfully retrieves the object", async () => {
    const path = `${tenantAId}/${crypto.randomUUID()}/original.png`;
    await aClient.storage.from("scopevia-media").upload(path, ONE_PIXEL_PNG, { contentType: "image/png" });
    uploadedPaths.push(path);

    const { data, error } = await aClient.storage.from("scopevia-media").createSignedUrl(path, 60);
    expect(error).toBeNull();
    expect(data?.signedUrl).toBeTruthy();

    const response = await fetch(data!.signedUrl);
    expect(response.ok).toBe(true);
  });

  it("Viewer cannot upload media", async () => {
    const path = `${tenantAId}/${crypto.randomUUID()}/viewer-attempt.png`;
    const { error } = await viewerClient.storage.from("scopevia-media").upload(path, ONE_PIXEL_PNG, { contentType: "image/png" });
    expect(error).not.toBeNull();
  });

  it("Field Worker CAN upload media (current-job photos are their explicit permission)", async () => {
    const path = `${tenantAId}/${crypto.randomUUID()}/field-worker-job.png`;
    const { error } = await fieldWorkerClient.storage.from("scopevia-media").upload(path, ONE_PIXEL_PNG, { contentType: "image/png" });
    expect(error).toBeNull();
    uploadedPaths.push(path);
  });

  it("a path manipulated to fake a different tenant id (non-UUID segment) is rejected, not a hard error", async () => {
    const path = `../../etc/passwd/original.png`;
    const { error } = await aClient.storage.from("scopevia-media").upload(path, ONE_PIXEL_PNG, { contentType: "image/png" });
    expect(error).not.toBeNull();
  });

  it("register_media_asset rejects a storage_path that does not start with the caller's own tenant id", async () => {
    const { error } = await aClient.rpc("register_media_asset", {
      p_tenant_id: tenantAId,
      p_storage_path: `${tenantBId}/fake/original.png`,
      p_original_filename: "original.png",
      p_mime_type: "image/png",
      p_size_bytes: 100,
      p_media_type: "current_job",
    });
    expect(error).not.toBeNull();
  });

  it("register_media_asset succeeds for a real, valid upload and the resulting row is tenant-scoped", async () => {
    const mediaId = crypto.randomUUID();
    const path = `${tenantAId}/${mediaId}/original.png`;
    const { error: uploadErr } = await aClient.storage.from("scopevia-media").upload(path, ONE_PIXEL_PNG, { contentType: "image/png" });
    expect(uploadErr).toBeNull();
    uploadedPaths.push(path);

    const { data: asset, error } = await aClient
      .rpc("register_media_asset", {
        p_tenant_id: tenantAId,
        p_storage_path: path,
        p_original_filename: "original.png",
        p_mime_type: "image/png",
        p_size_bytes: ONE_PIXEL_PNG.byteLength,
        p_media_type: "current_job",
      })
      .single();
    expect(error).toBeNull();
    expect((asset as { tenant_id: string }).tenant_id).toBe(tenantAId);

    const { data: fromB } = await bClient.from("media_assets").select("*").eq("id", (asset as { id: string }).id);
    expect(fromB ?? []).toHaveLength(0);
  });
});
