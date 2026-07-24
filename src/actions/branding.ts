"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "../lib/supabase/server";
import { requireUser } from "../lib/auth/session";
import { uuidSchema } from "../lib/validation/schemas";
import { validateLogoFile, buildLogoStoragePath } from "../lib/branding/logo-validation";
import { uploadBusinessLogoFile, deleteBusinessLogoFile } from "../lib/storage/branding";
import { getBusinessLogoStoragePath } from "../lib/branding/data";
import { friendlyRpcErrorMessage } from "../lib/errors/friendly-message";
import type { ActionResult } from "./auth";

/**
 * uploadBusinessLogo(): validates the file, uploads it to a NEW path
 * first, then swaps the tenant's DB pointer to it, and only THEN deletes
 * the previous logo's Storage object (if any) — in that order, so a
 * failure partway through never leaves the tenant with a broken pointer
 * to a deleted file. tenant.update is enforced twice: once implicitly (the
 * `tenant-branding` bucket's own INSERT policy would reject the upload
 * itself for a caller without it) and again, authoritatively, inside
 * update_tenant_branding().
 */
export async function uploadBusinessLogoAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireUser();

  const tenantId = uuidSchema.safeParse(formData.get("tenantId"));
  if (!tenantId.success) return { error: "Invalid request" };

  const file = formData.get("file");
  if (!(file instanceof File)) return { error: "Choose a logo file to upload" };

  const validation = validateLogoFile({ type: file.type, size: file.size });
  if (!validation.ok) return { error: validation.error };

  const previousPath = await getBusinessLogoStoragePath(tenantId.data);

  const path = buildLogoStoragePath(tenantId.data, file.type, crypto.randomUUID());
  const uploadResult = await uploadBusinessLogoFile(path, file);
  if ("error" in uploadResult) return { error: uploadResult.error };

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_tenant_branding", {
    p_tenant_id: tenantId.data,
    p_logo_storage_path: path,
    p_logo_original_filename: file.name.slice(0, 200),
    p_logo_content_type: file.type,
    p_logo_size_bytes: file.size,
  });

  if (error) {
    await deleteBusinessLogoFile(path);
    return { error: friendlyRpcErrorMessage(error.message) };
  }

  if (previousPath && previousPath !== path) {
    await deleteBusinessLogoFile(previousPath);
  }

  revalidatePath("/profile");
  return {};
}

export async function removeBusinessLogoAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireUser();

  const tenantId = uuidSchema.safeParse(formData.get("tenantId"));
  if (!tenantId.success) return { error: "Invalid request" };

  const previousPath = await getBusinessLogoStoragePath(tenantId.data);

  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_tenant_branding", { p_tenant_id: tenantId.data });
  if (error) return { error: friendlyRpcErrorMessage(error.message) };

  if (previousPath) {
    await deleteBusinessLogoFile(previousPath);
  }

  revalidatePath("/profile");
  return {};
}
