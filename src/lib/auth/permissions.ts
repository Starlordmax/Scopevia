import "server-only";

import { createClient } from "../supabase/server";
import { PERMISSIONS, type PermissionKey } from "./permission-keys";

export { PERMISSIONS, type PermissionKey };

/**
 * The single source of truth for "can this user do X in this tenant".
 * Always calls user_has_permission() in the database — never infers
 * authorization from a role name or from data cached in the session/cookie.
 */
export async function hasPermission(tenantId: string, permission: PermissionKey): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("user_has_permission", {
    p_tenant_id: tenantId,
    p_permission_key: permission,
  });
  if (error) throw error;
  return Boolean(data);
}

/** Throws if the current user lacks `permission` in `tenantId`. */
export async function requirePermission(tenantId: string, permission: PermissionKey): Promise<void> {
  const allowed = await hasPermission(tenantId, permission);
  if (!allowed) {
    throw new Error(`Missing permission: ${permission}`);
  }
}
