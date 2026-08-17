"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "../lib/supabase/server";
import { requireUser } from "../lib/auth/session";
import { uuidSchema } from "../lib/validation/schemas";
import {
  createProposalDirectSchema,
  createProposalFromOpportunitySchema,
  updateProposalScopeSchema,
  addProposalSectionSchema,
  addProposalLaborItemSchema,
  addProposalLineItemSchema,
  updateProposalPricingSchema,
  updateProposalPricingZipSchema,
  addProposalLineItemFromCatalogSchema,
} from "../lib/validation/proposals";
import { friendlyRpcErrorMessage } from "../lib/errors/friendly-message";
import { zodIssuesToFieldErrors, attributeRpcErrorToField } from "../lib/validation/field-errors";
import type { ActionResult } from "./auth";
import type { Database } from "../../types/database";

type Proposal = Database["public"]["Tables"]["proposals"]["Row"];

function percentStringToBps(value: string): number {
  const cleaned = value.trim() === "" ? "0" : value.trim();
  return Math.round(parseFloat(cleaned) * 100);
}

function discountStringToValue(discountType: string, value: string): number {
  const cleaned = value.trim() === "" ? "0" : value.trim().replace(/[,$\s]/g, "");
  if (discountType === "percentage") return Math.round(parseFloat(cleaned) * 100); // bps
  if (discountType === "fixed") return Math.round(parseFloat(cleaned) * 100); // cents
  return 0;
}

export async function createProposalDirectAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireUser();

  const tenantId = uuidSchema.safeParse(formData.get("tenantId"));
  if (!tenantId.success) return { error: "Invalid request" };

  const parsed = createProposalDirectSchema.safeParse({
    clientId: formData.get("clientId"),
    clientContactId: formData.get("clientContactId") || undefined,
    opportunityId: formData.get("opportunityId") || undefined,
    title: formData.get("title"),
    serviceType: formData.get("serviceType"),
    customServiceName: formData.get("customServiceName") || undefined,
  });
  if (!parsed.success) {
    const fieldErrors = zodIssuesToFieldErrors(parsed.error);
    return { error: parsed.error.issues[0]?.message ?? "Invalid input", fieldErrors };
  }

  const idempotencyKey = String(formData.get("idempotencyKey") ?? "");

  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("create_proposal_direct", {
      p_tenant_id: tenantId.data,
      p_client_id: parsed.data.clientId,
      p_title: parsed.data.title,
      p_service_type: parsed.data.serviceType,
      p_client_contact_id: parsed.data.clientContactId,
      p_opportunity_id: parsed.data.opportunityId,
      p_idempotency_key: idempotencyKey || undefined,
      p_custom_service_name: parsed.data.customServiceName,
    })
    .single();

  if (error) {
    const message = friendlyRpcErrorMessage(error.message);
    const field = attributeRpcErrorToField(message, [["Enter a name for this custom service.", "customServiceName"]]);
    return { error: message, fieldErrors: field ? { [field]: message } : undefined };
  }

  const proposal = data as Proposal;
  redirect(`/proposals/${proposal.id}/edit?step=measurements`);
}

export async function createProposalFromOpportunityAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireUser();

  const tenantId = uuidSchema.safeParse(formData.get("tenantId"));
  if (!tenantId.success) return { error: "Invalid request" };

  const parsed = createProposalFromOpportunitySchema.safeParse({
    opportunityId: formData.get("opportunityId"),
    clientContactId: formData.get("clientContactId") || undefined,
    title: formData.get("title"),
    serviceType: formData.get("serviceType"),
    customServiceName: formData.get("customServiceName") || undefined,
  });
  if (!parsed.success) {
    const fieldErrors = zodIssuesToFieldErrors(parsed.error);
    return { error: parsed.error.issues[0]?.message ?? "Invalid input", fieldErrors };
  }

  const idempotencyKey = String(formData.get("idempotencyKey") ?? "");

  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("create_proposal_from_opportunity", {
      p_tenant_id: tenantId.data,
      p_opportunity_id: parsed.data.opportunityId,
      p_title: parsed.data.title,
      p_service_type: parsed.data.serviceType,
      p_client_contact_id: parsed.data.clientContactId,
      p_idempotency_key: idempotencyKey || undefined,
      p_custom_service_name: parsed.data.customServiceName,
    })
    .single();

  if (error) {
    const message = friendlyRpcErrorMessage(error.message);
    const field = attributeRpcErrorToField(message, [["Enter a name for this custom service.", "customServiceName"]]);
    return { error: message, fieldErrors: field ? { [field]: message } : undefined };
  }

  const proposal = data as Proposal;
  redirect(`/proposals/${proposal.id}/edit?step=measurements`);
}

