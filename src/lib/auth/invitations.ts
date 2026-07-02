import "server-only";

import { createClient } from "../supabase/server";

export type PendingInvitation = {
  membership_id: string;
  tenant_id: string;
  tenant_name: string;
  role_name: string;
  invited_at: string;
};

/** Pending (status=invited) memberships for the current session's user. */
export async function getPendingInvitations(): Promise<PendingInvitation[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_pending_invitations");
  if (error) throw error;
  return data ?? [];
}
