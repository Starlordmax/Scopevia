/**
 * Node-side (never-in-browser) provisioning helpers for the E2E suite.
 *
 * The service role client created here is used ONLY to create/delete
 * throwaway auth users and to read back a membership id for setup
 * convenience. It is never passed to a browser page, never logged, and
 * never used to perform the actions under test (creating a client,
 * changing a status, etc.) — those happen exclusively through the real UI
 * with a real signed-in session, per the brief's explicit constraint.
 *
 * Tenant/membership creation itself goes through the same
 * `create_tenant_with_owner()` / `invite_member_by_email()` /
 * `accept_invitation()` RPCs the app itself uses (via the anon key, signed
 * in as the relevant user) — not direct table writes — so the fixtures are
 * exercising real application logic, identical in spirit to
 * tests/rls/*.test.ts.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const E2E_PASSWORD = "correct-horse-battery-staple-e2e";

export function e2eRunId(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}

export function e2eEmail(runId: string, label: string): string {
  return `e2e-${runId}-${label}@example.com`;
}

export function adminClient(): SupabaseClient {
  const url = process.env.SUPABASE_TEST_URL;
  const key = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_TEST_URL / SUPABASE_TEST_SERVICE_ROLE_KEY must be set in .env.local for E2E provisioning");
  }
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

export function anonClient(): SupabaseClient {
  const url = process.env.SUPABASE_TEST_URL;
  const key = process.env.SUPABASE_TEST_ANON_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_TEST_URL / SUPABASE_TEST_ANON_KEY must be set in .env.local for E2E provisioning");
  }
  return createClient(url, key);
}

export async function createE2EUser(admin: SupabaseClient, email: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({ email, password: E2E_PASSWORD, email_confirm: true });
  if (error || !data.user) throw error ?? new Error(`Failed to create E2E user ${email}`);
  return data.user.id;
}

export async function signInAs(email: string): Promise<SupabaseClient> {
  const client = anonClient();
  const { error } = await client.auth.signInWithPassword({ email, password: E2E_PASSWORD });
  if (error) throw error;
  return client;
}

export async function createTenant(ownerClient: SupabaseClient, name: string, slug: string): Promise<string> {
  const { data, error } = await ownerClient.rpc("create_tenant_with_owner", { p_name: name, p_slug: slug }).single();
  if (error) throw error;
  return (data as { id: string }).id;
}

export async function inviteAndAccept(
  inviterClient: SupabaseClient,
  inviteeClient: SupabaseClient,
  tenantId: string,
  email: string,
  roleKey: string
): Promise<string> {
  const { data, error } = await inviterClient
    .rpc("invite_member_by_email", { p_tenant_id: tenantId, p_email: email, p_role_key: roleKey })
    .single();
  if (error) throw error;
  const membershipId = (data as { id: string }).id;
  const { error: acceptErr } = await inviteeClient.rpc("accept_invitation", { p_membership_id: membershipId });
  if (acceptErr) throw acceptErr;
  return membershipId;
}

export interface E2EManifest {
  runId: string;
  tenantAId: string;
  tenantBId: string;
  tenantAName: string;
  tenantBName: string;
  users: {
    ownerA: { id: string; email: string };
    salesA: { id: string; email: string };
    viewerA: { id: string; email: string };
    fieldWorkerA: { id: string; email: string };
    ownerB: { id: string; email: string };
  };
}