export async function updateProposalScopeAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireUser();

  const proposalVersionId = uuidSchema.safeParse(formData.get("proposalVersionId"));
  const proposalId = uuidSchema.safeParse(formData.get("proposalId"));
  if (!proposalVersionId.success || !proposalId.success) return { error: "Invalid request" };

  // Raw values (including "") are passed straight to the schema, which is
  // solely responsible for normalizing "" / missing -> null. Do NOT
  // pre-filter with `|| undefined` here: that pattern is exactly what
  // produced the original bug (see the RPC call below).
  const parsed = updateProposalScopeSchema.safeParse({
    summary: formData.get("summary"),
    scopeIntro: formData.get("scopeIntro"),
    estimatedStartDate: formData.get("estimatedStartDate"),
    estimatedDurationDays: formData.get("estimatedDurationDays"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();
  // update_proposal_scope's optional params carry a SQL DEFAULT NULL (see
  // supabase/migrations/20260707150000_fix_update_proposal_scope_optional_args.sql),
  // but every key below is still sent explicitly, even when its value is
  // null. Supabase-js JSON-encodes this args object, and JSON.stringify
  // silently drops any key whose value is `undefined` -- if a key were
  // omitted or set to undefined here, PostgREST would see a request with
  // fewer arguments than any known overload and fail with "function not
  // found in schema cache", which was the original reported bug.
  // `as string`/`as number` casts are required because the generated RPC
  // arg types come out non-nullable even for DEFAULT-NULL params (a known
  // generator limitation also documented in src/lib/audit/log.ts) --
  // Postgres itself accepts null for all four.
  const { error } = await supabase.rpc("update_proposal_scope", {
    p_proposal_version_id: proposalVersionId.data,
    p_summary: parsed.data.summary as string,
    p_scope_intro: parsed.data.scopeIntro as string,
    p_estimated_start_date: parsed.data.estimatedStartDate as string,
    p_estimated_duration_days: parsed.data.estimatedDurationDays as number,
  });
  if (error) return { error: friendlyRpcErrorMessage(error.message) };

  revalidatePath(`/proposals/${proposalId.data}/edit`);
  redirect(`/proposals/${proposalId.data}/edit?step=labor`);
}

export async function addProposalSectionAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireUser();

  const proposalVersionId = uuidSchema.safeParse(formData.get("proposalVersionId"));
  const proposalId = uuidSchema.safeParse(formData.get("proposalId"));
  if (!proposalVersionId.success || !proposalId.success) return { error: "Invalid request" };

  const parsed = addProposalSectionSchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description") || undefined,
    sectionType: formData.get("sectionType") || "custom",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("add_proposal_section", {
    p_proposal_version_id: proposalVersionId.data,
    p_title: parsed.data.title,
    p_description: parsed.data.description ?? "",
    p_section_type: parsed.data.sectionType,
  });
  if (error) return { error: friendlyRpcErrorMessage(error.message) };

  revalidatePath(`/proposals/${proposalId.data}/edit`);
  return {};
}

export async function archiveProposalSectionAction(formData: FormData): Promise<void> {
  await requireUser();
  const sectionId = uuidSchema.safeParse(formData.get("sectionId"));
  const proposalId = uuidSchema.safeParse(formData.get("proposalId"));
  if (!sectionId.success || !proposalId.success) return;

  const supabase = await createClient();
  await supabase.rpc("archive_proposal_section", { p_section_id: sectionId.data });
  revalidatePath(`/proposals/${proposalId.data}/edit`);
}

export async function addProposalLaborItemAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireUser();

  const proposalVersionId = uuidSchema.safeParse(formData.get("proposalVersionId"));
  const proposalId = uuidSchema.safeParse(formData.get("proposalId"));
  if (!proposalVersionId.success || !proposalId.success) return { error: "Invalid request" };

  const pricingMethod = formData.get("pricingMethod") === "fixed" ? "fixed" : "hourly";
  const parsed = addProposalLaborItemSchema.safeParse(
    pricingMethod === "fixed"
      ? { pricingMethod, label: formData.get("label"), fixedTotalCents: formData.get("fixedPrice") }
      : {
          pricingMethod,
          label: formData.get("label"),
          workerCount: formData.get("workerCount"),
          estimatedDays: formData.get("estimatedDays"),
          hoursPerDay: formData.get("hoursPerDay"),
          hourlyRateCents: formData.get("hourlyRate"),
        }
  );
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();
  // p_worker_count/p_estimated_days/p_hours_per_day/p_hourly_rate_cents
  // have no SQL DEFAULT (they're the original required parameters), so
  // PostgREST needs every one of them present in the request body even
  // when null -- the same "never omit an optional/inapplicable key"
  // discipline as update_proposal_scope (docs/37). `as number` casts are
  // needed since the generated types don't reflect that Postgres accepts
  // null here.
  const { error } =
    parsed.data.pricingMethod === "fixed"
      ? await supabase.rpc("add_proposal_labor_item", {
          p_proposal_version_id: proposalVersionId.data,
          p_label: parsed.data.label,
          p_worker_count: null as unknown as number,
          p_estimated_days: null as unknown as number,
          p_hours_per_day: null as unknown as number,
          p_hourly_rate_cents: null as unknown as number,
          p_pricing_method: "fixed",
          p_fixed_total_cents: parsed.data.fixedTotalCents,
        })
      : await supabase.rpc("add_proposal_labor_item", {
          p_proposal_version_id: proposalVersionId.data,
          p_label: parsed.data.label,
          p_worker_count: parsed.data.workerCount,
          p_estimated_days: parsed.data.estimatedDays,
          p_hours_per_day: parsed.data.hoursPerDay,
          p_hourly_rate_cents: parsed.data.hourlyRateCents,
          p_pricing_method: "hourly",
          p_fixed_total_cents: null as unknown as number,
        });
  if (error) return { error: friendlyRpcErrorMessage(error.message) };

  revalidatePath(`/proposals/${proposalId.data}/edit`);
  return {};
}

