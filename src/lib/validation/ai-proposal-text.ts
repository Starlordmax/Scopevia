import { z } from "zod";
import { tonePreferenceSchema } from "./business-profile";

export const aiFeatureSchema = z.enum(["terms", "exclusions", "client_notes", "all"], {
  message: "Please choose what to generate.",
});
export type AiFeature = z.infer<typeof aiFeatureSchema>;

export const aiLengthSchema = z.enum(["short", "standard", "detailed"], { message: "Please choose a length." });

/** What the "Generate" form on Terms & Pricing submits — parsed from FormData in the Server Action. */
export const generateProposalTextRequestSchema = z.object({
  proposalId: z.string().uuid(),
  proposalVersionId: z.string().uuid(),
  feature: aiFeatureSchema,
  tone: tonePreferenceSchema.optional(),
  length: aiLengthSchema.default("standard"),
  includeWarranty: z.coerce.boolean().default(true),
  includePaymentTerms: z.coerce.boolean().default(true),
  includeExclusions: z.coerce.boolean().default(true),
  includeClientResponsibilities: z.coerce.boolean().default(true),
});
export type GenerateProposalTextRequest = z.infer<typeof generateProposalTextRequestSchema>;

/**
 * The strict JSON shape asked of the model (see src/lib/ai/prompt.ts) and
 * validated on the way back in src/lib/ai/openrouter.ts. `warnings` is
 * for the model to flag anything it deliberately left generic because the
 * business profile didn't provide it (e.g. no warranty policy on file) --
 * surfaced to the user, never silently dropped.
 */
export const aiProposalTextDraftSchema = z.object({
  terms: z.string().max(6000).default(""),
  exclusions: z.string().max(6000).default(""),
  clientNotes: z.string().max(6000).default(""),
  warnings: z.array(z.string().max(500)).max(20).default([]),
});
export type AiProposalTextDraft = z.infer<typeof aiProposalTextDraftSchema>;
