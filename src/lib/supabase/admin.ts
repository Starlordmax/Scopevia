import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../../types/database";

/**
 * Service-role client. BYPASSES ROW LEVEL SECURITY ENTIRELY.
 *
 * `import "server-only"` makes any accidental import from a Client Component
 * fail the build rather than leaking the service role key into the browser
 * bundle.
 *
 * Phase 0 does not call this anywhere in the application: every mutation is
 * expressed as a SECURITY DEFINER Postgres function (see
 * supabase/migrations/20260701120700_auth_and_tenant_functions.sql) invoked
 * with the user's own session, which is a narrower, auditable privilege
 * escalation than handing the whole service role to application code. This
 * client is reserved for future server-only integrations (Stripe webhooks,
 * background jobs) that genuinely have no authenticated user in context.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  return createSupabaseClient<Database>(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
