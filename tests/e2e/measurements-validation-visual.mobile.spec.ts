import { test, expect } from "@playwright/test";
import { authFile, uniqueSuffix } from "./fixtures/session";

/**
 * Mobile (390x844) visual proof companion to
 * measurements-validation-visual.spec.ts — see
 * docs/76-measurements-draw-validation-visible-fix.md.
 */
test.use({ storageState: authFile("owner-a") });

test.describe("Measurements — Draw layout / Freehand visual validation (mobile, 390x844)", () => {
  test("clicking Save with no drawing turns the canvas red, visible with no horizontal overflow", async ({ page }) => {
    const suffix = uniqueSuffix();
    const clientName = `E2E Mobile Draw Validation Client ${suffix}`;

    await page.goto("/clients/new");
    await page.getByLabel("Display name").fill(clientName);
    await page.getByRole("button", { name: "Create client" }).click();
    await page.waitForURL(/\/clients\/[0-9a-f-]+$/);

    await page.goto("/proposals/new");
    await page.getByLabel("Client", { exact: true }).selectOption({ label: clientName });
    await page.waitForURL(/clientId=/);
    await page.getByLabel("Proposal title").fill(`E2E Mobile Draw Validation Proposal ${suffix}`);
    await page.getByLabel("Service type").selectOption("interior_painting");
    await page.getByRole("button", { name: "Save and continue" }).click();
    await page.waitForURL(/\/proposals\/[0-9a-f-]+\/edit\?step=measurements/);

    const measurementsPanel = page.locator(".section-card").filter({ has: page.getByRole("heading", { name: "Measurements" }) });
    await measurementsPanel.locator("#groupName").fill("Bathroom");
    await measurementsPanel.getByRole("button", { name: "+ Add group" }).click();
    await expect(measurementsPanel.locator("#measurementGroupId option", { hasText: "Bathroom" })).toHaveCount(1);

    await measurementsPanel.getByRole("button", { name: "Draw layout" }).click();

    const saveButton = measurementsPanel.getByRole("button", { name: "Save drawn measurement" });
    await expect(saveButton).toBeEnabled();
    await saveButton.click();

    const canvas = measurementsPanel.locator("#drawing");
    await expect(canvas).toHaveAttribute("aria-invalid", "true");
    await expect(measurementsPanel.locator("#drawing-error")).toHaveText("Draw the area before saving.");

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(391);

    await page.screenshot({ path: "test-results/validation-review/mobile-measurements-draw-errors.png", fullPage: true });
  });
});
