/**
 * Hand-maintained literal unions for columns modeled as `text + check
 * constraint` rather than a native Postgres `enum` type (our consistent
 * choice throughout — see docs/06-security-and-rls.md and every Phase 0/1
 * migration). `supabase gen types` only reflects native enum types, so these
 * are NOT present in the generated `types/database.ts` and must be kept in
 * sync by hand with the corresponding CHECK constraints.
 */

// Phase 0
export type RoleKey = "owner" | "admin" | "estimator" | "sales" | "field_worker" | "viewer";
export type MembershipStatus = "invited" | "active" | "suspended" | "removed";
export type TenantStatus = "active" | "suspended" | "archived";

// Phase 1
export type ClientType = "individual" | "business";
export type PreferredContactMethod = "email" | "phone" | "text";

export const OPPORTUNITY_STATUSES = [
  "new",
  "contacted",
  "qualified",
  "inspection_scheduled",
  "ready_for_estimate",
  "won",
  "lost",
  "archived",
] as const;
export type OpportunityStatus = (typeof OPPORTUNITY_STATUSES)[number];

export const PROJECT_STATUSES = [
  "draft",
  "inspection_pending",
  "inspection_completed",
  "ready_for_estimate",
  "cancelled",
  "archived",
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const CRM_ACTIVITY_TYPES = [
  "note_added",
  "call_logged",
  "email_logged",
  "meeting_logged",
  "inspection_scheduled",
  "status_changed",
  "client_created",
  "client_archived",
  "client_restored",
  "contact_created",
  "contact_primary_changed",
  "contact_archived",
  "contact_restored",
  "opportunity_created",
  "opportunity_won",
  "opportunity_lost",
  "opportunity_archived",
  "opportunity_restored",
  "opportunity_converted_to_project",
  "project_created",
  "project_archived",
  "project_restored",
  "address_primary_changed",
] as const;
export type CrmActivityType = (typeof CRM_ACTIVITY_TYPES)[number];
