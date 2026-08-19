import { z } from "zod";
import { optionalEmailSchema, optionalPhoneSchema } from "./crm";

const optionalLongText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v === "" ? undefined : v));

export const tonePreferenceSchema = z.enum(["professional", "friendly", "direct", "detailed", "simple"], {
  message: "Please select a tone.",
});

/**
 * Tenant-level business context — feeds the AI proposal-text prompt (see
 * src/lib/ai/prompt.ts) and is edited in Profile → Business profile. Every
 * field but `businessName` is optional free text: a contractor filling
 * this in for the first time shouldn't be blocked from saving a partial
 * profile, and the prompt builder already writes neutral text for
 * anything left blank (see docs/78-business-profile-ai-context.md).
 */
export const businessProfileSchema = z.object({
  businessName: z.string().trim().min(1, "Business name is required").max(160),
  industry: optionalLongText(160),
  mainServices: optionalLongText(2000),
  serviceArea: optionalLongText(500),
  businessAddress: optionalLongText(500),
  businessPhone: optionalPhoneSchema,
  businessEmail: optionalEmailSchema,
  licenseNumber: optionalLongText(120),
  insuranceStatement: optionalLongText(2000),
  defaultWarrantyPolicy: optionalLongText(4000),
  defaultPaymentTerms: optionalLongText(4000),
  defaultDepositPolicy: optionalLongText(4000),
  defaultChangeOrderPolicy: optionalLongText(4000),
  defaultCancellationPolicy: optionalLongText(4000),
  defaultCleanupPolicy: optionalLongText(4000),
  defaultMaterialsPolicy: optionalLongText(4000),
  defaultClientResponsibilities: optionalLongText(4000),
  defaultExclusions: optionalLongText(4000),
  tonePreference: tonePreferenceSchema.default("professional"),
});

export type BusinessProfileInput = z.infer<typeof businessProfileSchema>;
