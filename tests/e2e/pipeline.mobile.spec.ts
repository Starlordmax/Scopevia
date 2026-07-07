import { test, expect } from "@playwright/test";
import { authFile } from "./fixtures/session";

/**
 * Runs only under the "mobile" Playwright project (390x844 viewport — see
 * playwright.config.ts). Pipeline is no longer a visible module — see
 * docs/38-navigation-simplification.md. The old version of this file
 * verified the kanban board's mobile layout; that UI is gone, so this now
 * verifies its absence from mobile navigation and that the legacy route
 * still redirects safely on a small viewport too.
 */
test.use({ storageState: authFile("owner-a") });

test.describe("Pipeline (mobile, 390x844)", () => {
  test("does not appear in the mobile bottom nav or the More panel", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".bottom-nav").getByText("Pipeline", { exact: true })).toHaveCount(0);

    const moreToggle = page.getByRole("button", { name: "More" });
    if (await moreToggle.count()) {
      await moreToggle.click();
      await expect(page.locator(".bottom-nav-more-panel").getByText("Pipeline", { exact: true })).toHaveCount(0);
    }
  });

  test("/pipeline redirects to /proposals on a mobile viewport", async ({ page }) => {
    await page.goto("/pipeline");
    await page.waitForURL(/\/proposals$/);
  });
});
