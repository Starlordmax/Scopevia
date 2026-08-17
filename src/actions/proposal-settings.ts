"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "../lib/supabase/server";
import { requireUser } from "../lib/auth/session";
import { uuidSchema } from "../lib/validation/schemas";
import { updateProposalSettingsSchema } from "../lib/validation/proposals";
import { friendlyRpcErrorMessage } from "../lib/errors/friendly-message";
import { zodIssuesToFieldErrors } from "../lib/validation/field-errors";
import type { ActionResult } from "./auth";

export async function updateProposalSettingsAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireUser();

  const tenantId = uuidSchema.safeParse(formData.get("tenantId"));
  if (!tenantId.success) return { error: "Invalid request" };

  const parsed = updateProposalSettingsSchema.safeParse({
    defaultCustomerHourlyRate: formData.get("defaultCustomerHourlyRate"),
    defaultHoursPerDay: formData.get("defaultHoursPerDay"),
    defaultTaxRatePercent: formData.get("defaultTaxRatePercent") || "0",
    defaultProposalValidDays: formData.get("defaultProposalValidDays"),
    defaultTerms: formData.get("defaultTerms") || undefined,
    defaultExclusions: formData.get("defaultExclusions") || undefined,
    proposalNumberPrefix: formData.get("proposalNumberPrefix"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input", fieldErrors: zodIssuesToFieldErrors(parsed.error) };
  }

  const taxRateBps = Math.round(parseFloat(parsed.data.defaultTaxRatePercent || "0") * 100);

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_tenant_proposal_settings", {
    p_tenant_id: tenantId.data,
    p_default_customer_hourly_rate_cents: parsed.data.defaultCustomerHourlyRate,
    p_default_hours_per_day: parsed.data.defaultHoursPerDay,
    p_default_tax_rate_bps: taxRateBps,
    p_default_proposal_valid_days: parsed.data.defaultProposalValidDays,
    p_default_terms: parsed.data.defaultTerms,
    p_default_exclusions: parsed.data.defaultExclusions,
    p_proposal_number_prefix: parsed.data.proposalNumberPrefix,
  });
  if (error) return { error: friendlyRpcErrorMessage(error.message) };

  revalidatePath("/settings/proposals");
  return {};
}
