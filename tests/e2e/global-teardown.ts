import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { adminClient, type E2EManifest } from "./fixtures/provision";
import { MANIFEST_PATH } from "./global-setup";

/**
 * Deletes ONLY the users/tenants recorded in this run's manifest — never a
 * prefix-based bulk delete against the live table, so a run can never touch
 * data it didn't itself create, even if two runs overlap.
 */
export default async function globalTeardown() {
  if (!existsSync(MANIFEST_PATH)) return;

  const manifest: E2EManifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf-8"));
  const admin = adminClient();

  for (const user of Object.values(manifest.users)) {
    await admin.auth.admin.deleteUser(user.id).catch(() => {});
  }
  for (const tenantId of [manifest.tenantAId, manifest.tenantBId]) {
    try {
      await admin.from("tenants").delete().eq("id", tenantId);
    } catch {
      // best-effort cleanup
    }
  }

  const authDir = path.dirname(MANIFEST_PATH);
  rmSync(authDir, { recursive: true, force: true });
}
