import "server-only";

import { createClient } from "../supabase/server";

/**
 * Fetches the permission keys granted to a system role, for display purposes
 * only (the Phase 0 verification panel on the home page). Authorization
 * decisions must always call user_has_permission()/hasPermission() instead —
 * never infer access from this list.
 */
export async function getActiveRolePermissions(roleKey: string): Promise<string[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("roles")
    .select("role_permissions(permissions(key))")
    .eq("key", roleKey)
    .eq("is_system", true)
    .maybeSingle();

  if (error || !data) return [];

  type RolePermissionRow = { permissions: { key: string } | null };
  const rolePermissions = (data as unknown as { role_permissions: RolePermissionRow[] }).role_permissions ?? [];
  return rolePermissions.map((rp) => rp.permissions?.key).filter((key): key is string => Boolean(key));
}
