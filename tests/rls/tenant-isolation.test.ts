/**
 * Integration tests proving tenant isolation, RLS enforcement, permission
 * checks, invitation consent, owner protection (including under
 * concurrency), cross-tenant role guards, tenant-creation idempotency and
 * audit-log integrity — against a REAL Postgres/Supabase instance, not
 * mocks.
 *
 * Requires SUPABASE_TEST_URL / SUPABASE_TEST_ANON_KEY /
 * SUPABASE_TEST_SERVICE_ROLE_KEY in .env.local, pointing at a project
 * DEDICATED TO TESTING (never staging/production — see
 * docs/17-rls-verification.md and docs/18-phase-0-security-hardening.md).
 * If those env vars are absent, the whole suite is skipped, not failed.
 *
 * Fixture: Tenant A (owner: userA), Tenant B (owner: userB). userC and
 * userD are invited to Tenant A as viewer/admin respectively and accept
 * their own invitations early in the suite. userE is invited to Tenant A
 * and deliberately left pending throughout. userF is a throwaway used only
 * for the concurrent-tenant-creation test.
 *
 * Ordering matters: tests that mutate shared fixture state (suspension,
 * removal, the last-owner concurrency race) are grouped at the end, after
 * every test that depends on the original fixture shape has already run.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });

const TEST_URL = process.env.SUPABASE_TEST_URL;
const TEST_SERVICE_ROLE_KEY = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY;
const TEST_ANON_KEY = process.env.SUPABASE_TEST_ANON_KEY;

const canRun = Boolean(TEST_URL && TEST_SERVICE_ROLE_KEY && TEST_ANON_KEY);
const PASSWORD = "correct-horse-battery-staple";
const RUN_ID = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;

function email(label: string): string {
  return `test-${label}-${RUN_ID}@example.com`;
}

async function signIn(email: string): Promise<SupabaseClient> {
  const client = createClient(TEST_URL!, TEST_ANON_KEY!);
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw error;
  return client;
}

type TestUser = { id: string; email: string };

describe.skipIf(!canRun)("Phase 0 security hardening (requires real Postgres)", () => {
  let admin: SupabaseClient;

  let userA: TestUser, userB: TestUser, userC: TestUser;
  let userD: TestUser, userE: TestUser, userF: TestUser;
  let aClient: SupabaseClient, bClient: SupabaseClient, cClient: SupabaseClient;
  let dClient: SupabaseClient, eClient: SupabaseClient, fClient: SupabaseClient;

  let tenantAId: string, tenantBId: string;
  let aOwnerMembershipId: string;
  let cMembershipId: string, dMembershipId: string, eMembershipId: string;

  const allUserIds: string[] = [];
  const extraTenantIds: string[] = [];
  const extraRoleIds: string[] = [];

  beforeAll(async () => {
    admin = createClient(TEST_URL!, TEST_SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    async function createUser(label: string) {
      const addr = email(label);
      const { data, error } = await admin.auth.admin.createUser({
        email: addr,
        password: PASSWORD,
        email_confirm: true,
      });
      if (error || !data.user) throw error ?? new Error(`Failed to create ${label}`);
      allUserIds.push(data.user.id);
      return { id: data.user.id, email: addr };
    }

    userA = await createUser("a-owner");
    userB = await createUser("b-owner");
    userC = await createUser("c-viewer");
    userD = await createUser("d-admin");
    userE = await createUser("e-pending");
    userF = await createUser("f-throwaway");

    [aClient, bClient, cClient, dClient, eClient, fClient] = await Promise.all([
      signIn(userA.email),
      signIn(userB.email),
      signIn(userC.email),
      signIn(userD.email),
      signIn(userE.email),
      signIn(userF.email),
    ]);

    const { data: tenantA, error: tErrA } = await aClient
      .rpc("create_tenant_with_owner", { p_name: "Tenant A Painting", p_slug: `tenant-a-${RUN_ID}` })
      .single();
    if (tErrA) throw tErrA;
    tenantAId = (tenantA as { id: string }).id;

    const { data: tenantB, error: tErrB } = await bClient
      .rpc("create_tenant_with_owner", { p_name: "Tenant B Painting", p_slug: `tenant-b-${RUN_ID}` })
      .single();
    if (tErrB) throw tErrB;
    tenantBId = (tenantB as { id: string }).id;

    const { data: aMembershipRow } = await admin
      .from("tenant_memberships")
      .select("id")
      .eq("tenant_id", tenantAId)
      .eq("user_id", userA.id)
      .single();
    aOwnerMembershipId = (aMembershipRow as { id: string }).id;

    const invite = (client: SupabaseClient, targetEmail: string, role: string) =>
      client
        .rpc("invite_member_by_email", { p_tenant_id: tenantAId, p_email: targetEmail, p_role_key: role })
        .single();

    const { data: cInvite, error: cInviteErr } = await invite(aClient, userC.email, "viewer");
    if (cInviteErr) throw cInviteErr;
    cMembershipId = (cInvite as { id: string }).id;

    const { data: dInvite, error: dInviteErr } = await invite(aClient, userD.email, "admin");
    if (dInviteErr) throw dInviteErr;
    dMembershipId = (dInvite as { id: string }).id;

    const { data: eInvite, error: eInviteErr } = await invite(aClient, userE.email, "viewer");
    if (eInviteErr) throw eInviteErr;
    eMembershipId = (eInvite as { id: string }).id;
  });

  afterAll(async () => {
    for (const id of allUserIds) {
      await admin.auth.admin.deleteUser(id).catch(() => {});
    }
    for (const id of [tenantAId, tenantBId, ...extraTenantIds]) {
      if (!id) continue;
      try {
        await admin.from("tenants").delete().eq("id", id);
      } catch {
        // best-effort cleanup
      }
    }
    for (const id of extraRoleIds) {
      try {
        await admin.from("roles").delete().eq("id", id);
      } catch {
        // best-effort cleanup
      }
    }
  });

  // ===========================================================================
  // Invitations — must run before C/D are treated as active members elsewhere
  // ===========================================================================
  describe("Invitations", () => {
    it("an invited (not yet accepted) membership grants ZERO access", async () => {
      const { data } = await cClient.from("tenants").select("*").eq("id", tenantAId);
      expect(data ?? []).toHaveLength(0);
    });

    it("get_pending_invitations() shows the invite to the invited user only", async () => {
      const { data: cPending } = await cClient.rpc("get_pending_invitations");
      expect(cPending?.some((i: { membership_id: string }) => i.membership_id === cMembershipId)).toBe(true);

      const { data: dPending } = await dClient.rpc("get_pending_invitations");
      expect(dPending?.some((i: { membership_id: string }) => i.membership_id === cMembershipId)).toBe(false);
    });

    it("a user cannot accept someone else's invitation", async () => {
      const { error } = await cClient.rpc("accept_invitation", { p_membership_id: eMembershipId });
      expect(error).not.toBeNull();
    });

    it("an admin/owner cannot force-activate a pending invitation on the invited user's behalf", async () => {
      const { error } = await aClient.rpc("update_membership", {
        p_membership_id: eMembershipId,
        p_new_status: "active",
        p_new_role_key: null,
      });
      expect(error).not.toBeNull();
      expect(error?.message).toMatch(/accept_invitation/i);
    });

    it("the invited user accepts their own invitation and immediately gains access", async () => {
      const { error: acceptErr } = await cClient.rpc("accept_invitation", { p_membership_id: cMembershipId });
      expect(acceptErr).toBeNull();

      const { data } = await cClient.from("tenants").select("*").eq("id", tenantAId);
      expect(data).toHaveLength(1);

      const { error: dAcceptErr } = await dClient.rpc("accept_invitation", { p_membership_id: dMembershipId });
      expect(dAcceptErr).toBeNull();
    });

    it("owner can cancel a still-pending invitation", async () => {
      const { error } = await aClient.rpc("update_membership", {
        p_membership_id: eMembershipId,
        p_new_status: "removed",
        p_new_role_key: null,
      });
      expect(error).toBeNull();
    });
  });

  // ===========================================================================
  // Read isolation
  // ===========================================================================
  describe("Read isolation", () => {
    it("User A can read Tenant A", async () => {
      const { data } = await aClient.from("tenants").select("*").eq("id", tenantAId);
      expect(data).toHaveLength(1);
    });

    it("User A cannot read Tenant B", async () => {
      const { data } = await aClient.from("tenants").select("*").eq("id", tenantBId);
      expect(data ?? []).toHaveLength(0);
    });

    it("User B cannot read Tenant A", async () => {
      const { data } = await bClient.from("tenants").select("*").eq("id", tenantAId);
      expect(data ?? []).toHaveLength(0);
    });

    it("Viewer (C) is an active member but CANNOT list tenant members (no members.view)", async () => {
      const { data } = await cClient.from("tenant_memberships").select("*").eq("tenant_id", tenantAId);
      // RLS still returns C's own row (user_id = auth.uid() branch), never the others.
      expect((data ?? []).every((m: { user_id: string }) => m.user_id === userC.id)).toBe(true);
    });

    it("Admin (D) CAN list tenant members (has members.view)", async () => {
      const { data } = await dClient.from("tenant_memberships").select("*").eq("tenant_id", tenantAId);
      const userIds = (data ?? []).map((m: { user_id: string }) => m.user_id);
      expect(userIds).toEqual(expect.arrayContaining([userA.id, userC.id, userD.id]));
    });

    it("no global membership enumeration: User A never sees Tenant B's memberships in an unfiltered query", async () => {
      const { data } = await aClient.from("tenant_memberships").select("tenant_id");
      expect((data ?? []).every((m: { tenant_id: string }) => m.tenant_id === tenantAId)).toBe(true);
    });

    it("no global profile enumeration: User A cannot see User B's profile (no shared tenant)", async () => {
      const { data } = await aClient.from("profiles").select("id").eq("id", userB.id);
      expect(data ?? []).toHaveLength(0);
    });

    it("an unauthenticated (anon) request cannot read any tenant", async () => {
      const anonClient = createClient(TEST_URL!, TEST_ANON_KEY!);
      const { data } = await anonClient.from("tenants").select("*");
      expect(data ?? []).toHaveLength(0);
    });
  });

  // ===========================================================================
  // Write isolation
  // ===========================================================================
  describe("Write isolation", () => {
    it("User A cannot update Tenant B", async () => {
      const { data, error } = await aClient.from("tenants").update({ name: "hacked by A" }).eq("id", tenantBId).select();
      expect(error).toBeNull();
      expect(data ?? []).toHaveLength(0);
    });

    it("Viewer (C) cannot update Tenant A (no tenant.update)", async () => {
      const { data, error } = await cClient
        .from("tenants")
        .update({ name: "hacked by viewer" })
        .eq("id", tenantAId)
        .select();
      expect(error).toBeNull();
      expect(data ?? []).toHaveLength(0);
    });

    it("Admin (D) CAN update Tenant A (has tenant.update)", async () => {
      const { data, error } = await dClient
        .from("tenants")
        .update({ name: "Tenant A Painting (renamed by admin)" })
        .eq("id", tenantAId)
        .select();
      expect(error).toBeNull();
      expect(data ?? []).toHaveLength(1);
      // Restore, so later assertions/logging aren't confused by the rename.
      await aClient.from("tenants").update({ name: "Tenant A Painting" }).eq("id", tenantAId);
    });

    it("no client can insert audit_logs directly", async () => {
      const { error } = await aClient.from("audit_logs").insert({
        tenant_id: tenantAId,
        actor_user_id: userA.id,
        action: "fake.event",
        entity_type: "tenant",
        entity_id: tenantAId,
      });
      expect(error).not.toBeNull();
    });

    it("no client can insert tenant_memberships directly", async () => {
      // role_id is a placeholder — the INSERT is denied at the grant level
      // before any FK/trigger validation of its value would even run.
      const { error } = await aClient.from("tenant_memberships").insert({
        tenant_id: tenantAId,
        user_id: userF.id,
        role_id: "00000000-0000-0000-0000-000000000000",
        status: "active",
      });
      expect(error).not.toBeNull();
    });

    it("no client can modify system roles", async () => {
      // No UPDATE policy exists on `roles` for `authenticated`, so RLS's
      // USING clause is unconditionally false for this command — Postgres
      // reports success with zero rows matched rather than a hard error
      // (the same shape as the cross-tenant `tenants` update tests above).
      const { data, error } = await aClient.from("roles").update({ name: "Hacked Owner" }).eq("key", "owner").select();
      expect(error).toBeNull();
      expect(data ?? []).toHaveLength(0);

      const { data: unchanged } = await admin.from("roles").select("name").eq("key", "owner").single();
      expect((unchanged as { name: string }).name).toBe("Owner");
    });

    it("no client can insert directly into a system role's role_permissions", async () => {
      // Placeholder ids — the INSERT is denied at the grant level regardless.
      const { error } = await aClient.from("role_permissions").insert({
        role_id: "00000000-0000-0000-0000-000000000000",
        permission_id: "00000000-0000-0000-0000-000000000000",
      });
      expect(error).not.toBeNull();
    });

    it("no user can grant themselves the owner role via update_membership (self-modification block)", async () => {
      const { error } = await aClient.rpc("update_membership", {
        p_membership_id: aOwnerMembershipId,
        p_new_status: null,
        p_new_role_key: "owner",
      });
      expect(error).not.toBeNull();
      expect(error?.message).toMatch(/cannot modify your own membership/i);
    });
  });

  // ===========================================================================
  // Owner protection (non-concurrent)
  // ===========================================================================
  describe("Owner protection", () => {
    it("Admin (D) cannot modify Owner (A)'s membership at all", async () => {
      const { error } = await dClient.rpc("update_membership", {
        p_membership_id: aOwnerMembershipId,
        p_new_status: "suspended",
        p_new_role_key: null,
      });
      expect(error).not.toBeNull();
      expect(error?.message).toMatch(/only an owner/i);
    });

    it("granting the owner role requires roles.manage — Admin (D) cannot promote Viewer (C) to owner", async () => {
      const { error } = await dClient.rpc("update_membership", {
        p_membership_id: cMembershipId,
        p_new_status: null,
        p_new_role_key: "owner",
      });
      expect(error).not.toBeNull();
      expect(error?.message).toMatch(/only an owner can grant the owner role/i);
    });

    it("Viewer (C) cannot modify any membership (no members.update/remove)", async () => {
      const { error } = await cClient.rpc("update_membership", {
        p_membership_id: dMembershipId,
        p_new_status: "suspended",
        p_new_role_key: null,
      });
      expect(error).not.toBeNull();
    });
  });

  // ===========================================================================
  // Cross-tenant role guard
  // ===========================================================================
  describe("Cross-tenant role guard", () => {
    it("a duplicate SYSTEM role key is rejected (partial unique index)", async () => {
      const { error } = await admin.from("roles").insert({ key: "owner", name: "Duplicate Owner", is_system: true });
      expect(error).not.toBeNull();
      expect(error?.code).toBe("23505");
    });

    it("two DIFFERENT tenants can each have a custom role with the SAME key without conflict", async () => {
      const { data: roleA, error: errA } = await admin
        .from("roles")
        .insert({ key: "foreman", name: "Foreman", is_system: false, tenant_id: tenantAId })
        .select()
        .single();
      expect(errA).toBeNull();
      extraRoleIds.push((roleA as { id: string }).id);

      const { data: roleB, error: errB } = await admin
        .from("roles")
        .insert({ key: "foreman", name: "Foreman", is_system: false, tenant_id: tenantBId })
        .select()
        .single();
      expect(errB).toBeNull();
      extraRoleIds.push((roleB as { id: string }).id);
    });

    it("a Tenant A custom role cannot be assigned to a Tenant B membership", async () => {
      // Deliberately NOT Tenant B's owner: assigning a non-owner role there
      // would also (correctly) trip protect_last_owner, which fires before
      // this guard and would mask which check actually rejected the change.
      // userF is invited as a plain (non-owner) Tenant B member instead, to
      // isolate the cross-tenant role guard from the last-owner guard.
      const { data: fInvite, error: fInviteErr } = await bClient
        .rpc("invite_member_by_email", { p_tenant_id: tenantBId, p_email: userF.email, p_role_key: "viewer" })
        .single();
      expect(fInviteErr).toBeNull();
      const fMembershipInB = (fInvite as { id: string }).id;

      const tenantARole = extraRoleIds[0];
      const { error } = await admin
        .from("tenant_memberships")
        .update({ role_id: tenantARole })
        .eq("id", fMembershipInB);

      expect(error).not.toBeNull();
      expect(error?.message).toMatch(/does not belong to tenant/i);
    });
  });

  // ===========================================================================
  // Tenant creation idempotency & concurrency
  // ===========================================================================
  describe("Tenant creation idempotency", () => {
    it("a duplicate slug is rejected with no orphan tenant created", async () => {
      const slug = `tenant-a-${RUN_ID}`; // same slug Tenant A already used
      const { count: before } = await admin.from("tenants").select("*", { count: "exact", head: true }).eq("slug", slug);

      const { error } = await bClient.rpc("create_tenant_with_owner", { p_name: "Duplicate Slug Attempt", p_slug: slug });
      expect(error).not.toBeNull();

      const { count: after } = await admin.from("tenants").select("*", { count: "exact", head: true }).eq("slug", slug);
      expect(after).toBe(before);
    });

    it("two concurrent tenant creations with the SAME slug: exactly one succeeds, no orphaned membership", async () => {
      const slug = `tenant-race-${RUN_ID}`;
      const [r1, r2] = await Promise.all([
        fClient.rpc("create_tenant_with_owner", { p_name: "Race Tenant (F)", p_slug: slug }),
        eClient.rpc("create_tenant_with_owner", { p_name: "Race Tenant (E)", p_slug: slug }),
      ]);

      const results = [r1, r2];
      const succeeded = results.filter((r) => !r.error);
      const failed = results.filter((r) => r.error);
      expect(succeeded).toHaveLength(1);
      expect(failed).toHaveLength(1);

      const { data: tenantRows } = await admin.from("tenants").select("id").eq("slug", slug);
      expect(tenantRows).toHaveLength(1);
      const winningTenantId = (tenantRows as { id: string }[])[0]?.id;
      expect(winningTenantId).toBeDefined();
      extraTenantIds.push(winningTenantId as string);

      const { data: memberships } = await admin
        .from("tenant_memberships")
        .select("id, status, role_id")
        .eq("tenant_id", winningTenantId as string);
      expect(memberships).toHaveLength(1);
      expect((memberships as { status: string }[])[0]?.status).toBe("active");
    });
  });

  // ===========================================================================
  // Audit log integrity
  // ===========================================================================
  describe("Audit log integrity", () => {
    it("audit_logs cannot be updated, even via service_role (trigger, not just RLS)", async () => {
      const { data: anyLog } = await admin.from("audit_logs").select("id").eq("tenant_id", tenantAId).limit(1).single();
      const { error } = await admin.from("audit_logs").update({ action: "tampered" }).eq("id", (anyLog as { id: string }).id);
      expect(error).not.toBeNull();
      expect(error?.message).toMatch(/append-only/i);
    });

    it("audit_logs cannot be deleted, even via service_role", async () => {
      const { data: anyLog } = await admin.from("audit_logs").select("id").eq("tenant_id", tenantAId).limit(1).single();
      const { error } = await admin.from("audit_logs").delete().eq("id", (anyLog as { id: string }).id);
      expect(error).not.toBeNull();
      expect(error?.message).toMatch(/append-only/i);
    });

    it("Tenant A user cannot read Tenant B's audit logs", async () => {
      const { data } = await aClient.from("audit_logs").select("*").eq("tenant_id", tenantBId);
      expect(data ?? []).toHaveLength(0);
    });

    it("sensitive actions were logged transactionally (tenant.created, membership.role_assigned)", async () => {
      const { data } = await aClient
        .from("audit_logs")
        .select("action")
        .eq("tenant_id", tenantAId)
        .in("action", ["tenant.created", "membership.role_assigned", "membership.created", "membership.activated"]);
      const actions = (data ?? []).map((r: { action: string }) => r.action);
      expect(actions).toEqual(
        expect.arrayContaining(["tenant.created", "membership.role_assigned", "membership.created", "membership.activated"])
      );
    });

    it("audit metadata never contains password/token/secret-shaped values", async () => {
      const { data } = await aClient.from("audit_logs").select("metadata").eq("tenant_id", tenantAId);
      for (const row of data ?? []) {
        const serialized = JSON.stringify((row as { metadata: unknown }).metadata).toLowerCase();
        expect(serialized).not.toMatch(/password|"token"|secret|service_role/);
      }
    });
  });

  // ===========================================================================
  // Suspension & removal — MUTATES FIXTURE STATE, keep near the end
  // ===========================================================================
  describe("Suspension & removal revoke access immediately", () => {
    it("suspending Viewer (C) immediately blocks their EXISTING session — no re-login needed", async () => {
      const { error: suspendErr } = await aClient.rpc("update_membership", {
        p_membership_id: cMembershipId,
        p_new_status: "suspended",
        p_new_role_key: null,
      });
      expect(suspendErr).toBeNull();

      // cClient's JWT is untouched — this proves RLS re-evaluates membership
      // status on every request rather than trusting a cached session claim.
      const { data } = await cClient.from("tenants").select("*").eq("id", tenantAId);
      expect(data ?? []).toHaveLength(0);
    });

    it("a suspended user cannot reactivate their own membership", async () => {
      const { error } = await cClient.rpc("update_membership", {
        p_membership_id: cMembershipId,
        p_new_status: "active",
        p_new_role_key: null,
      });
      expect(error).not.toBeNull();
      expect(error?.message).toMatch(/cannot modify your own membership/i);
    });

    it("removing Admin (D) immediately blocks their EXISTING session", async () => {
      const { error: removeErr } = await aClient.rpc("update_membership", {
        p_membership_id: dMembershipId,
        p_new_status: "removed",
        p_new_role_key: null,
      });
      expect(removeErr).toBeNull();

      const { data } = await dClient.from("tenants").select("*").eq("id", tenantAId);
      expect(data ?? []).toHaveLength(0);
    });
  });

  // ===========================================================================
  // Last-owner protection under concurrency — MUTATES FIXTURE STATE, run last
  // ===========================================================================
  describe("Last-owner protection under concurrency", () => {
    it("exactly one of two concurrent demotions of the two owners is rejected — never both succeed", async () => {
      // Promote (still-suspended, but role change is independent of status)
      // C to co-owner so Tenant A has exactly two owners for this test.
      const { error: promoteErr } = await aClient.rpc("update_membership", {
        p_membership_id: cMembershipId,
        p_new_status: null,
        p_new_role_key: "owner",
      });
      expect(promoteErr).toBeNull();
      // Reactivate C so they count as an ACTIVE owner.
      await admin.from("tenant_memberships").update({ status: "active" }).eq("id", cMembershipId);

      // Each owner can only demote the OTHER (self-modification is always
      // blocked), so fire both cross-demotions at the same time.
      const [r1, r2] = await Promise.all([
        aClient.rpc("update_membership", { p_membership_id: cMembershipId, p_new_status: "suspended", p_new_role_key: null }),
        cClient.rpc("update_membership", {
          p_membership_id: aOwnerMembershipId,
          p_new_status: "suspended",
          p_new_role_key: null,
        }),
      ]);

      const outcomes = [r1, r2];
      const succeeded = outcomes.filter((r) => !r.error);
      const failed = outcomes.filter((r) => r.error);

      // The critical invariant — regardless of which one wins the race,
      // EXACTLY one must be rejected. It can be rejected for either of two
      // equally valid reasons depending on commit order: (a) protect_last_owner()
      // catches it directly ("at least one active owner"), or (b) if the
      // OTHER demotion commits first, the loser's own membership is no
      // longer active by the time their call evaluates user_has_permission()
      // for the "only an owner can modify another owner" check, so they lose
      // roles.manage first and are rejected one step earlier. Both outcomes
      // prove the same thing: it is impossible for both demotions to succeed.
      expect(succeeded).toHaveLength(1);
      expect(failed).toHaveLength(1);
      expect(failed[0]?.error?.message).toMatch(/at least one active owner|only an owner can modify/i);

      const { data: remainingOwners } = await admin
        .from("tenant_memberships")
        .select("id")
        .eq("tenant_id", tenantAId)
        .eq("status", "active")
        .in("id", [aOwnerMembershipId, cMembershipId]);
      expect(remainingOwners).toHaveLength(1);

      // Restore both to active owners so teardown (deleting the tenant) is
      // unaffected by which one is currently suspended.
      await admin
        .from("tenant_memberships")
        .update({ status: "active" })
        .in("id", [aOwnerMembershipId, cMembershipId]);
    });

    it("a direct service_role UPDATE also cannot leave a tenant without an active owner (trigger holds regardless of caller)", async () => {
      const { error } = await admin.from("tenant_memberships").update({ status: "removed" }).eq("id", cMembershipId);
      // C is currently a co-owner (previous test restored both to active) —
      // removing them should be fine since A remains. Demote A afterward and
      // re-check that removing the LAST remaining owner (C, now sole owner)
      // is rejected even for service_role.
      expect(error).toBeNull();

      const { error: lastOwnerErr } = await admin
        .from("tenant_memberships")
        .update({ status: "removed" })
        .eq("id", aOwnerMembershipId);
      expect(lastOwnerErr).not.toBeNull();
      expect(lastOwnerErr?.message).toMatch(/at least one active owner/i);

      // Restore: A stays owner/active (never actually removed above); undo
      // C's removal is unnecessary since the tenant is deleted in afterAll.
    });
  });
});
