import { config as loadEnv } from "dotenv";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  adminClient,
  createE2EUser,
  createTenant,
  e2eEmail,
  e2eRunId,
  inviteAndAccept,
  signInAs,
  type E2EManifest,
} from "./fixtures/provision";

const AUTH_DIR = path.join(__dirname, "..", "..", "playwright", ".auth");
export const MANIFEST_PATH = path.join(AUTH_DIR, "manifest.json");

/**
 * Node-side only: creates the E2E fixture data (2 tenants, 5 users, roles)
 * against the real scopevia-test project via the app's own RPCs — never a
 * direct table write, never a UI interaction. The service role client here
 * only creates auth users (the one operation with no RPC equivalent); every
 * tenant/membership mutation goes through create_tenant_with_owner()/
 * invite_member_by_email()/accept_invitation(), signed in as the relevant
 * user via the anon key, exactly like tests/rls/*.test.ts.
 *
 * Tenant names are prefixed "E2E Tenant A"/"E2E Tenant B" so that
 * get_user_tenants()'s `order by t.name` deterministically puts Tenant A
 * first — relied on by the tenant-switching spec, which needs ownerA's
 * default active tenant (no cookie yet) to be Tenant A.
 */
export default async function globalSetup() {
  loadEnv({ path: path.join(__dirname, "..", "..", ".env.local") });

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL?.includes("msduefaopvxfjqktjymo")) {
    throw new Error(
      "Refusing to run E2E setup: NEXT_PUBLIC_SUPABASE_URL does not point at the scopevia-test project (ref msduefaopvxfjqktjymo)."
    );
  }

  const runId = e2eRunId();
  const admin = adminClient();

  const emails = {
    ownerA: e2eEmail(runId, "owner-a"),
    salesA: e2eEmail(runId, "sales-a"),
    viewerA: e2eEmail(runId, "viewer-a"),
    fieldWorkerA: e2eEmail(runId, "field-worker-a"),
    ownerB: e2eEmail(runId, "owner-b"),
  };

  const ids = {
    ownerA: await createE2EUser(admin, emails.ownerA),
    salesA: await createE2EUser(admin, emails.salesA),
    viewerA: await createE2EUser(admin, emails.viewerA),
    fieldWorkerA: await createE2EUser(admin, emails.fieldWorkerA),
    ownerB: await createE2EUser(admin, emails.ownerB),
  };

  const ownerAClient = await signInAs(emails.ownerA);
  const ownerBClient = await signInAs(emails.ownerB);
  const salesAClient = await signInAs(emails.salesA);
  const viewerAClient = await signInAs(emails.viewerA);
  const fieldWorkerAClient = await signInAs(emails.fieldWorkerA);

  const tenantAName = `E2E Tenant A ${runId}`;
  const tenantBName = `E2E Tenant B ${runId}`;
  const tenantAId = await createTenant(ownerAClient, tenantAName, `e2e-a-${runId}`);
  const tenantBId = await createTenant(ownerBClient, tenantBName, `e2e-b-${runId}`);

  await inviteAndAccept(ownerAClient, salesAClient, tenantAId, emails.salesA, "sales");
  await inviteAndAccept(ownerAClient, viewerAClient, tenantAId, emails.viewerA, "viewer");
  await inviteAndAccept(ownerAClient, fieldWorkerAClient, tenantAId, emails.fieldWorkerA, "field_worker");
  // ownerA also joins Tenant B (as viewer) so the tenant-switching spec has a
  // single real user who genuinely belongs to two tenants.
  await inviteAndAccept(ownerBClient, ownerAClient, tenantBId, emails.ownerA, "viewer");

  const manifest: E2EManifest = {
    runId,
    tenantAId,
    tenantBId,
    tenantAName,
    tenantBName,
    users: {
      ownerA: { id: ids.ownerA, email: emails.ownerA },
      salesA: { id: ids.salesA, email: emails.salesA },
      viewerA: { id: ids.viewerA, email: emails.viewerA },
      fieldWorkerA: { id: ids.fieldWorkerA, email: emails.fieldWorkerA },
      ownerB: { id: ids.ownerB, email: emails.ownerB },
    },
  };

  mkdirSync(AUTH_DIR, { recursive: true });
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));

  // The freshly-started `next start` process's own outbound connection pool
  // to Supabase is cold — its first one or two real requests have hit a raw
  // ECONNRESET against the remote scopevia-test project in this suite (see
  // docs/25-phase-1-e2e-verification.md). A handful of sequential warm-up
  // requests here (before parallel browser tests start) establishes that
  // pool ahead of time instead of eating the cold-start failure randomly
  // inside a real test.
  for (let i = 0; i < 5; i++) {
    await fetch("http://localhost:3000/sign-in").catch(() => {});
  }
}
