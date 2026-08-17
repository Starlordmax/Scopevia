"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "../lib/supabase/server";
import { requireUser } from "../lib/auth/session";
import { requirePermission } from "../lib/auth/permissions";
import { PERMISSIONS } from "../lib/auth/permission-keys";
import { uuidSchema } from "../lib/validation/schemas";
import { createClientSchema, quickCreateClientSchema, createClientContactSchema, updateClientContactSchema } from "../lib/validation/crm";
import { buildQuickClientDisplayName } from "../lib/crm/quick-client";
import { friendlyRpcErrorMessage } from "../lib/errors/friendly-message";
import { zodIssuesToFieldErrors } from "../lib/validation/field-errors";
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
    addressLine1: formData.get("addressLine1") || undefined,
    addressLine2: formData.get("addressLine2") || undefined,
    city: formData.get("city") || undefined,
    state: formData.get("state") || undefined,
    postalCode: formData.get("postalCode") || undefined,
    countryCode: formData.get("countryCode") || undefined,
  });
}

export async function createClientAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireUser();

  const tenantId = uuidSchema.safeParse(formData.get("tenantId"));
  if (!tenantId.success) return { error: "Invalid request" };

  const parsed = readClientForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input", fieldErrors: zodIssuesToFieldErrors(parsed.error) };
  }

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
      p_address_line1: parsed.data.addressLine1,
      p_address_line2: parsed.data.addressLine2,
      p_city: parsed.data.city,
      p_state: parsed.data.state,
      p_postal_code: parsed.data.postalCode,
      p_country_code: parsed.data.countryCode,
    })
    .single();

  if (error) return { error: friendlyRpcErrorMessage(error.message) };

  const client = data as Client;
  redirect(`/clients/${client.id}`);
}

export type QuickCreateClientResult =
  | { ok: true; clientId: string; displayName: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

/**
 * Quick Create Client — invoked directly (not via a bound <form action>)
 * from the "+ New client" modal on the New Proposal page, so it can return
 * the created client's id/displayName to the caller instead of redirecting
 * away from the in-progress proposal form. See
 * docs/34-proposal-builder-ux.md, "Quick Create Client."
 *
 * Reuses create_client() — the exact same RPC and clients.create
 * permission as the full /clients/new form — rather than inventing new
 * server-side logic; the only differences are (1) stricter, quick-modal-
 * specific field requirements (see quickCreateClientSchema) and (2) no
 * redirect. Everything after the cheap, synchronous validation is wrapped
 * in try/catch so an unexpected failure degrades to a friendly message
 * instead of propagating to Next.js's error boundary — see
 * docs/71-logo-upload-crash-fix.md for why that matters.
 */
export async function createQuickClientAction(input: {
  tenantId: string;
  clientType: "individual" | "business";
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  countryCode?: string;
}): Promise<QuickCreateClientResult> {
  await requireUser();

  const tenantId = uuidSchema.safeParse(input.tenantId);
  if (!tenantId.success) return { ok: false, error: "Invalid request" };

  const parsed = quickCreateClientSchema.safeParse({
    clientType: input.clientType,
    firstName: input.firstName,
    lastName: input.lastName,
    email: input.email,
    phone: input.phone,
    addressLine1: input.addressLine1,
    addressLine2: input.addressLine2,
    city: input.city,
    state: input.state,
    postalCode: input.postalCode,
    countryCode: input.countryCode,
  });
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
      fieldErrors: zodIssuesToFieldErrors(parsed.error),
    };
  }

  try {
    await requirePermission(tenantId.data, PERMISSIONS.CLIENTS_CREATE);
  } catch {
    return { ok: false, error: "You do not have permission to do that" };
  }

  try {
    const supabase = await createClient();

    // Best-effort, tenant-scoped duplicate check via the caller's own
    // RLS-gated session — not atomic (a genuine race between two
    // simultaneous quick-creates with the same email could still both
    // pass this check), but catches the common case: someone quick-adding
    // a client who already exists. See docs/34, "Known limitations."
    const { data: existing } = await supabase
      .from("clients")
      .select("id")
      .eq("tenant_id", tenantId.data)
      .ilike("email", parsed.data.email)
      .is("archived_at", null)
      .limit(1);
    if (existing && existing.length > 0) {
      const message = "This email is already associated with an existing client.";
      return { ok: false, error: message, fieldErrors: { email: message } };
    }

    const displayName = buildQuickClientDisplayName(parsed.data.firstName, parsed.data.lastName);

    const { data, error } = await supabase
      .rpc("create_client", {
        p_tenant_id: tenantId.data,
        p_client_type: parsed.data.clientType,
        p_display_name: displayName,
        p_first_name: parsed.data.firstName,
        p_last_name: parsed.data.lastName,
        p_email: parsed.data.email,
        p_phone: parsed.data.phone,
        p_address_line1: parsed.data.addressLine1,
        p_address_line2: parsed.data.addressLine2,
        p_city: parsed.data.city,
        p_state: parsed.data.state,
        p_postal_code: parsed.data.postalCode,
        p_country_code: parsed.data.countryCode,
      })
      .single();

    if (error) return { ok: false, error: friendlyRpcErrorMessage(error.message) };

    const client = data as Client;

    // Business clients don't have a dedicated "company name" field on this
    // model (see docs/34, "Known limitations") — display_name falls back
    // to the contact person's name above. To still capture that this is a
    // named PERSON at the business (not the business's own identity), also
    // register them as its primary client_contacts row. Best-effort: the
    // client itself is already valid and selectable even if this
    // secondary contact record fails for some reason.
    if (parsed.data.clientType === "business") {
      try {
        await supabase.rpc("create_client_contact", {
          p_client_id: client.id,
          p_first_name: parsed.data.firstName,
          p_last_name: parsed.data.lastName,
          p_email: parsed.data.email,
          p_phone: parsed.data.phone,
          p_is_primary: true,
        });
      } catch {
        // Best-effort — see comment above.
      }
    }

    revalidatePath("/proposals/new");
    revalidatePath("/clients");

    return { ok: true, clientId: client.id, displayName: client.display_name };
  } catch (error) {
    console.error("Quick client creation failed:", error);
    return { ok: false, error: "We couldn't create the client right now. Please try again." };
  }
}

export async function updateClientAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireUser();

  const clientId = uuidSchema.safeParse(formData.get("clientId"));
  if (!clientId.success) return { error: "Invalid request" };

  const parsed = readClientForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input", fieldErrors: zodIssuesToFieldErrors(parsed.error) };
  }

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
    p_address_line1: parsed.data.addressLine1 ?? undefined,
    p_address_line2: parsed.data.addressLine2 ?? undefined,
    p_city: parsed.data.city ?? undefined,
    p_state: parsed.data.state ?? undefined,
    p_postal_code: parsed.data.postalCode ?? undefined,
    p_country_code: parsed.data.countryCode ?? undefined,
  });

  if (error) return { error: friendlyRpcErrorMessage(error.message) };

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
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input", fieldErrors: zodIssuesToFieldErrors(parsed.error) };
  }

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

  if (error) return { error: friendlyRpcErrorMessage(error.message) };

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
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input", fieldErrors: zodIssuesToFieldErrors(parsed.error) };
  }

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

  if (error) return { error: friendlyRpcErrorMessage(error.message) };

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

