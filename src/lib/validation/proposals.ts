import { z } from "zod";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v === "" ? undefined : v));

export const serviceTypeSchema = z.enum([
  "interior_painting",
  "exterior_painting",
  "bathroom_remodeling",
  "general_remodeling",
  "flooring",
  "custom",
]);

export const sectionTypeSchema = z.enum(["scope", "schedule", "materials", "additional_services", "exclusions", "custom"]);

export const lineItemCategorySchema = z.enum([
  "material",
  "equipment",
  "subcontractor",
  "travel",
  "disposal",
  "additional_service",
  "allowance",
  "other",
]);

export const lineItemUnitSchema = z.enum(["each", "hour", "day", "gallon", "sq_ft", "linear_ft", "fixed"]);

export const discountTypeSchema = z.enum(["none", "fixed", "percentage"]);

/** Converts a form's dollars text input (e.g. "1,234.50") into integer cents. Unlike dollarsToCentsSchema in crm.ts, this one is required (a price field can't be silently omitted). */
export const requiredDollarsToCentsSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/[,$\s]/g, ""))
  .refine((v) => /^\d+(\.\d{1,2})?$/.test(v), "Enter a valid dollar amount")
  .transform((v) => Math.round(parseFloat(v) * 100));

/** Converts a form's percentage text input (e.g. "7.5") into integer basis points. */
export const percentToBpsSchema = z
  .string()
  .trim()
  .transform((v) => (v === "" ? "0" : v))
  .refine((v) => /^\d+(\.\d{1,4})?$/.test(v), "Enter a valid percentage")
  .transform((v) => Math.round(parseFloat(v) * 100));

export const createProposalDirectSchema = z.object({
  clientId: z.string().uuid(),
  clientContactId: z.string().uuid().optional(),
  opportunityId: z.string().uuid().optional(),
  title: z.string().trim().min(1, "Title is required").max(160),
  serviceType: serviceTypeSchema,
});

export const createProposalFromOpportunitySchema = z.object({
  opportunityId: z.string().uuid(),
  clientContactId: z.string().uuid().optional(),
  title: z.string().trim().min(1, "Title is required").max(160),
  serviceType: serviceTypeSchema,
});

const isoDateSchema = z
  .string()
  .trim()
  .refine((v) => /^\d{4}-\d{2}-\d{2}$/.test(v), "Enter a valid date (YYYY-MM-DD)")
  .refine((v) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
    if (!match) return false;
    const y = Number(match[1]);
    const m = Number(match[2]);
    const d = Number(match[3]);
    const parsed = new Date(Date.UTC(y, m - 1, d));
    return parsed.getUTCFullYear() === y && parsed.getUTCMonth() === m - 1 && parsed.getUTCDate() === d;
  }, "Enter a valid date");

/**
 * Normalizes a raw (possibly empty) form field to `null`, never `undefined`.
 * update_proposal_scope's RPC call must always send every optional key
 * explicitly as `null` -- Supabase-js JSON-encodes the RPC args, and
 * JSON.stringify silently drops keys whose value is `undefined`, which is
 * what let PostgREST resolve a different (nonexistent) function overload
 * and fail with a "not found in schema cache" error.
 */
const nullableTrimmedText = (max: number, message?: string) =>
  z
    .string()
    .nullable()
    .optional()
    .transform((v) => (v === undefined || v === null ? null : v.trim()))
    .transform((v) => (v === "" ? null : v))
    .refine((v) => v === null || v.length <= max, message ?? `Must be ${max} characters or fewer`);

export const updateProposalScopeSchema = z.object({
  summary: nullableTrimmedText(500, "Short summary is too long"),
  scopeIntro: nullableTrimmedText(4000, "Scope introduction is too long"),
  estimatedStartDate: z
    .string()
    .nullable()
    .optional()
    .transform((v) => (v === undefined || v === null || v.trim() === "" ? null : v.trim()))
    .refine((v) => v === null || isoDateSchema.safeParse(v).success, "Enter a valid date (YYYY-MM-DD)"),
  // A dedicated string-first pipeline, not z.coerce.number(): Number("") is
  // 0 in JavaScript, so coercing an empty field directly would silently
  // turn "duration left blank" into "duration of zero days" instead of
  // null.
  estimatedDurationDays: z
    .string()
    .nullable()
    .optional()
    .transform((v) => (v === undefined || v === null || v.trim() === "" ? null : v.trim()))
    .refine((v) => v === null || /^\d+$/.test(v), "Estimated duration must be a whole number of days")
    .transform((v) => (v === null ? null : Number(v)))
    .refine((v) => v === null || (v >= 1 && v <= 3650), "Estimated duration must be greater than zero"),
});

export const addProposalSectionSchema = z.object({
  title: z.string().trim().min(1, "Section title is required").max(160),
  description: optionalText(4000),
  sectionType: sectionTypeSchema.default("custom"),
});

export const addProposalLaborItemSchema = z.object({
  label: z.string().trim().min(1, "Label is required").max(160),
  workerCount: z.coerce.number().int().min(1, "Must be at least 1").max(500),
  estimatedDays: z.coerce.number().min(0.01, "Must be greater than zero").max(3650),
  hoursPerDay: z.coerce.number().min(0.01, "Must be greater than zero").max(24),
  hourlyRateCents: requiredDollarsToCentsSchema,
});

export const addProposalLineItemSchema = z.object({
  category: lineItemCategorySchema,
  description: z.string().trim().min(1, "Description is required").max(400),
  quantity: z.coerce.number().min(0.001, "Must be greater than zero").max(1000000),
  unit: lineItemUnitSchema,
  unitPriceCents: requiredDollarsToCentsSchema,
  taxable: z.coerce.boolean().default(true),
  sectionId: z.string().uuid().optional(),
});

export const updateProposalPricingSchema = z.object({
  terms: optionalText(4000),
  exclusions: optionalText(4000),
  notesForClient: optionalText(2000),
  discountType: discountTypeSchema,
  discountValue: z.string().trim().optional().default("0"),
  taxRatePercent: z.string().trim().optional().default("0"),
});

export const createPortfolioProjectSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(160),
  serviceType: serviceTypeSchema,
  description: optionalText(4000),
  locationLabel: optionalText(160),
  completedAt: optionalText(10),
});

export const updateProposalSettingsSchema = z.object({
  defaultCustomerHourlyRate: requiredDollarsToCentsSchema,
  defaultHoursPerDay: z.coerce.number().min(0.5).max(24),
  defaultTaxRatePercent: z.string().trim().optional().default("0"),
  defaultProposalValidDays: z.coerce.number().int().min(1).max(365),
  defaultTerms: optionalText(4000).transform((v) => v ?? ""),
  defaultExclusions: optionalText(4000).transform((v) => v ?? ""),
  proposalNumberPrefix: z.string().trim().min(1, "Prefix is required").max(20),
});
