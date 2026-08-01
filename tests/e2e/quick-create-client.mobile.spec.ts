import { test, expect } from "@playwright/test";
import { authFile, uniqueSuffix } from "./fixtures/session";

/**
 * Runs only under the "mobile" Playwright project (390x844 — see
 * playwright.config.ts).
 */
const MOBILE_VIEWPORT = { width: 390, height: 844 };

test.use({ storageState: authFile("owner-a") });

test.describe("Quick Create Client (mobile, 390x844)", () => {
  test("modal is usable on a small viewport, no horizontal overflow, new client ends up selected", async ({ page }) => {
    const suffix = uniqueSuffix();
    await page.goto("/proposals/new");

    let scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(MOBILE_VIEWPORT.width + 1);

    await page.getByRole("button", { name: "+ New client" }).click();
    await expect(page.getByRole("heading", { name: "Create new client" })).toBeVisible();

    scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(MOBILE_VIEWPORT.width + 1);

    await page.getByLabel("First name").fill("Mobile");
    await page.getByLabel("Last name").fill("Client");
    await page.getByLabel("Email").fill(`mobile-quick-client-${suffix}@example.com`);
    await page.getByLabel("Phone").fill("555-666-7777");
    await page.getByRole("button", { name: "Create client" }).click();

    await expect(page.getByText("Client created and selected.")).toBeVisible({ timeout: 15_000 });
    const selectedLabel = await page.locator("#clientId option:checked").textContent();
    expect(selectedLabel).toBe("Mobile Client");

    scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(MOBILE_VIEWPORT.width + 1);
  });
});
