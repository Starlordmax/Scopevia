import "server-only";

import { createClient } from "../supabase/server";

export type ActivityItem = {
  id: string;
  activityType: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  actorName: string | null;
};

/**
 * Fetches recent activity either for exactly one parent (client/opportunity/
 * project) or, when `tenantId` is given instead, across the whole tenant —
 * used by the home dashboard's "recent activity" panel. In both cases RLS
 * (crm_activities_select) still filters to only what the caller is actually
 * allowed to see; the tenant-wide mode relies on that rather than an
 * application-level permission check per row.
 */
export async function getActivityFeed(params: {
  tenantId?: string;
  clientId?: string;
  opportunityId?: string;
  projectId?: string;
  limit?: number;
}): Promise<ActivityItem[]> {
  const supabase = await createClient();
  let query = supabase
    .from("crm_activities")
    .select("id, activity_type, metadata, created_at, actor_user_id")
    .order("created_at", { ascending: false })
    .limit(params.limit ?? 20);

  if (params.tenantId) query = query.eq("tenant_id", params.tenantId);
  if (params.clientId) query = query.eq("client_id", params.clientId);
  if (params.opportunityId) query = query.eq("opportunity_id", params.opportunityId);
  if (params.projectId) query = query.eq("project_id", params.projectId);

  const { data: rows } = await query;
  const items = rows ?? [];
  const actorIds = [...new Set(items.map((r) => r.actor_user_id).filter((id): id is string => Boolean(id)))];

  const nameByActorId = new Map<string, string>();
  if (actorIds.length > 0) {
    const { data: profiles } = await supabase.from("profiles").select("id, full_name").in("id", actorIds);
    for (const p of profiles ?? []) {
      if (p.full_name) nameByActorId.set(p.id, p.full_name);
    }
  }

  return items.map((r) => ({
    id: r.id,
    activityType: r.activity_type,
    metadata: (r.metadata ?? {}) as Record<string, unknown>,
    createdAt: r.created_at,
    actorName: r.actor_user_id ? (nameByActorId.get(r.actor_user_id) ?? "Team member") : null,
  }));
}
