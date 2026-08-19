"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "../lib/supabase/server";
import { requireUser } from "../lib/auth/session";
import { uuidSchema } from "../lib/validation/schemas";
import { businessProfileSchema } from "../lib/validation/business-profile";
import { friendlyRpcErrorMessage } from "../lib/errors/friendly-message";
import { zodIssuesToFieldErrors } from "../lib/validation/field-errors";
import type { ActionResult } from "./auth";

export async function updateBusinessProfileAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireUser();

  const tenantId = uuidSchema.safeParse(formData.get("tenantId"));
  if (!tenantId.success) return { error: "Invalid request" };

  const parsed = businessProfileSchema.safeParse({
    businessName: formData.get("businessName"),
    industry: formData.get("industry") || undefined,
    mainServices: formData.get("mainServices") || undefined,
    serviceArea: formData.get("serviceArea") || undefined,
    businessAddress: formData.get("businessAddress") || undefined,
    businessPhone: formData.get("businessPhone") || undefined,
    businessEmail: formData.get("businessEmail") || undefined,
    licenseNumber: formData.get("licenseNumber") || undefined,
    insuranceStatement: formData.get("insuranceStatement") || undefined,
    defaultWarrantyPolicy: formData.get("defaultWarrantyPolicy") || undefined,
    defaultPaymentTerms: formData.get("defaultPaymentTerms") || undefined,
    defaultDepositPolicy: formData.get("defaultDepositPolicy") || undefined,
    defaultChangeOrderPolicy: formData.get("defaultChangeOrderPolicy") || undefined,
    defaultCancellationPolicy: formData.get("defaultCancellationPolicy") || undefined,
    defaultCleanupPolicy: formData.get("defaultCleanupPolicy") || undefined,
    defaultMaterialsPolicy: formData.get("defaultMaterialsPolicy") || undefined,
    defaultClientResponsibilities: formData.get("defaultClientResponsibilities") || undefined,
    defaultExclusions: formData.get("defaultExclusions") || undefined,
    tonePreference: formData.get("tonePreference") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input", fieldErrors: zodIssuesToFieldErrors(parsed.error) };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_business_profile", {
    p_tenant_id: tenantId.data,
    p_business_name: parsed.data.businessName,
    p_industry: parsed.data.industry ?? "",
    p_main_services: parsed.data.mainServices ?? "",
    p_service_area: parsed.data.serviceArea ?? "",
    p_business_address: parsed.data.businessAddress ?? "",
    p_business_phone: parsed.data.businessPhone ?? "",
    p_business_email: parsed.data.businessEmail ?? "",
    p_license_number: parsed.data.licenseNumber ?? "",
    p_insurance_statement: parsed.data.insuranceStatement ?? "",
    p_default_warranty_policy: parsed.data.defaultWarrantyPolicy ?? "",
    p_default_payment_terms: parsed.data.defaultPaymentTerms ?? "",
    p_default_deposit_policy: parsed.data.defaultDepositPolicy ?? "",
    p_default_change_order_policy: parsed.data.defaultChangeOrderPolicy ?? "",
    p_default_cancellation_policy: parsed.data.defaultCancellationPolicy ?? "",
    p_default_cleanup_policy: parsed.data.defaultCleanupPolicy ?? "",
    p_default_materials_policy: parsed.data.defaultMaterialsPolicy ?? "",
    p_default_client_responsibilities: parsed.data.defaultClientResponsibilities ?? "",
    p_default_exclusions: parsed.data.defaultExclusions ?? "",
    p_tone_preference: parsed.data.tonePreference,
  });
  if (error) return { error: friendlyRpcErrorMessage(error.message) };

  revalidatePath("/profile");
  return { message: "Business profile saved." };
}
