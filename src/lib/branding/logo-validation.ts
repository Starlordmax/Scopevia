/**
 * Pure business-logo file validation and storage-path construction — no
 * "server-only" import, no Supabase/Next.js dependency, so directly
 * unit-testable (see tests/unit/logo-validation.test.ts). Mirrors the
 * scopevia-media bucket's own client-side check in src/lib/storage/media.ts:
 * same 10 MB limit, same three image types. SVG deliberately excluded to
 * avoid script/content-injection risk (see docs/70-logo-storage-security.md)
 * even though Supabase Storage itself would happily store it.
 */
export const ALLOWED_LOGO_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export type AllowedLogoMimeType = (typeof ALLOWED_LOGO_MIME_TYPES)[number];

export const MAX_LOGO_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

export type LogoValidationResult = { ok: true } | { ok: false; error: string };

export function validateLogoFile(file: { type: string; size: number }): LogoValidationResult {
  if (!ALLOWED_LOGO_MIME_TYPES.includes(file.type as AllowedLogoMimeType)) {
    return { ok: false, error: "Only PNG, JPG, or WEBP images are supported." };
  }
  if (!(file.size > 0)) {
    return { ok: false, error: "Choose a logo file to upload." };
  }
  if (file.size > MAX_LOGO_SIZE_BYTES) {
    return { ok: false, error: "Please upload a PNG, JPG, or WEBP image under 10 MB." };
  }
  return { ok: true };
}

const EXTENSION_BY_LOGO_MIME: Record<AllowedLogoMimeType, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

export function extensionForLogoMimeType(mimeType: string): string {
  return EXTENSION_BY_LOGO_MIME[mimeType as AllowedLogoMimeType] ?? "png";
}

/**
 * Tenant-safe by construction: the path always starts with `<tenantId>/`,
 * matching the tenant-branding bucket's storage.foldername()-derived RLS
 * policies exactly — a path built here can never accidentally resolve
 * under a different tenant's folder.
 */
export function buildLogoStoragePath(tenantId: string, mimeType: string, uniqueId: string): string {
  return `${tenantId}/logo-${uniqueId}.${extensionForLogoMimeType(mimeType)}`;
}
