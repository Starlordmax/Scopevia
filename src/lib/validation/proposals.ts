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

/**
 * `service_type = 'custom'` requires a human-readable name (e.g. "Deck
 * repair") — shared by both proposal-creation schemas below via
 * .superRefine(), same pattern as refineAddressPostalCode() in crm.ts.
 * The field's key ("customServiceName") matches its <input id>/name, so
 * a Zod issue here maps directly onto a red form field — see
 * zodIssuesToFieldErrors() in src/lib/validation/field-errors.ts.
 */
function refineCustomServiceName(data: { serviceType: string; customServiceName?: string }, ctx: z.RefinementCtx) {
  if (data.serviceType === "custom" && (!data.customServiceName || data.customServiceName.trim() === "")) {
    ctx.addIssue({ code: "custom", path: ["customServiceName"], message: "Enter a name for this custom service." });
  }
}

export const createProposalDirectSchema = z
  .object({
    clientId: z.string().uuid(),
    clientContactId: z.string().uuid().optional(),
    opportunityId: z.string().uuid().optional(),
    title: z.string().trim().min(1, "Title is required").max(160),
    serviceType: serviceTypeSchema,
    customServiceName: optionalText(160),
  })
  .superRefine(refineCustomServiceName);

export const createProposalFromOpportunitySchema = z
  .object({
    opportunityId: z.string().uuid(),
    clientContactId: z.string().uuid().optional(),
    title: z.string().trim().min(1, "Title is required").max(160),
    serviceType: serviceTypeSchema,
    customServiceName: optionalText(160),
  })
  .superRefine(refineCustomServiceName);

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

export const laborPricingMethodSchema = z.enum(["hourly", "fixed"]);

/**
 * A discriminated union rather than one object with optional fields: which
 * fields are required is entirely determined by pricingMethod, and a
 * discriminated union makes that an exhaustive, compiler-checked fact
 * instead of something enforced ad hoc with .refine(). requiredDollarsToCentsSchema
 * rejects an empty string outright (via regex) rather than coercing it to
 * 0 — see its definition above.
 */
export const addProposalLaborItemSchema = z.discriminatedUnion("pricingMethod", [
  z.object({
    pricingMethod: z.literal("hourly"),
    label: z.string().trim().min(1, "Label is required").max(160),
    workerCount: z.coerce.number().int().min(1, "Must be at least 1").max(500),
    estimatedDays: z.coerce.number().min(0.01, "Must be greater than zero").max(3650),
    hoursPerDay: z.coerce.number().min(0.01, "Must be greater than zero").max(24),
    hourlyRateCents: requiredDollarsToCentsSchema,
  }),
  z.object({
    pricingMethod: z.literal("fixed"),
    label: z.string().trim().min(1, "Label is required").max(160),
    fixedTotalCents: requiredDollarsToCentsSchema,
  }),
]);

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

const optionalZipCodeSchema = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v === "" || v === undefined ? undefined : v))
  .refine((v) => v === undefined || /^\d{5}$/.test(v), "ZIP code must be 5 digits");

export const materialCatalogCategorySchema = z.enum([
  "paint",
  "primer",
  "tape",
  "brushes",
  "rollers",
  "drop_cloths",
  "drywall",
  "tile",
  "flooring",
  "wood",
  "plumbing",
  "electrical",
  "hardware",
  "disposal",
  "other",
]);

export const searchMaterialCatalogSchema = z.object({
  zipCode: optionalZipCodeSchema,
  searchText: optionalText(160),
  category: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v === "" ? undefined : v)),
});

export const updateProposalPricingZipSchema = z.object({
  zipCode: optionalZipCodeSchema,
});

export const addProposalLineItemFromCatalogSchema = z.object({
  materialCatalogItemId: z.string().uuid(),
  quantity: z.coerce.number().min(0.001, "Must be greater than zero").max(1000000),
  zipCode: optionalZipCodeSchema,
  taxable: z.coerce.boolean().default(true),
  sectionId: z.string().uuid().optional(),
  // Only present when the user explicitly overrides the catalog price —
  // gated server-side by proposals.manage_pricing, not by this schema.
  unitPriceCentsOverride: requiredDollarsToCentsSchema.optional(),
});

export const createTenantMaterialSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(160),
  category: materialCatalogCategorySchema,
  defaultUnit: lineItemUnitSchema,
  description: optionalText(2000),
  serviceType: serviceTypeSchema.optional(),
  brand: optionalText(160),
  sku: optionalText(80),
  supplierName: optionalText(160),
});

export const createPortfolioProjectSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(160),
  serviceType: serviceTypeSchema,
  description: optionalText(4000),
  locationLabel: optionalText(160),
  completedAt: optionalText(10),
});

// =============================================================================
// Phase 2C: Measurements / Takeoff builder
// =============================================================================

