"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "../lib/supabase/server";
import { requireUser } from "../lib/auth/session";
import { uuidSchema } from "../lib/validation/schemas";
import { deleteBusinessLogoFile } from "../lib/storage/branding";
import { getBusinessLogoStoragePath } from "../lib/branding/data";
import { friendlyRpcErrorMessage } from "../lib/errors/friendly-message";
import type { ActionResult } from "./auth";

const GENERIC_REMOVE_ERROR = "We couldn't remove the logo right now. Please try again.";
const PERMISSION_ERROR = "You don't have permission to update business branding.";

/**
 * Upload lives at POST /api/business-branding/logo (a Route Handler, not a
 * Server Action) — see docs/71-logo-upload-crash-fix.md for why. Remove
 * has no file body, so it isn't subject to that same class of bug and
 * stays a Server Action, matching every other simple mutation in the app.
 */
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
