import "server-only";

import { createClient } from "../supabase/server";

export type OpportunityOption = { id: string; title: string; clientId: string };

/**
 * Open (not won/lost/archived) opportunities for a <select>, optionally
 * scoped to one client. Used by the "New proposal" flow — an opportunity
 * that already has an active proposal is excluded, since Phase 2A allows
 * only one active proposal per opportunity (see proposals_one_active_per_opportunity).
 */
export async function getOpenOpportunityOptions(tenantId: string, clientId?: string): Promise<OpportunityOption[]> {
  const supabase = await createClient();
  let query = supabase
    .from("opportunities")
    .select("id, title, client_id, proposals!left(id, archived_at)")
    .eq("tenant_id", tenantId)
    .not("status", "in", "(won,lost,archived)")
    .order("title", { ascending: true })
    .limit(200);

  if (clientId) {
    query = query.eq("client_id", clientId);
  }

  const { data } = await query;

  return (data ?? [])
    .filter((o) => {
      const proposals = (o.proposals ?? []) as { id: string; archived_at: string | null }[];
      return !proposals.some((p) => p.archived_at === null);
    })
    .map((o) => ({ id: o.id, title: o.title, clientId: o.client_id }));
}
