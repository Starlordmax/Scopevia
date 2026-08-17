"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "../lib/supabase/server";
import { requireUser } from "../lib/auth/session";
import { requirePermission } from "../lib/auth/permissions";
import { PERMISSIONS } from "../lib/auth/permission-keys";
import { uuidSchema } from "../lib/validation/schemas";
import {
  createOpportunitySchema,
  updateOpportunitySchema,
  changeOpportunityStatusSchema,
  convertOpportunitySchema,
} from "../lib/validation/crm";
import { friendlyRpcErrorMessage } from "../lib/errors/friendly-message";
import { zodIssuesToFieldErrors } from "../lib/validation/field-errors";
import type { ActionResult } from "./auth";
import type { Database } from "../../types/database";

type Opportunity = Database["public"]["Tables"]["opportunities"]["Row"];
type Project = Database["public"]["Tables"]["projects"]["Row"];

export async function createOpportunityAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireUser();

  const tenantId = uuidSchema.safeParse(formData.get("tenantId"));
  if (!tenantId.success) return { error: "Invalid request" };

  const parsed = createOpportunitySchema.safeParse({
    clientId: formData.get("clientId"),
    title: formData.get("title"),
    source: formData.get("source") || undefined,
    estimatedValueCents: formData.get("estimatedValue") || undefined,
    probability: formData.get("probability") || undefined,
    expectedCloseDate: formData.get("expectedCloseDate") || undefined,
    assignedTo: formData.get("assignedTo") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input", fieldErrors: zodIssuesToFieldErrors(parsed.error) };
  }

  try {
    await requirePermission(tenantId.data, PERMISSIONS.OPPORTUNITIES_CREATE);
  } catch {
    return { error: "You do not have permission to do that" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("create_opportunity", {
      p_tenant_id: tenantId.data,
      p_client_id: parsed.data.clientId,
      p_title: parsed.data.title,
      p_source: parsed.data.source,
      p_estimated_value_cents: parsed.data.estimatedValueCents,
      p_probability: parsed.data.probability,
      p_expected_close_date: parsed.data.expectedCloseDate,
      p_assigned_to: parsed.data.assignedTo,
    })
    .single();

  if (error) return { error: friendlyRpcErrorMessage(error.message) };

  const opportunity = data as Opportunity;
  redirect(`/opportunities/${opportunity.id}`);
}

export async function updateOpportunityAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireUser();

  const opportunityId = uuidSchema.safeParse(formData.get("opportunityId"));
  if (!opportunityId.success) return { error: "Invalid request" };

  const parsed = updateOpportunitySchema.safeParse({
    title: formData.get("title"),
    source: formData.get("source") || undefined,
    estimatedValueCents: formData.get("estimatedValue") || undefined,
    probability: formData.get("probability") || undefined,
    expectedCloseDate: formData.get("expectedCloseDate") || undefined,
    assignedTo: formData.get("assignedTo") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input", fieldErrors: zodIssuesToFieldErrors(parsed.error) };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_opportunity", {
    p_opportunity_id: opportunityId.data,
    p_title: parsed.data.title,
    p_source: parsed.data.source,
    p_estimated_value_cents: parsed.data.estimatedValueCents,
    p_probability: parsed.data.probability,
    p_expected_close_date: parsed.data.expectedCloseDate,
    p_assigned_to: parsed.data.assignedTo,
  });

  if (error) return { error: friendlyRpcErrorMessage(error.message) };

  revalidatePath(`/opportunities/${opportunityId.data}`);
  redirect(`/opportunities/${opportunityId.data}`);
}

export async function changeOpportunityStatusAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireUser();

  const opportunityId = uuidSchema.safeParse(formData.get("opportunityId"));
  if (!opportunityId.success) return { error: "Invalid request" };

  const parsed = changeOpportunityStatusSchema.safeParse({
    newStatus: formData.get("newStatus"),
    lostReason: formData.get("lostReason") || undefined,
    inspectionScheduledAt: formData.get("inspectionScheduledAt") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input", fieldErrors: zodIssuesToFieldErrors(parsed.error) };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("change_opportunity_status", {
    p_opportunity_id: opportunityId.data,
    p_new_status: parsed.data.newStatus,
    p_lost_reason: parsed.data.lostReason,
    p_inspection_scheduled_at: parsed.data.inspectionScheduledAt,
  });

  if (error) return { error: friendlyRpcErrorMessage(error.message) };

  revalidatePath(`/opportunities/${opportunityId.data}`);
  revalidatePath("/pipeline");
  return {};
}

export async function archiveOpportunityAction(formData: FormData): Promise<void> {
  await requireUser();
  const opportunityId = uuidSchema.safeParse(formData.get("opportunityId"));
  if (!opportunityId.success) redirect("/opportunities");

  const supabase = await createClient();
  await supabase.rpc("archive_opportunity", { p_opportunity_id: opportunityId.data });

  revalidatePath(`/opportunities/${opportunityId.data}`);
  revalidatePath("/opportunities");
  redirect(`/opportunities/${opportunityId.data}`);
}

export async function restoreOpportunityAction(formData: FormData): Promise<void> {
  await requireUser();
  const opportunityId = uuidSchema.safeParse(formData.get("opportunityId"));
  if (!opportunityId.success) redirect("/opportunities");

  const supabase = await createClient();
  await supabase.rpc("restore_opportunity", { p_opportunity_id: opportunityId.data });

  revalidatePath(`/opportunities/${opportunityId.data}`);
  revalidatePath("/opportunities");
  redirect(`/opportunities/${opportunityId.data}`);
}

export async function convertOpportunityAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireUser();

  const opportunityId = uuidSchema.safeParse(formData.get("opportunityId"));
  if (!opportunityId.success) return { error: "Invalid request" };

  const parsed = convertOpportunitySchema.safeParse({
    projectName: formData.get("projectName") || undefined,
    serviceType: formData.get("serviceType") || undefined,
    description: formData.get("description") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("convert_opportunity_to_project", {
      p_opportunity_id: opportunityId.data,
      p_project_name: parsed.data.projectName,
      p_service_type: parsed.data.serviceType,
      p_description: parsed.data.description,
    })
    .single();

  if (error) return { error: friendlyRpcErrorMessage(error.message) };

  const project = data as Project;
  redirect(`/projects/${project.id}`);
}
