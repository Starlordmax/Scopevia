"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "../lib/supabase/server";
import { requireUser } from "../lib/auth/session";
import { requirePermission } from "../lib/auth/permissions";
import { PERMISSIONS } from "../lib/auth/permission-keys";
import { uuidSchema } from "../lib/validation/schemas";
import { createClientSchema, createClientContactSchema, updateClientContactSchema } from "../lib/validation/crm";
import type { ActionResult } from "./auth";
import type { Database } from "../../types/database";

type Client = Database["public"]["Tables"]["clients"]["Row"];
type ClientContact = Database["public"]["Tables"]["client_contacts"]["Row"];

function readClientForm(formData: FormData) {
  return createClientSchema.safeParse({
    clientType: formData.get("clientType"),
    displayName: formData.get("displayName"),
    legalName: formData.get("legalName") || undefined,
    firstName: formData.get("firstName") || undefined,
    lastName: formData.get("lastName") || undefined,
    email: formData.get("email") || undefined,
    phone: formData.get("phone") || undefined,
    secondaryPhone: formData.get("secondaryPhone") || undefined,
    website: formData.get("website") || undefined,
    taxExempt: formData.get("taxExempt") === "on",
    preferredContactMethod: formData.get("preferredContactMethod") || undefined,
    source: formData.get("source") || undefined,
  });
}

export async function createClientAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireUser();

  const tenantId = uuidSchema.safeParse(formData.get("tenantId"));
  if (!tenantId.success) return { error: "Invalid request" };

  const parsed = readClientForm(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  try {
    await requirePermission(tenantId.data, PERMISSIONS.CLIENTS_CREATE);
  } catch {
    return { error: "You do not have permission to do that" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("create_client", {
      p_tenant_id: tenantId.data,
      p_client_type: parsed.data.clientType,
      p_display_name: parsed.data.displayName,
      p_legal_name: parsed.data.legalName,
      p_first_name: parsed.data.firstName,
      p_last_name: parsed.data.lastName,
      p_email: parsed.data.email,
      p_phone: parsed.data.phone,
      p_secondary_phone: parsed.data.secondaryPhone,
      p_website: parsed.data.website,
      p_tax_exempt: parsed.data.taxExempt,
      p_preferred_contact_method: parsed.data.preferredContactMethod,
      p_source: parsed.data.source,
    })
    .single();

  if (error) return { error: error.message };

  const client = data as Client;
  redirect(`/clients/${client.id}`);
}

export async function updateClientAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireUser();

  const clientId = uuidSchema.safeParse(formData.get("clientId"));
  if (!clientId.success) return { error: "Invalid request" };

  const parsed = readClientForm(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_client", {
    p_client_id: clientId.data,
    p_client_type: parsed.data.clientType,
    p_display_name: parsed.data.displayName,
    p_legal_name: parsed.data.legalName ?? undefined,
    p_first_name: parsed.data.firstName ?? undefined,
    p_last_name: parsed.data.lastName ?? undefined,
    p_email: parsed.data.email ?? undefined,
    p_phone: parsed.data.phone ?? undefined,
    p_secondary_phone: parsed.data.secondaryPhone ?? undefined,
    p_website: parsed.data.website ?? undefined,
    p_tax_exempt: parsed.data.taxExempt,
    p_preferred_contact_method: parsed.data.preferredContactMethod ?? undefined,
    p_source: parsed.data.source ?? undefined,
  });

  if (error) return { error: error.message };

  revalidatePath(`/clients/${clientId.data}`);
  redirect(`/clients/${clientId.data}`);
}

export async function archiveClientAction(formData: FormData): Promise<void> {
  await requireUser();
  const clientId = uuidSchema.safeParse(formData.get("clientId"));
  if (!clientId.success) redirect("/clients");

  const supabase = await createClient();
  await supabase.rpc("archive_client", { p_client_id: clientId.data });

  revalidatePath(`/clients/${clientId.data}`);
  revalidatePath("/clients");
  redirect(`/clients/${clientId.data}`);
}

