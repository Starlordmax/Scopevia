import "server-only";

import { createClient } from "../supabase/server";

export type ContactOption = { id: string; name: string };

/** A client's active contacts for a <select>. */
export async function getContactOptions(tenantId: string, clientId: string): Promise<ContactOption[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("client_contacts")
    .select("id, first_name, last_name")
    .eq("tenant_id", tenantId)
    .eq("client_id", clientId)
    .is("archived_at", null)
    .order("first_name", { ascending: true });

  return (data ?? []).map((c) => ({ id: c.id, name: [c.first_name, c.last_name].filter(Boolean).join(" ") }));
}
