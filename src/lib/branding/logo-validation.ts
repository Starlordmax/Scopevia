/**
 * Pure business-logo file validation and storage-path construction — no
 * "server-only" import, no Supabase/Next.js dependency, so directly
 * unit-testable (see tests/unit/logo-validation.test.ts). Mirrors the
 * scopevia-media bucket's own client-side check in src/lib/storage/media.ts,
 * but with the stricter limits appropriate to a single business-identity
 * asset rather than a photo gallery: 2 MB instead of 10 MB, and SVG
 * deliberately excluded for MVP to avoid script/content-injection risk (see
 * docs/70-logo-storage-security.md) even though Supabase Storage itself
 * would happily store it.
 */
export const ALLOWED_LOGO_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export type AllowedLogoMimeType = (typeof ALLOWED_LOGO_MIME_TYPES)[number];

export const MAX_LOGO_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB

export type LogoValidationResult = { ok: true } | { ok: false; error: string };

export function validateLogoFile(file: { type: string; size: number }): LogoValidationResult {
  if (!ALLOWED_LOGO_MIME_TYPES.includes(file.type as AllowedLogoMimeType)) {
    return { ok: false, error: "Only PNG, JPG, or WEBP images are supported." };
  }
  if (!(file.size > 0)) {
    return { ok: false, error: "Choose a logo file to upload." };
  }
  if (file.size > MAX_LOGO_SIZE_BYTES) {
    return { ok: false, error: "Logo files must be 2 MB or smaller." };
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
