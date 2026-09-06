// No "server-only" guard -- pure function, no secrets/I/O (see prompt.ts's comment).

import type { Database } from "../../../types/database";
import type { ProposalContextSummary } from "./proposal-context";
import type { AiProposalTextDraft } from "../validation/ai-proposal-text";

type BusinessProfile = Database["public"]["Tables"]["business_profiles"]["Row"];

/**
 * Plain, local, no-API-call draft -- used when OPENROUTER_API_KEY isn't
 * configured (see docs/77-ai-proposal-text-generation.md, "Fallback
 * without AI") so a staging/self-hosted environment is never blocked
 * from using Terms & Pricing just because AI isn't set up. Every
 * business-profile field that's present gets woven in verbatim; anything
 * missing falls back to genuinely generic language, same "never invent a
 * commitment that wasn't provided" rule as the real AI prompt.
 */
export function buildFallbackProposalTextDraft(businessProfile: BusinessProfile, proposalContext: ProposalContextSummary): AiProposalTextDraft {
  const businessName = businessProfile.business_name.trim() || "our company";
  const scopeLine = proposalContext.sectionTitles.length > 0 ? proposalContext.sectionTitles.join(", ") : "the scope listed in this proposal";

  const termsParts = [
    `Work will be performed according to ${scopeLine} as described in this proposal.`,
    businessProfile.default_warranty_policy.trim() || "Workmanship is warranted for a reasonable period from the completion date; specific terms will be confirmed in writing.",
    businessProfile.default_payment_terms.trim() || "Payment terms will be confirmed before work begins.",
    businessProfile.default_deposit_policy.trim(),
    businessProfile.default_change_order_policy.trim() || "Any changes to the scope of work will be documented and agreed upon in writing before proceeding.",
    businessProfile.default_cancellation_policy.trim(),
    businessProfile.default_cleanup_policy.trim(),
    businessProfile.default_materials_policy.trim(),
  ].filter(Boolean);

  const exclusionsParts = [
    "Any work not listed in the scope above is excluded unless approved in writing.",
    businessProfile.default_exclusions.trim(),
  ].filter(Boolean);

  const clientNotesParts = [
    proposalContext.clientDisplayName
      ? `Thank you for considering ${businessName} for this project, ${proposalContext.clientDisplayName}.`
      : `Thank you for considering ${businessName} for this project.`,
    "Please review the proposal and contact us with any questions.",
    businessProfile.default_client_responsibilities.trim(),
  ].filter(Boolean);

  return {
    terms: termsParts.join(" "),
    exclusions: exclusionsParts.join(" "),
    clientNotes: clientNotesParts.join(" "),
    warnings: ["This is a basic template, not an AI-generated draft — AI writing isn't configured for this environment."],
  };
}
