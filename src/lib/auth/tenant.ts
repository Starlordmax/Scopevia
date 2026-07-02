import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "../supabase/server";
import { pickActiveTenant } from "./pick-active-tenant";
import type { Database } from "../../../types/database";

export const ACTIVE_TENANT_COOKIE = "scopevia_active_tenant";

type GetUserTenantsRow = Database["public"]["Functions"]["get_user_tenants"]["Returns"][number];
export type UserTenant = GetUserTenantsRow;

/**
 * The authoritative list of tenants the CURRENT session's user belongs to.
 * Backed by get_user_tenants(), which filters by auth.uid() inside the
 * database — there is no code path where a client-supplied value decides
 * which tenants come back.
 */
export async function getUserTenants(): Promise<UserTenant[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_user_tenants");
  if (error) throw error;
  return data ?? [];
}

/**
 * Resolves the "active tenant" for this request.
 *
 * The cookie is only a *hint* about which tenant the user last chose — it
 * never grants access by itself. Every call re-derives the authoritative
 * tenant list from the database and only accepts the cookie's tenant id if
 * it is actually present in that list. Editing the cookie by hand cannot
 * grant access to a tenant you are not an active member of; at worst it
 * causes a fallback to your first valid tenant or to the selector.
 */
export async function resolveActiveTenant(): Promise<{ tenant: UserTenant | null; tenants: UserTenant[] }> {
  const tenants = await getUserTenants();
  const cookieStore = await cookies();
  const cookieTenantId = cookieStore.get(ACTIVE_TENANT_COOKIE)?.value;

  const active = pickActiveTenant(tenants, cookieTenantId);

  return { tenant: active, tenants };
}

/**
 * Guarantees an active tenant for protected pages. Whenever there isn't one
 * — no active memberships at all, or a stale/manipulated cookie pointing at
 * a tenant that's no longer valid — control always goes to /select-tenant,
 * which is the single place that decides between "show your tenants",
 * "show your pending invitations", or "send you to onboarding" (see
 * src/app/select-tenant/page.tsx). This function never redirects to
 * /onboarding directly, so that decision isn't duplicated in two places.
 */
export async function requireActiveTenant(): Promise<{ tenant: UserTenant; tenants: UserTenant[] }> {
  const { tenant, tenants } = await resolveActiveTenant();
  if (!tenant) {
    redirect("/select-tenant");
  }
  return { tenant, tenants };
}

export function activeTenantCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  };
}
