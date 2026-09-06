import "server-only";

import { createClient } from "../supabase/server";

export type ClientOption = { id: string; displayName: string };

/** Active clients for a <select>, capped at a reasonable size for the MVP. */
export async function getClientOptions(tenantId: string, limit = 200): Promise<ClientOption[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("clients")
    .select("id, display_name")
    .eq("tenant_id", tenantId)
    .is("archived_at", null)
    .order("display_name", { ascending: true })
    .limit(limit);

  return (data ?? []).map((c) => ({ id: c.id, displayName: c.display_name }));
}