export async function archiveProposalLaborItemAction(formData: FormData): Promise<void> {
  await requireUser();
  const laborItemId = uuidSchema.safeParse(formData.get("laborItemId"));
  const proposalId = uuidSchema.safeParse(formData.get("proposalId"));
  if (!laborItemId.success || !proposalId.success) return;

  const supabase = await createClient();
  await supabase.rpc("archive_proposal_labor_item", { p_labor_item_id: laborItemId.data });
  revalidatePath(`/proposals/${proposalId.data}/edit`);
}

export async function addProposalLineItemAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireUser();

  const proposalVersionId = uuidSchema.safeParse(formData.get("proposalVersionId"));
  const proposalId = uuidSchema.safeParse(formData.get("proposalId"));
  if (!proposalVersionId.success || !proposalId.success) return { error: "Invalid request" };

  const parsed = addProposalLineItemSchema.safeParse({
    category: formData.get("category"),
    description: formData.get("description"),
    quantity: formData.get("quantity"),
    unit: formData.get("unit"),
    unitPriceCents: formData.get("unitPrice"),
    taxable: formData.get("taxable") === "on" || formData.get("taxable") === "true",
    sectionId: formData.get("sectionId") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("add_proposal_line_item", {
    p_proposal_version_id: proposalVersionId.data,
    p_category: parsed.data.category,
    p_description: parsed.data.description,
    p_quantity: parsed.data.quantity,
    p_unit: parsed.data.unit,
    p_unit_price_cents: parsed.data.unitPriceCents,
    p_taxable: parsed.data.taxable,
    p_section_id: parsed.data.sectionId,
  });
  if (error) return { error: friendlyRpcErrorMessage(error.message) };

  revalidatePath(`/proposals/${proposalId.data}/edit`);
  return {};
}

export async function archiveProposalLineItemAction(formData: FormData): Promise<void> {
  await requireUser();
  const lineItemId = uuidSchema.safeParse(formData.get("lineItemId"));
  const proposalId = uuidSchema.safeParse(formData.get("proposalId"));
  if (!lineItemId.success || !proposalId.success) return;

  const supabase = await createClient();
  await supabase.rpc("archive_proposal_line_item", { p_line_item_id: lineItemId.data });
  revalidatePath(`/proposals/${proposalId.data}/edit`);
}

export async function updateProposalPricingZipAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireUser();

  const proposalVersionId = uuidSchema.safeParse(formData.get("proposalVersionId"));
  const proposalId = uuidSchema.safeParse(formData.get("proposalId"));
  if (!proposalVersionId.success || !proposalId.success) return { error: "Invalid request" };

  const parsed = updateProposalPricingZipSchema.safeParse({
    zipCode: formData.get("zipCode") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  // `as string` cast for the same reason as update_proposal_scope
  // (docs/37): p_zip_code has a SQL DEFAULT NULL, but the generated RPC
  // arg type comes out non-nullable — Postgres itself accepts null here.
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_proposal_pricing_zip", {
    p_proposal_version_id: proposalVersionId.data,
    p_zip_code: (parsed.data.zipCode ?? null) as string,
  });
  if (error) return { error: friendlyRpcErrorMessage(error.message) };

  revalidatePath(`/proposals/${proposalId.data}/edit`);
  return {};
}

export async function addProposalLineItemFromCatalogAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireUser();

  const proposalVersionId = uuidSchema.safeParse(formData.get("proposalVersionId"));
  const proposalId = uuidSchema.safeParse(formData.get("proposalId"));
  if (!proposalVersionId.success || !proposalId.success) return { error: "Invalid request" };

  const parsed = addProposalLineItemFromCatalogSchema.safeParse({
    materialCatalogItemId: formData.get("materialCatalogItemId"),
    quantity: formData.get("quantity"),
    zipCode: formData.get("zipCode") || undefined,
    taxable: formData.get("taxable") === "on" || formData.get("taxable") === "true",
    sectionId: formData.get("sectionId") || undefined,
    unitPriceCentsOverride: formData.get("unitPriceOverride") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  // Same cast discipline as update_proposal_pricing_zip above: these
  // params have SQL DEFAULT NULL, Postgres accepts null, but the
  // generated arg types come out non-nullable.
  const supabase = await createClient();
  const { error } = await supabase.rpc("add_proposal_line_item_from_catalog", {
    p_proposal_version_id: proposalVersionId.data,
    p_material_catalog_item_id: parsed.data.materialCatalogItemId,
    p_quantity: parsed.data.quantity,
    p_zip_code: (parsed.data.zipCode ?? null) as string,
    p_unit_price_cents_override: (parsed.data.unitPriceCentsOverride ?? null) as number,
    p_taxable: parsed.data.taxable,
    p_section_id: (parsed.data.sectionId ?? null) as string,
  });
  if (error) return { error: friendlyRpcErrorMessage(error.message) };

  revalidatePath(`/proposals/${proposalId.data}/edit`);
  return {};
}

export async function updateProposalPricingAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireUser();

  const proposalVersionId = uuidSchema.safeParse(formData.get("proposalVersionId"));
  const proposalId = uuidSchema.safeParse(formData.get("proposalId"));
  if (!proposalVersionId.success || !proposalId.success) return { error: "Invalid request" };

  const parsed = updateProposalPricingSchema.safeParse({
    terms: formData.get("terms") || undefined,
    exclusions: formData.get("exclusions") || undefined,
    notesForClient: formData.get("notesForClient") || undefined,
    discountType: formData.get("discountType") || "none",
    discountValue: formData.get("discountValue") || "0",
    taxRatePercent: formData.get("taxRatePercent") || "0",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_proposal_pricing", {
    p_proposal_version_id: proposalVersionId.data,
    p_terms: parsed.data.terms ?? "",
    p_exclusions: parsed.data.exclusions ?? "",
    p_notes_for_client: parsed.data.notesForClient ?? "",
    p_discount_type: parsed.data.discountType,
    p_discount_value: discountStringToValue(parsed.data.discountType, parsed.data.discountValue),
    p_tax_rate_bps: percentStringToBps(parsed.data.taxRatePercent),
  });
  if (error) return { error: friendlyRpcErrorMessage(error.message) };

  revalidatePath(`/proposals/${proposalId.data}/edit`);
  redirect(`/proposals/${proposalId.data}/edit?step=review`);
}

