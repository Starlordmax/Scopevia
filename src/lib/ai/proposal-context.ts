// No "server-only" guard -- pure function, no secrets/I/O (see prompt.ts's comment).

import type { FullProposal } from "../proposals/data";

/**
 * A minimal, structured summary of a proposal for the AI prompt builder —
 * NOT a dump of `FullProposal`. Per docs/10-ai-boundaries.md's data
 * minimization principle: deliberately excludes the client's phone,
 * email, and address (only a display name, needed for a personalized
 * "Notes for client" draft); excludes exact dollar amounts/rates (Terms/
 * Exclusions/Notes don't need pricing precision, only what kinds of work
 * and materials are involved); never includes photo files, only a count.
 */
export type ProposalContextSummary = {
  proposalTitle: string;
  serviceType: string;
  customServiceName: string | null;
  clientDisplayName: string | null;
  scopeSummary: string | null;
  scopeIntro: string | null;
  sectionTitles: string[];
  measurementCount: number;
  measurementNames: string[];
  laborItemCount: number;
  laborLabels: string[];
  materialLineItemCount: number;
  materialCategories: string[];
  currentJobPhotoCount: number;
};

/** Caps how many list items get named individually before falling back to "and N more" -- keeps the prompt small and bounded regardless of proposal size. */
const MAX_LISTED_ITEMS = 12;

function summarizeNames(names: string[]): string[] {
  const unique = Array.from(new Set(names.filter((n) => n.trim().length > 0)));
  if (unique.length <= MAX_LISTED_ITEMS) return unique;
  return [...unique.slice(0, MAX_LISTED_ITEMS), `and ${unique.length - MAX_LISTED_ITEMS} more`];
}

export function buildProposalContextSummary(full: FullProposal): ProposalContextSummary {
  const { proposal, version, sections, laborItems, lineItems, measurements, currentJobMedia } = full;

  return {
    proposalTitle: proposal.title,
    serviceType: proposal.service_type,
    customServiceName: proposal.custom_service_name,
    clientDisplayName: proposal.clients?.display_name ?? null,
    scopeSummary: version.summary || null,
    scopeIntro: version.scope_intro || null,
    sectionTitles: summarizeNames(sections.map((s) => s.title)),
    measurementCount: measurements.length,
    measurementNames: summarizeNames(measurements.map((m) => m.name)),
    laborItemCount: laborItems.length,
    laborLabels: summarizeNames(laborItems.map((l) => l.label)),
    materialLineItemCount: lineItems.length,
    materialCategories: summarizeNames(lineItems.map((l) => l.category)),
    currentJobPhotoCount: currentJobMedia.length,
  };
}
