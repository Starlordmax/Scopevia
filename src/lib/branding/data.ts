import "server-only";

import { createClient } from "../supabase/server";
import { getSignedBrandingUrl } from "../storage/branding";

export type BusinessBranding = {
  hasLogo: boolean;
  logoUrl: string | null;
  originalFilename: string | null;
  updatedAt: string | null;
};

/**
 * getBusinessBranding(): the tenant's branding, safe for direct display.
 * Never returns the raw storage_path — only a short-lived signed URL (or
 * null if there's no logo, or the signed-URL request itself failed, in
 * which case callers fall back to business-name text exactly as if there
 * were no logo at all).
 */
export async function getBusinessBranding(tenantId: string): Promise<BusinessBranding> {
  const storagePath = await getBusinessLogoStoragePath(tenantId);
  if (!storagePath) {
    return { hasLogo: false, logoUrl: null, originalFilename: null, updatedAt: null };
  }

  const supabase = await createClient();
  const { data } = await supabase.rpc("get_tenant_branding", { p_tenant_id: tenantId }).single();
  const row = data as { logo_original_filename: string | null; logo_updated_at: string | null } | null;

  const logoUrl = await getSignedBrandingUrl(storagePath);
  if (!logoUrl) {
    return { hasLogo: false, logoUrl: null, originalFilename: null, updatedAt: null };
  }

  return {
    hasLogo: true,
    logoUrl,
    originalFilename: row?.logo_original_filename ?? null,
    updatedAt: row?.logo_updated_at ?? null,
  };
}

/**
 * Internal-only: the raw storage path, never exposed to a client component
 * or the browser. Used by Server Actions (src/actions/branding.ts) that
 * need to know the PREVIOUS logo's path so they can delete that Storage
 * object once a replace/remove succeeds.
 */
export async function getBusinessLogoStoragePath(tenantId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_tenant_branding", { p_tenant_id: tenantId }).single();
  if (error || !data) return null;
  return (data as { logo_storage_path: string | null }).logo_storage_path;
}