export async function markProposalReadyAction(formData: FormData): Promise<void> {
  await requireUser();
  const proposalId = uuidSchema.safeParse(formData.get("proposalId"));
  if (!proposalId.success) return;

  const supabase = await createClient();
  await supabase.rpc("mark_proposal_ready", { p_proposal_id: proposalId.data });

  revalidatePath(`/proposals/${proposalId.data}`);
  revalidatePath("/proposals");
  redirect(`/proposals/${proposalId.data}`);
}

export async function returnProposalToDraftAction(formData: FormData): Promise<void> {
  await requireUser();
  const proposalId = uuidSchema.safeParse(formData.get("proposalId"));
  if (!proposalId.success) return;

  const supabase = await createClient();
  await supabase.rpc("return_proposal_to_draft", { p_proposal_id: proposalId.data });

  revalidatePath(`/proposals/${proposalId.data}`);
  revalidatePath("/proposals");
  redirect(`/proposals/${proposalId.data}/edit?step=review`);
}

export async function archiveProposalAction(formData: FormData): Promise<void> {
  await requireUser();
  const proposalId = uuidSchema.safeParse(formData.get("proposalId"));
  if (!proposalId.success) redirect("/proposals");

  const supabase = await createClient();
  await supabase.rpc("archive_proposal", { p_proposal_id: proposalId.data });

  revalidatePath(`/proposals/${proposalId.data}`);
  revalidatePath("/proposals");
  redirect("/proposals");
}

export async function restoreProposalAction(formData: FormData): Promise<void> {
  await requireUser();
  const proposalId = uuidSchema.safeParse(formData.get("proposalId"));
  if (!proposalId.success) redirect("/proposals");

  const supabase = await createClient();
  await supabase.rpc("restore_proposal", { p_proposal_id: proposalId.data });

  revalidatePath(`/proposals/${proposalId.data}`);
  revalidatePath("/proposals");
  redirect(`/proposals/${proposalId.data}`);
}

export async function createProposalRevisionAction(formData: FormData): Promise<void> {
  await requireUser();
  const proposalId = uuidSchema.safeParse(formData.get("proposalId"));
  if (!proposalId.success) redirect("/proposals");

  const supabase = await createClient();
  const { error } = await supabase.rpc("create_proposal_revision", { p_proposal_id: proposalId.data });

  revalidatePath(`/proposals/${proposalId.data}`);
  revalidatePath("/proposals");
  // On failure (e.g. a race with another revision already in progress),
  // this simply lands back on the detail page showing the current,
  // unchanged state — same best-effort discipline as archiveProposalAction/
  // restoreProposalAction above, which this button-only (no form fields)
  // action otherwise matches exactly.
  redirect(error ? `/proposals/${proposalId.data}` : `/proposals/${proposalId.data}/edit?step=scope`);
}