export async function restoreClientAction(formData: FormData): Promise<void> {
  await requireUser();
  const clientId = uuidSchema.safeParse(formData.get("clientId"));
  if (!clientId.success) redirect("/clients");

  const supabase = await createClient();
  await supabase.rpc("restore_client", { p_client_id: clientId.data });

  revalidatePath(`/clients/${clientId.data}`);
  revalidatePath("/clients");
  redirect(`/clients/${clientId.data}`);
}

// =============================================================================
// Client contacts
// =============================================================================

export async function createClientContactAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireUser();

  const parsed = createClientContactSchema.safeParse({
    clientId: formData.get("clientId"),
    firstName: formData.get("firstName"),
    lastName: formData.get("lastName") || undefined,
    jobTitle: formData.get("jobTitle") || undefined,
    email: formData.get("email") || undefined,
    phone: formData.get("phone") || undefined,
    preferredContactMethod: formData.get("preferredContactMethod") || undefined,
    notes: formData.get("notes") || undefined,
    isPrimary: formData.get("isPrimary") === "on",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("create_client_contact", {
    p_client_id: parsed.data.clientId,
    p_first_name: parsed.data.firstName,
    p_last_name: parsed.data.lastName,
    p_job_title: parsed.data.jobTitle,
    p_email: parsed.data.email,
    p_phone: parsed.data.phone,
    p_preferred_contact_method: parsed.data.preferredContactMethod,
    p_notes: parsed.data.notes,
    p_is_primary: parsed.data.isPrimary,
  });

  if (error) return { error: error.message };

  revalidatePath(`/clients/${parsed.data.clientId}`);
  return {};
}

export async function updateClientContactAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireUser();

  const contactId = uuidSchema.safeParse(formData.get("contactId"));
  const clientId = uuidSchema.safeParse(formData.get("clientId"));
  if (!contactId.success || !clientId.success) return { error: "Invalid request" };

  const parsed = updateClientContactSchema.safeParse({
    firstName: formData.get("firstName"),
    lastName: formData.get("lastName") || undefined,
    jobTitle: formData.get("jobTitle") || undefined,
    email: formData.get("email") || undefined,
    phone: formData.get("phone") || undefined,
    preferredContactMethod: formData.get("preferredContactMethod") || undefined,
    notes: formData.get("notes") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_client_contact", {
    p_contact_id: contactId.data,
    p_first_name: parsed.data.firstName,
    p_last_name: parsed.data.lastName,
    p_job_title: parsed.data.jobTitle,
    p_email: parsed.data.email,
    p_phone: parsed.data.phone,
    p_preferred_contact_method: parsed.data.preferredContactMethod,
    p_notes: parsed.data.notes,
  });

  if (error) return { error: error.message };

  revalidatePath(`/clients/${clientId.data}`);
  return {};
}

export async function setPrimaryContactAction(formData: FormData): Promise<void> {
  await requireUser();
  const contactId = uuidSchema.safeParse(formData.get("contactId"));
  const clientId = uuidSchema.safeParse(formData.get("clientId"));
  if (!contactId.success || !clientId.success) redirect("/clients");

  const supabase = await createClient();
  await supabase.rpc("set_primary_contact", { p_contact_id: contactId.data });

  revalidatePath(`/clients/${clientId.data}`);
  redirect(`/clients/${clientId.data}`);
}

export async function archiveClientContactAction(formData: FormData): Promise<void> {
  await requireUser();
  const contactId = uuidSchema.safeParse(formData.get("contactId"));
  const clientId = uuidSchema.safeParse(formData.get("clientId"));
  if (!contactId.success || !clientId.success) redirect("/clients");

  const supabase = await createClient();
  await supabase.rpc("archive_client_contact", { p_contact_id: contactId.data });

  revalidatePath(`/clients/${clientId.data}`);
  redirect(`/clients/${clientId.data}`);
}

export async function restoreClientContactAction(formData: FormData): Promise<void> {
  await requireUser();
  const contactId = uuidSchema.safeParse(formData.get("contactId"));
  const clientId = uuidSchema.safeParse(formData.get("clientId"));
  if (!contactId.success || !clientId.success) redirect("/clients");

  const supabase = await createClient();
  await supabase.rpc("restore_client_contact", { p_contact_id: contactId.data });

  revalidatePath(`/clients/${clientId.data}`);
  redirect(`/clients/${clientId.data}`);
}

