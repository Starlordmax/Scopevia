"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "../lib/supabase/server";
import { requireUser } from "../lib/auth/session";
import { requirePermission } from "../lib/auth/permissions";
import { PERMISSIONS } from "../lib/auth/permission-keys";
import { uuidSchema } from "../lib/validation/schemas";
import {
  createProjectSchema,
  updateProjectSchema,
  changeProjectStatusSchema,
  createProjectAddressSchema,
  updateProjectAddressSchema,
} from "../lib/validation/crm";
import type { ActionResult } from "./auth";
import type { Database } from "../../types/database";

type Project = Database["public"]["Tables"]["projects"]["Row"];

export async function createProjectAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireUser();

  const tenantId = uuidSchema.safeParse(formData.get("tenantId"));
  if (!tenantId.success) return { error: "Invalid request" };

  const parsed = createProjectSchema.safeParse({
    clientId: formData.get("clientId"),
    name: formData.get("name"),
    serviceType: formData.get("serviceType") || undefined,
    description: formData.get("description") || undefined,
    assignedTo: formData.get("assignedTo") || undefined,
    tentativeStartDate: formData.get("tentativeStartDate") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  try {
    await requirePermission(tenantId.data, PERMISSIONS.PROJECTS_CREATE);
  } catch {
    return { error: "You do not have permission to do that" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("create_project", {
      p_tenant_id: tenantId.data,
      p_client_id: parsed.data.clientId,
      p_name: parsed.data.name,
      p_service_type: parsed.data.serviceType,
      p_description: parsed.data.description,
      p_assigned_to: parsed.data.assignedTo,
      p_tentative_start_date: parsed.data.tentativeStartDate,
    })
    .single();

  if (error) return { error: error.message };

  const project = data as Project;
  redirect(`/projects/${project.id}`);
}

export async function updateProjectAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireUser();

  const projectId = uuidSchema.safeParse(formData.get("projectId"));
  if (!projectId.success) return { error: "Invalid request" };

  const parsed = updateProjectSchema.safeParse({
    name: formData.get("name"),
    serviceType: formData.get("serviceType") || undefined,
    description: formData.get("description") || undefined,
    assignedTo: formData.get("assignedTo") || undefined,
    tentativeStartDate: formData.get("tentativeStartDate") || undefined,
    primaryContactId: formData.get("primaryContactId") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_project", {
    p_project_id: projectId.data,
    p_name: parsed.data.name,
    p_service_type: parsed.data.serviceType,
    p_description: parsed.data.description,
    p_assigned_to: parsed.data.assignedTo,
    p_tentative_start_date: parsed.data.tentativeStartDate,
    p_primary_contact_id: parsed.data.primaryContactId,
  });

  if (error) return { error: error.message };

  revalidatePath(`/projects/${projectId.data}`);
  redirect(`/projects/${projectId.data}`);
}

export async function changeProjectStatusAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireUser();

  const projectId = uuidSchema.safeParse(formData.get("projectId"));
  if (!projectId.success) return { error: "Invalid request" };

  const parsed = changeProjectStatusSchema.safeParse({
    newStatus: formData.get("newStatus"),
    inspectionScheduledAt: formData.get("inspectionScheduledAt") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("change_project_status", {
    p_project_id: projectId.data,
    p_new_status: parsed.data.newStatus,
    p_inspection_scheduled_at: parsed.data.inspectionScheduledAt,
  });

  if (error) return { error: error.message };

  revalidatePath(`/projects/${projectId.data}`);
  return {};
}

export async function archiveProjectAction(formData: FormData): Promise<void> {
  await requireUser();
  const projectId = uuidSchema.safeParse(formData.get("projectId"));
  if (!projectId.success) redirect("/projects");

  const supabase = await createClient();
  await supabase.rpc("archive_project", { p_project_id: projectId.data });

  revalidatePath(`/projects/${projectId.data}`);
  revalidatePath("/projects");
  redirect(`/projects/${projectId.data}`);
}

export async function restoreProjectAction(formData: FormData): Promise<void> {
  await requireUser();
  const projectId = uuidSchema.safeParse(formData.get("projectId"));
  if (!projectId.success) redirect("/projects");

  const supabase = await createClient();
  await supabase.rpc("restore_project", { p_project_id: projectId.data });

  revalidatePath(`/projects/${projectId.data}`);
  revalidatePath("/projects");
  redirect(`/projects/${projectId.data}`);
}

// =============================================================================
// Project addresses
// =============================================================================

export async function createProjectAddressAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireUser();

  const parsed = createProjectAddressSchema.safeParse({
    projectId: formData.get("projectId"),
    addressLine1: formData.get("addressLine1"),
    addressLine2: formData.get("addressLine2") || undefined,
    city: formData.get("city"),
    state: formData.get("state"),
    postalCode: formData.get("postalCode"),
    countryCode: formData.get("countryCode") || "US",
    accessInstructions: formData.get("accessInstructions") || undefined,
    isPrimary: formData.get("isPrimary") === "on",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("create_project_address", {
    p_project_id: parsed.data.projectId,
    p_address_line_1: parsed.data.addressLine1,
    p_city: parsed.data.city,
    p_state: parsed.data.state,
    p_postal_code: parsed.data.postalCode,
    p_address_line_2: parsed.data.addressLine2,
    p_country_code: parsed.data.countryCode,
    p_access_instructions: parsed.data.accessInstructions,
    p_is_primary: parsed.data.isPrimary,
  });

  if (error) return { error: error.message };

  revalidatePath(`/projects/${parsed.data.projectId}`);
  return {};
}

export async function updateProjectAddressAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireUser();

  const addressId = uuidSchema.safeParse(formData.get("addressId"));
  const projectId = uuidSchema.safeParse(formData.get("projectId"));
  if (!addressId.success || !projectId.success) return { error: "Invalid request" };

  const parsed = updateProjectAddressSchema.safeParse({
    addressLine1: formData.get("addressLine1"),
    addressLine2: formData.get("addressLine2") || undefined,
    city: formData.get("city"),
    state: formData.get("state"),
    postalCode: formData.get("postalCode"),
    countryCode: formData.get("countryCode") || "US",
    accessInstructions: formData.get("accessInstructions") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_project_address", {
    p_address_id: addressId.data,
    p_address_line_1: parsed.data.addressLine1,
    p_city: parsed.data.city,
    p_state: parsed.data.state,
    p_postal_code: parsed.data.postalCode,
    p_address_line_2: parsed.data.addressLine2,
    p_country_code: parsed.data.countryCode,
    p_access_instructions: parsed.data.accessInstructions,
  });

  if (error) return { error: error.message };

  revalidatePath(`/projects/${projectId.data}`);
  return {};
}

export async function setPrimaryProjectAddressAction(formData: FormData): Promise<void> {
  await requireUser();
  const addressId = uuidSchema.safeParse(formData.get("addressId"));
  const projectId = uuidSchema.safeParse(formData.get("projectId"));
  if (!addressId.success || !projectId.success) redirect("/projects");

  const supabase = await createClient();
  await supabase.rpc("set_primary_project_address", { p_address_id: addressId.data });

  revalidatePath(`/projects/${projectId.data}`);
  redirect(`/projects/${projectId.data}`);
}

export async function archiveProjectAddressAction(formData: FormData): Promise<void> {
  await requireUser();
  const addressId = uuidSchema.safeParse(formData.get("addressId"));
  const projectId = uuidSchema.safeParse(formData.get("projectId"));
  if (!addressId.success || !projectId.success) redirect("/projects");

  const supabase = await createClient();
  await supabase.rpc("archive_project_address", { p_address_id: addressId.data });

  revalidatePath(`/projects/${projectId.data}`);
  redirect(`/projects/${projectId.data}`);
}
