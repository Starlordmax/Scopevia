import type { OpportunityStatus } from "../../../types/enums";

/**
 * Mirrors the transition table enforced in
 * supabase/migrations/20260702130700_crm_functions_opportunities.sql,
 * change_opportunity_status(). This copy is for UI purposes ONLY — it
 * decides which buttons to show, never whether a transition is allowed.
 * The database is the actual authority; see docs/22-phase-1-state-machines.md.
 */
export const OPPORTUNITY_TRANSITIONS: Record<OpportunityStatus, OpportunityStatus[]> = {
  new: ["contacted", "lost"],
  contacted: ["qualified", "lost"],
  qualified: ["inspection_scheduled", "ready_for_estimate", "lost"],
  inspection_scheduled: ["qualified", "ready_for_estimate", "lost"],
  ready_for_estimate: ["qualified", "won", "lost"],
  won: [],
  lost: ["contacted", "qualified"],
  archived: [],
};

export function opportunityStatusLabel(status: string): string {
  return status.replace(/_/g, " ");
}