export const unitSystemSchema = z.enum(["imperial", "metric"]);
export const measurementUnitSchema = z.enum(["ft", "m"]);
export const measurementTypeSchema = z.enum(["floor_area", "wall_area", "ceiling_area", "room", "surface", "linear", "custom"]);
export const manualShapeTypeSchema = z.enum(["manual_rectangle", "manual_area", "manual_linear"]);
export const measurementValueFieldSchema = z.enum(["area", "perimeter", "linear_length"]);
export const laborMeasurementPricingMethodSchema = z.enum(["area", "linear"]);

const positiveDimension = (max: number, label: string) => z.coerce.number().positive(`${label} must be greater than zero`).max(max);
/** Exact copy from the brief's field-validation list — kept distinct from positiveDimension() since a reference length's error is shown verbatim, not built from a generic "<label> must be greater than zero" template. */
const positiveReferenceLength = (max: number) => z.coerce.number().positive("Enter a reference length greater than 0.").max(max);

export const createMeasurementGroupSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(160),
  unitSystem: unitSystemSchema.default("imperial"),
  serviceType: serviceTypeSchema.optional(),
});

/**
 * A discriminated union on shapeType, same rationale as
 * addProposalLaborItemSchema above: which dimension fields are required
 * is entirely determined by shapeType, and a discriminated union makes
 * that exhaustive and compiler-checked rather than ad hoc .refine() calls.
 */
export const addMeasurementSchema = z.discriminatedUnion("shapeType", [
  z.object({
    shapeType: z.literal("manual_rectangle"),
    name: z.string().trim().min(1, "Measurement name is required.").max(160),
    measurementType: measurementTypeSchema,
    unit: measurementUnitSchema,
    length: positiveDimension(100000, "Length"),
    width: positiveDimension(100000, "Width"),
    height: positiveDimension(100000, "Height").optional(),
    wastePercent: percentToBpsSchema,
    notes: optionalText(2000),
  }),
  z.object({
    shapeType: z.literal("manual_area"),
    name: z.string().trim().min(1, "Measurement name is required.").max(160),
    measurementType: measurementTypeSchema,
    unit: measurementUnitSchema,
    area: positiveDimension(10000000, "Area"),
    wastePercent: percentToBpsSchema,
    notes: optionalText(2000),
  }),
  z.object({
    shapeType: z.literal("manual_linear"),
    name: z.string().trim().min(1, "Measurement name is required.").max(160),
    measurementType: measurementTypeSchema,
    unit: measurementUnitSchema,
    linearLength: positiveDimension(100000, "Linear length"),
    wastePercent: percentToBpsSchema,
    notes: optionalText(2000),
  }),
]);

export const updateMeasurementSchema = addMeasurementSchema;

export const saveMeasurementShapeSchema = z.object({
  name: z.string().trim().min(1, "Measurement name is required.").max(160),
  measurementType: measurementTypeSchema,
  unit: measurementUnitSchema,
  length: positiveDimension(100000, "Length"),
  width: positiveDimension(100000, "Width"),
  scaleReferenceLength: positiveReferenceLength(100000),
  scaleUnit: measurementUnitSchema,
  wastePercent: percentToBpsSchema,
  notes: optionalText(2000),
});

/**
 * Freehand/brush drawing (Phase 2C.1) — the strokes array and raw
 * shapeData are parsed/structurally validated as JSON directly in the
 * Server Action (same pattern as saveMeasurementShapeSchema's shapeData),
 * not validated field-by-field here; this schema covers the plain form
 * fields. See docs/74-custom-service-name-and-multistroke-drawing.md.
 */
export const saveMeasurementPolygonShapeSchema = z.object({
  name: z.string().trim().min(1, "Measurement name is required.").max(160),
  measurementType: measurementTypeSchema,
  unit: measurementUnitSchema,
  scaleReferenceLength: positiveReferenceLength(100000),
  scaleUnit: measurementUnitSchema,
  closed: z.coerce.boolean(),
  wastePercent: percentToBpsSchema,
  notes: optionalText(2000),
});

export const generateMaterialFromMeasurementSchema = z.object({
  materialCatalogItemId: z.string().uuid(),
  measurementValueField: measurementValueFieldSchema,
  coverageRate: positiveDimension(1000000, "Coverage rate"),
  coverageUnit: optionalText(80),
  coats: z.coerce.number().int().min(1).max(20).default(1),
  wastePercent: percentToBpsSchema,
  zipCode: optionalZipCodeSchema,
  sectionId: z.string().uuid().optional(),
  unitPriceCentsOverride: requiredDollarsToCentsSchema.optional(),
});

export const addLaborFromMeasurementSchema = z.object({
  label: z.string().trim().min(1, "Label is required").max(160),
  pricingMethod: laborMeasurementPricingMethodSchema,
  rateCents: requiredDollarsToCentsSchema,
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
