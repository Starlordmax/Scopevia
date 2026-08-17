import { test, expect } from "@playwright/test";
import { authFile, uniqueSuffix } from "./fixtures/session";

/**
 * Runs only under the "mobile" Playwright project (390x844 — see
 * playwright.config.ts). Confirms the app-wide red-state validation UX
 * (docs/75-global-field-validation.md) stays fully usable on a small
 * viewport: the red border/message are visible without extra scrolling
 * setup, nothing overflows horizontally, and the focused field is still
 * reachable/typeable.
 */
const MOBILE_VIEWPORT = { width: 390, height: 844 };

test.use({ storageState: authFile("owner-a") });

test.describe("Field validation (mobile, 390x844)", () => {
  test("Quick Create Client: missing fields show visible red state with no horizontal overflow", async ({ page }) => {
    await page.goto("/proposals/new");
    await page.getByRole("button", { name: "+ New client" }).click();
    await expect(page.getByRole("heading", { name: "Create new client" })).toBeVisible();

    await page.getByRole("button", { name: "Create client" }).click();

    const firstName = page.getByLabel("First name");
    await expect(firstName).toHaveClass(/field-input-error/);
    await expect(firstName).toBeFocused();
    // The same message also appears in the top-of-form error banner (by
    // design), so target the field-specific message by id.
    await expect(page.locator("#firstName-error")).toHaveText("First name is required");

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(MOBILE_VIEWPORT.width + 1);

    // The focused, invalid field is still directly usable — not obscured
    // or pushed off-screen by the error message layout.
    await firstName.fill("Mobile");
    await expect(firstName).toHaveValue("Mobile");
  });

  test("New Client form: empty display name shows a visible red error with no horizontal overflow", async ({ page }) => {
    await page.goto("/clients/new");
    await page.getByRole("button", { name: "Create client" }).click();

    const displayName = page.getByLabel("Display name");
    await expect(displayName).toHaveClass(/field-input-error/);
    await expect(displayName).toBeFocused();
    await expect(page.locator("#displayName-error")).toHaveText("Display name is required");

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(MOBILE_VIEWPORT.width + 1);
  });

  test("New Proposal: missing client shows a visible red error on the selector with no horizontal overflow", async ({ page }) => {
    const suffix = uniqueSuffix();
    await page.goto("/proposals/new");
    await page.getByLabel("Proposal title").fill(`E2E Mobile No Client ${suffix}`);
    await page.getByLabel("Service type").selectOption("interior_painting");

    // Force the client selector back to empty — see the desktop spec's
    // matching test for why a plain click sequence can't reliably reach
    // this state once real client options exist.
    const clientSelect = page.locator("#clientId");
    await clientSelect.evaluate((el: HTMLSelectElement) => {
      el.value = "";
    });

    await page.getByRole("button", { name: "Save and continue" }).click();

    await expect(clientSelect).toHaveClass(/field-input-error/);
    await expect(page.locator("#clientId-error")).toHaveText("Please select a client.");

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(MOBILE_VIEWPORT.width + 1);
  });
});
