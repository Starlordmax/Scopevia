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

const GENERIC_UPLOAD_ERROR = "We couldn't upload the logo right now. Please try again.";
const GENERIC_REMOVE_ERROR = "We couldn't remove the logo right now. Please try again.";
const PERMISSION_ERROR = "You don't have permission to update business branding.";

/**
 * uploadBusinessLogo(): validates the file, uploads it to a NEW path
 * first, then swaps the tenant's DB pointer to it, and only THEN deletes
 * the previous logo's Storage object (if any) — in that order, so a
 * failure partway through never leaves the tenant with a broken pointer
 * to a deleted file. tenant.update is enforced twice: once implicitly (the
 * `tenant-branding` bucket's own INSERT policy would reject the upload
 * itself for a caller without it) and again, authoritatively, inside
 * update_tenant_branding().
 *
 * Everything after the cheap, synchronous validation above is wrapped in
 * try/catch: any unexpected exception from Storage, the database, or the
 * network must degrade to a friendly error message, never propagate
 * uncaught to Next.js's own error boundary (which is what previously
 * turned an upload failure into a page-wide "This page couldn't load" —
 * see docs/71-logo-upload-crash-fix.md). requireUser() is deliberately
 * called OUTSIDE this try/catch: it signals an unauthenticated visitor via
 * Next.js's own redirect(), which throws a special, framework-recognized
 * value that must never be caught and swallowed here.
 */
export async function uploadBusinessLogoAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireUser();

  const tenantId = uuidSchema.safeParse(formData.get("tenantId"));
  if (!tenantId.success) return { error: "Invalid request" };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a logo file to upload" };

  const validation = validateLogoFile({ type: file.type, size: file.size });
  if (!validation.ok) return { error: validation.error };

  try {
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
      if (error.code === "42501") return { error: PERMISSION_ERROR };
      return { error: friendlyRpcErrorMessage(error.message) };
    }

    if (previousPath && previousPath !== path) {
      await deleteBusinessLogoFile(previousPath);
    }

    revalidatePath("/profile");
    return { message: "Logo uploaded successfully." };
  } catch (error) {
    console.error("Business logo upload failed:", error);
    return { error: GENERIC_UPLOAD_ERROR };
  }
}

export async function removeBusinessLogoAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireUser();

  const tenantId = uuidSchema.safeParse(formData.get("tenantId"));
  if (!tenantId.success) return { error: "Invalid request" };

  try {
    const previousPath = await getBusinessLogoStoragePath(tenantId.data);

    const supabase = await createClient();
    const { error } = await supabase.rpc("remove_tenant_branding", { p_tenant_id: tenantId.data });
    if (error) {
      if (error.code === "42501") return { error: PERMISSION_ERROR };
      return { error: friendlyRpcErrorMessage(error.message) };
    }

    if (previousPath) {
      await deleteBusinessLogoFile(previousPath);
    }

    revalidatePath("/profile");
    return { message: "Logo removed." };
  } catch (error) {
    console.error("Business logo removal failed:", error);
    return { error: GENERIC_REMOVE_ERROR };
  }
}
