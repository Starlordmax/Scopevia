import "server-only";

import { createClient } from "../supabase/server";
import { friendlyRpcErrorMessage } from "../errors/friendly-message";

export const ALLOWED_MEDIA_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const MAX_MEDIA_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB, mirrors the bucket's own limit

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export type UploadMediaResult = { assetId: string } | { error: string };

/**
 * Uploads a file to the private scopevia-media bucket at
 * `<tenant_id>/<media_id>/original.<ext>` using the CALLER'S OWN session
 * (never service_role) — the Storage policies (media.upload permission,
 * tenant-scoped path) are the real gate, this is just the client half of
 * that contract. After a successful upload, registers the row via
 * register_media_asset(), which independently re-validates MIME/size — see
 * docs/33-media-and-storage-security.md.
 */
export async function uploadMediaFile(
  tenantId: string,
  file: File,
  mediaType: "current_job" | "portfolio" | "general",
  caption = ""
): Promise<UploadMediaResult> {
  if (!ALLOWED_MEDIA_MIME_TYPES.includes(file.type as (typeof ALLOWED_MEDIA_MIME_TYPES)[number])) {
    return { error: "Only JPEG, PNG, or WebP images are supported." };
  }
  if (file.size <= 0 || file.size > MAX_MEDIA_SIZE_BYTES) {
    return { error: "Images must be 10 MB or smaller." };
  }

  const supabase = await createClient();
  const mediaId = crypto.randomUUID();
  const extension = EXTENSION_BY_MIME[file.type] ?? "jpg";
  const path = `${tenantId}/${mediaId}/original.${extension}`;

  const arrayBuffer = await file.arrayBuffer();
  const { error: uploadError } = await supabase.storage
    .from("scopevia-media")
    .upload(path, arrayBuffer, { contentType: file.type, upsert: false });

  if (uploadError) {
    return { error: "Could not upload the image. Please try again." };
  }

  const { data: asset, error: registerError } = await supabase
    .rpc("register_media_asset", {
      p_tenant_id: tenantId,
      p_storage_path: path,
      p_original_filename: file.name.slice(0, 200),
      p_mime_type: file.type,
      p_size_bytes: file.size,
      p_media_type: mediaType,
      p_caption: caption,
    })
    .single();

  if (registerError) {
    // Best-effort cleanup — an orphaned Storage object with no metadata row
    // is harmless (never served without a media_assets row + permission
    // check) but no reason to leave it if we can clean up now.
    await supabase.storage.from("scopevia-media").remove([path]).catch(() => {});
    return { error: friendlyRpcErrorMessage(registerError.message) };
  }

  return { assetId: (asset as { id: string }).id };
}

/** Short-lived signed URL for displaying a private media asset. Never a public URL. */
export async function getSignedMediaUrl(storagePath: string, expiresInSeconds = 300): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.storage.from("scopevia-media").createSignedUrl(storagePath, expiresInSeconds);
  if (error || !data) return null;
  return data.signedUrl;
}

/** Batch version — one round trip for a list of paths (e.g. a whole gallery). */
export async function getSignedMediaUrls(storagePaths: string[], expiresInSeconds = 300): Promise<Record<string, string>> {
  if (storagePaths.length === 0) return {};
  const supabase = await createClient();
  const { data, error } = await supabase.storage.from("scopevia-media").createSignedUrls(storagePaths, expiresInSeconds);
  if (error || !data) return {};
  const result: Record<string, string> = {};
  for (const entry of data) {
    if (entry.signedUrl && entry.path) result[entry.path] = entry.signedUrl;
  }
  return result;
}
