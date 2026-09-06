import { test, expect } from "@playwright/test";
import { authFile, uniqueSuffix } from "./fixtures/session";

/**
 * Runs only under the "mobile" Playwright project (390x844 — see
 * playwright.config.ts).
 */
const MOBILE_VIEWPORT = { width: 390, height: 844 };

test.use({ storageState: authFile("owner-a") });

test.describe("Client Address + Material ZIP Defaults (mobile, 390x844)", () => {
  test("New Client address fields are usable with no horizontal overflow", async ({ page }) => {
    const suffix = uniqueSuffix();
    const name = `E2E Mobile Addr Client ${suffix}`;

    await page.goto("/clients/new");
    let scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(MOBILE_VIEWPORT.width + 1);

    await page.getByLabel("Display name").fill(name);
    await page.getByLabel("Street address").fill("789 Palm Ave");
    await page.getByLabel("City").fill("Orlando");
    await page.getByLabel("State").fill("FL");
    await page.getByLabel("ZIP code").fill("32801");

    scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(MOBILE_VIEWPORT.width + 1);

    await page.getByRole("button", { name: "Create client" }).click();
    await page.waitForURL(/\/clients\/[0-9a-f-]+$/);
    await expect(page.getByRole("heading", { name: new RegExp(name) })).toBeVisible();
  });

  test("Quick Create Client modal address fields are usable with no horizontal overflow", async ({ page }) => {
    const suffix = uniqueSuffix();

    await page.goto("/proposals/new");
    await page.getByRole("button", { name: "+ New client" }).click();
    await expect(page.getByRole("heading", { name: "Create new client" })).toBeVisible();

    let scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(MOBILE_VIEWPORT.width + 1);

    await page.getByLabel("First name").fill("Mobile");
    await page.getByLabel("Last name").fill("QuickClient");
    await page.getByLabel("Email").fill(`mobile-quick-addr-${suffix}@example.com`);
    await page.getByLabel("Phone").fill("555-888-9999");
    await page.getByLabel("Street address").fill("1 Beach Blvd");
    await page.getByLabel("City").fill("Tampa");
    await page.getByLabel("State").fill("FL");
    await page.getByLabel("ZIP code").fill("33602");

    scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(MOBILE_VIEWPORT.width + 1);

    await page.getByRole("button", { name: "Create client" }).click();
    await expect(page.getByText("Client created and selected.")).toBeVisible({ timeout: 15_000 });
  });
});
