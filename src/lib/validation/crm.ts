import { z } from "zod";
import { OPPORTUNITY_STATUSES, PROJECT_STATUSES } from "../../../types/enums";

// Shared primitives -----------------------------------------------------

export const clientTypeSchema = z.enum(["individual", "business"]);
export const preferredContactMethodSchema = z.enum(["email", "phone", "text"]);

// Phone/email are intentionally lenient — CRM-006-style "don't block
// legitimate contractors over formatting" per docs/20-phase-1-crm-and-projects.md.
// Just trim and cap length; no format enforcement.
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v === "" ? undefined : v));

export const optionalEmailSchema = z
  .string()
  .trim()
  .max(255)
  .optional()
  .transform((v) => (v === "" ? undefined : v))
  .refine((v) => v === undefined || z.string().email().safeParse(v).success, "Invalid email address");

export const optionalPhoneSchema = optionalText(30);

/** Converts a form's dollars-and-cents text input (e.g. "1,234.50") into integer cents. */
export const dollarsToCentsSchema = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v.replace(/[,$\s]/g, "") : undefined))
  .refine((v) => v === undefined || /^\d+(\.\d{1,2})?$/.test(v), "Enter a valid dollar amount")
  .transform((v) => (v === undefined ? undefined : Math.round(parseFloat(v) * 100)));

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  // Default 20, hard cap 100 — never fetch the whole table into the browser.
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const searchQuerySchema = z
  .string()
  .trim()
  .max(120)
  .optional()
  .transform((v) => (v === "" ? undefined : v));

// Clients -----------------------------------------------------------------

export const createClientSchema = z.object({
  clientType: clientTypeSchema,
  displayName: z.string().trim().min(1, "Display name is required").max(160),
  legalName: optionalText(160),
  firstName: optionalText(80),
  lastName: optionalText(80),
  email: optionalEmailSchema,
  phone: optionalPhoneSchema,
  secondaryPhone: optionalPhoneSchema,
  website: optionalText(255),
  taxExempt: z.coerce.boolean().default(false),
  preferredContactMethod: preferredContactMethodSchema.optional(),
  source: optionalText(80),
});

// Client contacts -----------------------------------------------------------

export const createClientContactSchema = z.object({
  clientId: z.string().uuid(),
  firstName: z.string().trim().min(1, "First name is required").max(80),
  lastName: optionalText(80),
  jobTitle: optionalText(120),
  email: optionalEmailSchema,
  phone: optionalPhoneSchema,
  preferredContactMethod: preferredContactMethodSchema.optional(),
  notes: optionalText(2000),
  isPrimary: z.coerce.boolean().default(false),
});

export const updateClientContactSchema = createClientContactSchema.omit({ clientId: true, isPrimary: true });

// Opportunities ---------------------------------------------------------

export const opportunityStatusSchema = z.enum(OPPORTUNITY_STATUSES);

export const createOpportunitySchema = z.object({
  clientId: z.string().uuid(),
  title: z.string().trim().min(1, "Title is required").max(160),
  source: optionalText(80),
  estimatedValueCents: dollarsToCentsSchema,
  probability: z.coerce.number().int().min(0).max(100).optional(),
  expectedCloseDate: optionalText(10),
  assignedTo: z.string().uuid().optional(),
});

export const updateOpportunitySchema = createOpportunitySchema.omit({ clientId: true });

export const changeOpportunityStatusSchema = z.object({
  newStatus: opportunityStatusSchema,
  lostReason: optionalText(500),
  inspectionScheduledAt: optionalText(40),
});

// Projects ----------------------------------------------------------------

export const projectStatusSchema = z.enum(PROJECT_STATUSES);

export const createProjectSchema = z.object({
  clientId: z.string().uuid(),
  name: z.string().trim().min(1, "Project name is required").max(160),
  serviceType: optionalText(120),
  description: optionalText(4000),
  assignedTo: z.string().uuid().optional(),
  tentativeStartDate: optionalText(10),
});

export const updateProjectSchema = createProjectSchema.omit({ clientId: true }).extend({
  primaryContactId: z.string().uuid().optional(),
});

export const changeProjectStatusSchema = z.object({
  newStatus: projectStatusSchema,
  inspectionScheduledAt: optionalText(40),
});

export const convertOpportunitySchema = z.object({
  projectName: optionalText(160),
  serviceType: optionalText(120),
  description: optionalText(4000),
});

// Project addresses ---------------------------------------------------------

export const usStateSchema = z.string().trim().min(2, "State is required").max(40);
export const postalCodeSchema = z
  .string()
  .trim()
  .min(3, "Postal code is required")
  .max(12)
  .regex(/^[A-Za-z0-9 -]{3,12}$/, "Enter a valid postal code");

export const createProjectAddressSchema = z.object({
  projectId: z.string().uuid(),
  addressLine1: z.string().trim().min(1, "Address is required").max(200),
  addressLine2: optionalText(200),
  city: z.string().trim().min(1, "City is required").max(100),
  state: usStateSchema,
  postalCode: postalCodeSchema,
  countryCode: z.string().trim().length(2).default("US"),
  accessInstructions: optionalText(2000),
  isPrimary: z.coerce.boolean().default(false),
});

export const updateProjectAddressSchema = createProjectAddressSchema.omit({ projectId: true, isPrimary: true });

// Notes -----------------------------------------------------------------

export const createNoteSchema = z
  .object({
    body: z.string().trim().min(1, "Note cannot be empty").max(4000),
    clientId: z.string().uuid().optional(),
    opportunityId: z.string().uuid().optional(),
    projectId: z.string().uuid().optional(),
  })
  .refine((data) => [data.clientId, data.opportunityId, data.projectId].filter(Boolean).length === 1, {
    message: "A note must be attached to exactly one of client/opportunity/project",
  });

export const updateNoteSchema = z.object({
  body: z.string().trim().min(1, "Note cannot be empty").max(4000),
});
