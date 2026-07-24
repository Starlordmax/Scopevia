import { test, expect } from "@playwright/test";
import { authFile } from "./fixtures/session";

const LOGO_FILE = require.resolve("./fixtures/one-pixel.png");

// The logo is a per-tenant SINGLETON (unlike a proposal or client, which
// each test creates fresh), so these two tests share mutable state on the
// same owner-a tenant. Serialized to avoid racing each other; a residual,
// small-probability race against business-branding-portal.spec.ts /
// business-branding.mobile.spec.ts (which touch the same tenant's logo
// from a different worker) remains, consistent with this project's
// already-documented, already-accepted full-suite parallel-load flakiness
// (see docs/69-business-branding-logo-upload.md, "Known limitations").
test.describe.serial("Business branding — Profile (Owner/Admin)", () => {
  test.use({ storageState: authFile("owner-a") });

  test("upload, preview, use in proposal preview + print, then remove falls back to business name", async ({ page }) => {
    test.setTimeout(60_000);

    await page.goto("/profile");
    await expect(page.getByText("Business branding")).toBeVisible();

    // Unknown starting state (a previous run may have left a logo) — the
    // button reads "Upload logo" or "Replace logo" depending on it.
    await page.getByLabel(/Upload logo|Replace logo/).setInputFiles(LOGO_FILE);
    // A file input's implicit ARIA role is also "button" in Chromium, so
    // getByRole("button", ...) alone would match both the <input type=file>
    // and the real <button type=submit> — .and(locator("button")) narrows
    // to the actual submit control.
    await page
      .getByRole("button", { name: /Upload logo|Replace logo/ })
      .and(page.locator("button"))
      .click();
    await expect(page.getByText("Logo uploaded successfully.")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(".form-card").filter({ hasText: "Business branding" }).locator("img.photo-thumb")).toBeVisible();
    await expect(page.getByRole("button", { name: "Replace logo" }).and(page.locator("button"))).toBeVisible();
    await expect(page.getByRole("button", { name: "Remove logo" })).toBeVisible();

    // A fresh proposal's preview/print/review must show the just-uploaded logo.
    const suffix = `${Date.now()}`;
    const clientName = `E2E Branding Client ${suffix}`;
    await page.goto("/clients/new");
    await page.getByLabel("Display name").fill(clientName);
    await page.getByRole("button", { name: "Create client" }).click();
    await page.waitForURL(/\/clients\/[0-9a-f-]+$/);

    await page.goto("/proposals/new");
    await page.getByLabel("Client").selectOption({ label: clientName });
    await page.waitForURL(/clientId=/);
    await page.getByLabel("Proposal title").fill(`E2E Branding Proposal ${suffix}`);
    await page.getByLabel("Service type").selectOption("custom");
    await page.getByRole("button", { name: "Save and continue" }).click();
    await page.waitForURL(/\/proposals\/[0-9a-f-]+\/edit\?step=measurements/);
    const proposalUrl = page.url().replace(/\/edit\?step=measurements$/, "");
    const proposalId = proposalUrl.split("/").pop();

    await page.goto(`/proposals/${proposalId}/edit?step=review`);
    await expect(page.locator(".proposal-document-logo")).toBeVisible();

    await page.goto(`/proposals/${proposalId}/preview`);
    await expect(page.locator(".proposal-document-logo")).toBeVisible();

    await page.goto(`/proposals/${proposalId}/print`);
    await expect(page.locator(".proposal-document-logo")).toBeVisible();

    // Remove the logo — every one of those same surfaces must fall back to
    // the business name as plain text, never a broken image.
    await page.goto("/profile");
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Remove logo" }).click();
    await expect(page.getByText("No logo uploaded yet")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: "Remove logo" })).toHaveCount(0);

    await page.goto(`/proposals/${proposalId}/preview`);
    await expect(page.locator(".proposal-document-logo")).toHaveCount(0);
    await expect(page.locator(".proposal-document-business")).toBeVisible();
  });

  /**
   * Regression test for docs/71-logo-upload-crash-fix.md: a realistic-size
   * logo (well over 1 MB) used to crash the whole page with "This page
   * couldn't load" — Next.js's own default Server Action body size limit
   * (1 MB) rejected the request before uploadBusinessLogoAction() ever ran.
   * fixtures/one-pixel.png (67 bytes, used by the other tests here) is far
   * too small to ever have caught this — this test exists specifically to
   * exercise a file size a real user would actually upload.
   */
  test("a realistic-size logo (1.5 MB) uploads successfully without crashing the page", async ({ page }) => {
    await page.goto("/profile");
    await page.getByLabel(/Upload logo|Replace logo/).setInputFiles({
      name: "realistic-logo.png",
      mimeType: "image/png",
      buffer: Buffer.alloc(1.5 * 1024 * 1024, 7),
    });
    await page
      .getByRole("button", { name: /Upload logo|Replace logo/ })
      .and(page.locator("button"))
      .click();

    await expect(page.getByText("Logo uploaded successfully.")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(".form-card").filter({ hasText: "Business branding" }).locator("img.photo-thumb")).toBeVisible();
    await expect(page.getByText("This page couldn't load")).toHaveCount(0);
  });

  test("uploading a non-image file is rejected with a friendly error", async ({ page }) => {
    await page.goto("/profile");
    // Build an in-memory "file" with a disallowed MIME type via setInputFiles' buffer form.
    await page.getByLabel(/Upload logo|Replace logo/).setInputFiles({
      name: "not-a-logo.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("not an image"),
    });
    await page
      .getByRole("button", { name: /Upload logo|Replace logo/ })
      .and(page.locator("button"))
      .click();
    await expect(page.getByText("Only PNG, JPG, or WEBP images are supported.")).toBeVisible({ timeout: 15_000 });
  });
});

test.describe("Business branding — Profile (view-only role)", () => {
  test.use({ storageState: authFile("viewer-a") });

  test("Viewer sees the current logo state but no upload/replace/remove controls", async ({ page }) => {
    await page.goto("/profile");
    await expect(page.getByText("Business branding")).toBeVisible();
    await expect(page.getByText("Only an Owner or Admin can change the business logo.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Upload logo" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Replace logo" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Remove logo" })).toHaveCount(0);
  });
});
