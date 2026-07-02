import "server-only";

import { createClient } from "../supabase/server";

export type AssignableMember = { membershipId: string; name: string };

/**
 * Active members of a tenant, for an "assignee" <select>. Naturally scoped by
 * RLS: a caller without members.view only ever sees their OWN membership row
 * (tenant_memberships_select allows `user_id = auth.uid()` unconditionally),
 * so e.g. a Sales rep without members.view still gets a working dropdown —
 * it just only offers themselves, rather than erroring.
 */
export async function getAssignableMembers(tenantId: string): Promise<AssignableMember[]> {
  const supabase = await createClient();
  const { data: memberships } = await supabase
    .from("tenant_memberships")
    .select("id, user_id")
    .eq("tenant_id", tenantId)
    .eq("status", "active");

  const rows = memberships ?? [];
  if (rows.length === 0) return [];

  const userIds = rows.map((r) => r.user_id);
  const { data: profiles } = await supabase.from("profiles").select("id, full_name").in("id", userIds);
  const nameByUserId = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));

  return rows
    .map((r) => ({ membershipId: r.id, name: nameByUserId.get(r.user_id) || "Unnamed member" }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
