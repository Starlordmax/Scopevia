import { test as setup, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { MANIFEST_PATH } from "./global-setup";
import { E2E_PASSWORD, type E2EManifest } from "./fixtures/provision";

const manifest: E2EManifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf-8"));
const AUTH_DIR = path.join(__dirname, "..", "..", "playwright", ".auth");

/**
 * Real UI login for each persona, once, with the resulting session reused
 * (via storageState) by the desktop/mobile spec projects — the standard
 * Playwright "auth setup project" pattern. This is still a genuine signed-in
 * browser session obtained through the actual sign-in form, not a bypass;
 * tests/e2e/auth.spec.ts separately re-runs a fresh, non-reused login to
 * verify the sign-in flow itself (redirect target, error handling).
 */
async function loginAndSave(page: import("@playwright/test").Page, email: string, storagePath: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"), { timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  await page.context().storageState({ path: storagePath });
}

setup("authenticate as Owner A (also a Tenant B viewer)", async ({ page }) => {
  await loginAndSave(page, manifest.users.ownerA.email, path.join(AUTH_DIR, "owner-a.json"));
});

setup("authenticate as Sales A", async ({ page }) => {
  await loginAndSave(page, manifest.users.salesA.email, path.join(AUTH_DIR, "sales-a.json"));
});

setup("authenticate as Viewer A", async ({ page }) => {
  await loginAndSave(page, manifest.users.viewerA.email, path.join(AUTH_DIR, "viewer-a.json"));
});

setup("authenticate as Field Worker A", async ({ page }) => {
  await loginAndSave(page, manifest.users.fieldWorkerA.email, path.join(AUTH_DIR, "field-worker-a.json"));
});

setup("authenticate as Owner B", async ({ page }) => {
  await loginAndSave(page, manifest.users.ownerB.email, path.join(AUTH_DIR, "owner-b.json"));
});
