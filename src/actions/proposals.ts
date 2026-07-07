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
} from "../lib/validation/proposals";
import { friendlyRpcErrorMessage } from "../lib/errors/friendly-message";
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
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

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
    })
    .single();

  if (error) return { error: friendlyRpcErrorMessage(error.message) };

  const proposal = data as Proposal;
  redirect(`/proposals/${proposal.id}/edit?step=scope`);
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
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

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
    })
    .single();

  if (error) return { error: friendlyRpcErrorMessage(error.message) };

  const proposal = data as Proposal;
  redirect(`/proposals/${proposal.id}/edit?step=scope`);
}

export async function updateProposalScopeAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireUser();

  const proposalVersionId = uuidSchema.safeParse(formData.get("proposalVersionId"));
  const proposalId = uuidSchema.safeParse(formData.get("proposalId"));
  if (!proposalVersionId.success || !proposalId.success) return { error: "Invalid request" };

  const parsed = updateProposalScopeSchema.safeParse({
    summary: formData.get("summary") || undefined,
    scopeIntro: formData.get("scopeIntro") || undefined,
    estimatedStartDate: formData.get("estimatedStartDate") || undefined,
    estimatedDurationDays: formData.get("estimatedDurationDays") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_proposal_scope", {
    p_proposal_version_id: proposalVersionId.data,
    // update_proposal_scope's params have no SQL DEFAULT, so the generated
    // RPC types come out non-optional even though Postgres accepts NULL for
    // any of them — same generator limitation documented in
    // src/lib/audit/log.ts. These fields are genuinely optional in the UI.
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

  const parsed = addProposalLaborItemSchema.safeParse({
    label: formData.get("label"),
    workerCount: formData.get("workerCount"),
    estimatedDays: formData.get("estimatedDays"),
    hoursPerDay: formData.get("hoursPerDay"),
    hourlyRateCents: formData.get("hourlyRate"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("add_proposal_labor_item", {
    p_proposal_version_id: proposalVersionId.data,
    p_label: parsed.data.label,
    p_worker_count: parsed.data.workerCount,
    p_estimated_days: parsed.data.estimatedDays,
    p_hours_per_day: parsed.data.hoursPerDay,
    p_hourly_rate_cents: parsed.data.hourlyRateCents,
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
