import type { ProjectStatus } from "../../../types/enums";

/**
 * Mirrors the transition table enforced in
 * supabase/migrations/20260702130800_crm_functions_projects.sql,
 * change_project_status(). UI-only — see docs/22-phase-1-state-machines.md.
 */
export const PROJECT_TRANSITIONS: Record<ProjectStatus, ProjectStatus[]> = {
  draft: ["inspection_pending", "cancelled"],
  inspection_pending: ["inspection_completed", "cancelled"],
  inspection_completed: ["ready_for_estimate", "inspection_pending", "cancelled"],
  ready_for_estimate: ["inspection_completed", "cancelled"],
  cancelled: ["draft"],
  archived: [],
};

export function projectStatusLabel(status: string): string {
  return status.replace(/_/g, " ");
}
