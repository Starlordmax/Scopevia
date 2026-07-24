import "server-only";

import { createClient } from "../supabase/server";
import { createAdminClient } from "../supabase/admin";

const BRANDING_BUCKET = "tenant-branding";

/**
 * Uploads a file to the private tenant-branding bucket using the CALLER'S
 * OWN session (never service_role) — the Storage policies (tenant.update
 * permission, tenant-scoped path) are the real gate, this is just the
 * client half of that contract, mirroring uploadMediaFile() in
 * src/lib/storage/media.ts. Caller is responsible for validating the file
 * (see src/lib/branding/logo-validation.ts) and building `path` before
 * calling this.
 */
export async function uploadBusinessLogoFile(path: string, file: File): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient();
  const arrayBuffer = await file.arrayBuffer();
  const { error } = await supabase.storage.from(BRANDING_BUCKET).upload(path, arrayBuffer, { contentType: file.type, upsert: false });
  if (error) {
    return { error: "Could not upload the logo. Please try again." };
  }
  return { ok: true };
}

/** Best-effort delete — never blocks the caller's own success/failure path. */
export async function deleteBusinessLogoFile(path: string): Promise<void> {
  const supabase = await createClient();
  await supabase.storage.from(BRANDING_BUCKET).remove([path]).catch(() => {});
}

/** Short-lived signed URL for displaying a private logo. Never a public URL. */
export async function getSignedBrandingUrl(storagePath: string, expiresInSeconds = 300): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.storage.from(BRANDING_BUCKET).createSignedUrl(storagePath, expiresInSeconds);
  if (error || !data) return null;
  return data.signedUrl;
}

/**
 * Portal-only variant: uses the service-role admin client because a client
 * portal visitor has no Supabase Auth session at all, so the ordinary
 * `tenant_branding_select` policy (`to authenticated`, gated on
 * tenant.view) can never be satisfied. Safe here for the same reason
 * getSignedMediaUrlsForPortal() is safe (see src/lib/storage/media.ts) —
 * the only caller (src/lib/portal/data.ts) only ever passes a storage path
 * already scoped to a tenant that portal_get_session_context() has just
 * authoritatively validated for this exact proposal/token, never a path
 * chosen by the visitor.
 */
export async function getSignedBrandingUrlForPortal(storagePath: string, expiresInSeconds = 300): Promise<string | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.storage.from(BRANDING_BUCKET).createSignedUrl(storagePath, expiresInSeconds);
  if (error || !data) return null;
  return data.signedUrl;
}
