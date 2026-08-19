import "server-only";

import { createClient } from "../supabase/server";
import type { Database } from "../../../types/database";

export type BusinessProfile = Database["public"]["Tables"]["business_profiles"]["Row"];

/**
 * Permission-checked (tenant.view, inside get_business_profile()),
 * idempotent get-or-create -- safe to call on every Profile page load and
 * from the AI generation Server Action. Returns null only on an RPC
 * error (e.g. missing permission); the RPC itself never returns "no
 * row" for a valid tenant, since it creates one on first call.
 */
export async function getBusinessProfile(tenantId: string): Promise<BusinessProfile | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_business_profile", { p_tenant_id: tenantId }).single();
  if (error || !data) return null;
  return data as BusinessProfile;
}
