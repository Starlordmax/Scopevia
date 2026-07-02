import "server-only";

import { createClient } from "../supabase/server";
import type { Json } from "../../../types/database";

export type AuditAction =
  | "auth.signed_in"
  | "auth.signed_out"
  | "tenant.created"
  | "tenant.updated"
  | "membership.created"
  | "membership.activated"
  | "membership.suspended"
  | "membership.removed"
  | "membership.role_assigned"
  | "membership.role_removed"
  | "profile.updated";

type LogAuditEventInput = {
  tenantId: string | null;
  actorUserId: string | null;
  action: AuditAction;
  entityType: string;
  entityId: string;
  metadata?: Record<string, unknown>;
};

/**
 * Best-effort, application-layer audit logging for events that don't belong
 * to a single DB transaction — chiefly auth sign-in/out, which Supabase Auth
 * handles internally. Never throws: a logging failure must not block the
 * user-facing action it describes.
 *
 * Contrast with sensitive tenant/membership actions, which call
 * log_audit_event() FROM WITHIN the same SQL transaction as the action (see
 * create_tenant_with_owner / update_membership in
 * supabase/migrations/20260701120700_auth_and_tenant_functions.sql) so their
 * audit trail can never silently go missing.
 */
export async function logAuditEvent(input: LogAuditEventInput): Promise<void> {
  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc("log_audit_event", {
      p_tenant_id: input.tenantId,
      p_actor_user_id: input.actorUserId,
      p_action: input.action,
      p_entity_type: input.entityType,
      p_entity_id: input.entityId,
      // Our metadata objects are always small, plain, JSON-serializable
      // structures (see the "no secrets/tokens/payloads" rule documented on
      // AuditAction above) — Record<string, unknown> isn't structurally a
      // Json, so this narrow cast reflects that guarantee rather than
      // widening the input type for every caller.
      p_metadata: (input.metadata ?? {}) as Json,
    });
    if (error) throw error;
  } catch (err) {
    console.error("[audit] non-blocking failure logging", input.action, err);
  }
}
