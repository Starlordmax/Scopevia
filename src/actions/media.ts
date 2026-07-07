"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "../lib/supabase/server";
import { requireUser } from "../lib/auth/session";
import { uuidSchema } from "../lib/validation/schemas";
import { uploadMediaFile } from "../lib/storage/media";
import { friendlyRpcErrorMessage } from "../lib/errors/friendly-message";
import type { ActionResult } from "./auth";

export async function uploadCurrentJobPhotoAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireUser();

  const tenantId = uuidSchema.safeParse(formData.get("tenantId"));
  const proposalVersionId = uuidSchema.safeParse(formData.get("proposalVersionId"));
  const proposalId = uuidSchema.safeParse(formData.get("proposalId"));
  if (!tenantId.success || !proposalVersionId.success || !proposalId.success) return { error: "Invalid request" };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose an image to upload" };

  const caption = String(formData.get("caption") ?? "");

  const uploadResult = await uploadMediaFile(tenantId.data, file, "current_job", caption);
  if ("error" in uploadResult) return { error: uploadResult.error };

  const supabase = await createClient();
  const { error } = await supabase.rpc("attach_media_to_proposal", {
    p_proposal_version_id: proposalVersionId.data,
    p_media_asset_id: uploadResult.assetId,
    p_usage_type: "current_job",
    p_caption: caption,
  });
  if (error) return { error: friendlyRpcErrorMessage(error.message) };

  revalidatePath(`/proposals/${proposalId.data}/edit`);
  return {};
}

export async function attachPortfolioMediaToProposalAction(formData: FormData): Promise<void> {
  await requireUser();
  const proposalVersionId = uuidSchema.safeParse(formData.get("proposalVersionId"));
  const proposalId = uuidSchema.safeParse(formData.get("proposalId"));
  const mediaAssetId = uuidSchema.safeParse(formData.get("mediaAssetId"));
  const portfolioProjectId = uuidSchema.safeParse(formData.get("portfolioProjectId"));
  if (!proposalVersionId.success || !proposalId.success || !mediaAssetId.success) return;

  const supabase = await createClient();
  await supabase.rpc("attach_media_to_proposal", {
    p_proposal_version_id: proposalVersionId.data,
    p_media_asset_id: mediaAssetId.data,
    p_usage_type: "previous_work",
    p_portfolio_project_id: portfolioProjectId.success ? portfolioProjectId.data : undefined,
  });

  revalidatePath(`/proposals/${proposalId.data}/edit`);
}

export async function detachProposalMediaAction(formData: FormData): Promise<void> {
  await requireUser();
  const proposalMediaId = uuidSchema.safeParse(formData.get("proposalMediaId"));
  const proposalId = uuidSchema.safeParse(formData.get("proposalId"));
  if (!proposalMediaId.success || !proposalId.success) return;

  const supabase = await createClient();
  await supabase.rpc("detach_media_from_proposal", { p_proposal_media_id: proposalMediaId.data });

  revalidatePath(`/proposals/${proposalId.data}/edit`);
}
