import "server-only";

import { createClient } from "../supabase/server";
import type { NoteItem } from "../../components/notes-section";

export async function getNotes(params: {
  clientId?: string;
  opportunityId?: string;
  projectId?: string;
}): Promise<NoteItem[]> {
  const supabase = await createClient();
  let query = supabase
    .from("crm_notes")
    .select("id, body, created_at, created_by")
    .is("archived_at", null)
    .order("created_at", { ascending: false });

  if (params.clientId) query = query.eq("client_id", params.clientId);
  if (params.opportunityId) query = query.eq("opportunity_id", params.opportunityId);
  if (params.projectId) query = query.eq("project_id", params.projectId);

  const { data: rows } = await query;
  const items = rows ?? [];
  const authorIds = [...new Set(items.map((r) => r.created_by))];

  const nameByAuthorId = new Map<string, string>();
  if (authorIds.length > 0) {
    const { data: profiles } = await supabase.from("profiles").select("id, full_name").in("id", authorIds);
    for (const p of profiles ?? []) {
      if (p.full_name) nameByAuthorId.set(p.id, p.full_name);
    }
  }

  return items.map((r) => ({
    id: r.id,
    body: r.body,
    createdAt: r.created_at,
    authorName: nameByAuthorId.get(r.created_by) ?? "Team member",
  }));
}
