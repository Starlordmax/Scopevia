"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "../lib/supabase/server";
import { requireUser } from "../lib/auth/session";
import { uuidSchema } from "../lib/validation/schemas";
import { createPortfolioProjectSchema } from "../lib/validation/proposals";
import { uploadMediaFile } from "../lib/storage/media";
import { friendlyRpcErrorMessage } from "../lib/errors/friendly-message";
import type { ActionResult } from "./auth";
import type { Database } from "../../types/database";

type PortfolioProject = Database["public"]["Tables"]["portfolio_projects"]["Row"];

export async function createPortfolioProjectAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireUser();

  const tenantId = uuidSchema.safeParse(formData.get("tenantId"));
  if (!tenantId.success) return { error: "Invalid request" };

  const parsed = createPortfolioProjectSchema.safeParse({
    title: formData.get("title"),
    serviceType: formData.get("serviceType"),
    description: formData.get("description") || undefined,
    locationLabel: formData.get("locationLabel") || undefined,
    completedAt: formData.get("completedAt") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("create_portfolio_project", {
      p_tenant_id: tenantId.data,
      p_title: parsed.data.title,
      p_service_type: parsed.data.serviceType,
      p_description: parsed.data.description ?? "",
      p_location_label: parsed.data.locationLabel ?? "",
      p_completed_at: parsed.data.completedAt,
    })
    .single();
  if (error) return { error: friendlyRpcErrorMessage(error.message) };

  const project = data as PortfolioProject;
  redirect(`/portfolio/${project.id}`);
}

export async function updatePortfolioProjectAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireUser();

  const portfolioProjectId = uuidSchema.safeParse(formData.get("portfolioProjectId"));
  if (!portfolioProjectId.success) return { error: "Invalid request" };

  const parsed = createPortfolioProjectSchema.safeParse({
    title: formData.get("title"),
    serviceType: formData.get("serviceType"),
    description: formData.get("description") || undefined,
    locationLabel: formData.get("locationLabel") || undefined,
    completedAt: formData.get("completedAt") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_portfolio_project", {
    p_portfolio_project_id: portfolioProjectId.data,
    p_title: parsed.data.title,
    p_service_type: parsed.data.serviceType,
    p_description: parsed.data.description ?? "",
    p_location_label: parsed.data.locationLabel ?? "",
    // p_completed_at has no SQL DEFAULT, so its generated type is
    // non-optional even though NULL ("no completion date yet") is a valid
    // value — same generator limitation as src/lib/audit/log.ts.
    p_completed_at: parsed.data.completedAt as string,
  });
  if (error) return { error: friendlyRpcErrorMessage(error.message) };

  revalidatePath(`/portfolio/${portfolioProjectId.data}`);
  redirect(`/portfolio/${portfolioProjectId.data}`);
}

export async function archivePortfolioProjectAction(formData: FormData): Promise<void> {
  await requireUser();
  const portfolioProjectId = uuidSchema.safeParse(formData.get("portfolioProjectId"));
  if (!portfolioProjectId.success) redirect("/portfolio");

  const supabase = await createClient();
  await supabase.rpc("archive_portfolio_project", { p_portfolio_project_id: portfolioProjectId.data });

  revalidatePath(`/portfolio/${portfolioProjectId.data}`);
  revalidatePath("/portfolio");
  redirect(`/portfolio/${portfolioProjectId.data}`);
}

export async function restorePortfolioProjectAction(formData: FormData): Promise<void> {
  await requireUser();
  const portfolioProjectId = uuidSchema.safeParse(formData.get("portfolioProjectId"));
  if (!portfolioProjectId.success) redirect("/portfolio");

  const supabase = await createClient();
  await supabase.rpc("restore_portfolio_project", { p_portfolio_project_id: portfolioProjectId.data });

  revalidatePath(`/portfolio/${portfolioProjectId.data}`);
  revalidatePath("/portfolio");
  redirect(`/portfolio/${portfolioProjectId.data}`);
}

export async function uploadPortfolioPhotoAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireUser();

  const tenantId = uuidSchema.safeParse(formData.get("tenantId"));
  const portfolioProjectId = uuidSchema.safeParse(formData.get("portfolioProjectId"));
  if (!tenantId.success || !portfolioProjectId.success) return { error: "Invalid request" };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose an image to upload" };

  const caption = String(formData.get("caption") ?? "");

  const uploadResult = await uploadMediaFile(tenantId.data, file, "portfolio", caption);
  if ("error" in uploadResult) return { error: uploadResult.error };

  const supabase = await createClient();
  const { error } = await supabase.rpc("add_portfolio_project_media", {
    p_portfolio_project_id: portfolioProjectId.data,
    p_media_asset_id: uploadResult.assetId,
    p_caption: caption,
  });
  if (error) return { error: friendlyRpcErrorMessage(error.message) };

  revalidatePath(`/portfolio/${portfolioProjectId.data}`);
  return {};
}
