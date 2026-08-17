import { test, expect } from "@playwright/test";
import { authFile, uniqueSuffix } from "./fixtures/session";

/**
 * Runs only under the "mobile" Playwright project (390x844). Custom
 * service name + multi-stroke drawing + inline validation, touch-sized
 * (Playwright's mouse API dispatches Pointer Events, the same code path
 * a real touch drag exercises — see measurements.mobile.spec.ts). See
 * docs/74-custom-service-name-and-multistroke-drawing.md.
 */
test.use({ storageState: authFile("owner-a") });

test.describe("Custom service name + multi-stroke drawing (mobile, 390x844)", () => {
  test("Custom service name field and multi-stroke drawing are usable with no horizontal overflow, validation errors are visible", async ({ page }) => {
    test.setTimeout(120_000);
    const suffix = uniqueSuffix();
    const clientName = `E2E Mobile Custom/Multistroke Client ${suffix}`;

    await page.goto("/clients/new");
    await page.getByLabel("Display name").fill(clientName);
    await page.getByRole("button", { name: "Create client" }).click();
    await page.waitForURL(/\/clients\/[0-9a-f-]+$/);

    const viewportWidth = page.viewportSize()!.width;

    await page.goto("/proposals/new");
    let scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(viewportWidth + 1);

    await page.getByLabel("Client", { exact: true }).selectOption({ label: clientName });
    await page.waitForURL(/clientId=/);
    await page.getByLabel("Proposal title").fill(`E2E Mobile Custom Service ${suffix}`);
    await page.getByLabel("Service type").selectOption("custom");
    await expect(page.getByLabel("Custom service name")).toBeVisible();

    scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(viewportWidth + 1);

    // Submit without a name -- error visible, field marked invalid.
    await page.getByRole("button", { name: "Save and continue" }).click();
    await expect(page.locator("#customServiceName-error")).toHaveText("Enter a name for this custom service.");
    await expect(page.getByLabel("Custom service name")).toHaveAttribute("aria-invalid", "true");

    const customServiceName = `Patio extension ${suffix}`;
    await page.getByLabel("Custom service name").fill(customServiceName);
    await page.getByRole("button", { name: "Save and continue" }).click();
    await page.waitForURL(/\/proposals\/[0-9a-f-]+\/edit\?step=measurements/);

    const measurementsPanel = page.locator(".section-card").filter({ has: page.getByRole("heading", { name: "Measurements" }) });
    await measurementsPanel.locator("#groupName").fill("Patio");
    await measurementsPanel.getByRole("button", { name: "+ Add group" }).click();

    await measurementsPanel.getByRole("button", { name: "Draw layout" }).click();
    const svg = measurementsPanel.locator("svg");
    await svg.scrollIntoViewIfNeeded();
    const box = (await svg.boundingBox())!;

    // Two separate strokes, touch-sized drag.
    await page.mouse.move(box.x + 15, box.y + 15);
    await page.mouse.down();
    await page.mouse.move(box.x + 90, box.y + 15, { steps: 8 });
    await page.mouse.up();

    scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(viewportWidth + 1);

    await page.mouse.move(box.x + 90, box.y + 90);
    await page.mouse.down();
    await page.mouse.move(box.x + 15, box.y + 90, { steps: 8 });
    await page.mouse.up();

    await page.mouse.move(box.x + 15, box.y + 90);
    await page.mouse.down();
    await page.mouse.move(box.x + 15, box.y + 15, { steps: 8 });
    await page.mouse.up();

    await expect(measurementsPanel.getByRole("button", { name: "Close shape" })).toBeEnabled();
    await measurementsPanel.getByRole("button", { name: "Close shape" }).click();
    await expect(measurementsPanel.getByRole("button", { name: "Shape closed ✓" })).toBeVisible();

    // Clear the reference length and try to save -- disabled client-side
    // (pixelsPerUnit <= 0), confirming the disabled-state validation
    // works with touch-sized interactions too.
    await measurementsPanel.locator("#freehandGroupId").selectOption({ label: "Patio" });
    await measurementsPanel.locator("#name").fill("Patio outline");
    await measurementsPanel.locator("#scaleReferenceLength").fill("");
    await expect(measurementsPanel.getByRole("button", { name: "Save drawn measurement" })).toBeDisabled();

    await measurementsPanel.locator("#scaleReferenceLength").fill("10");
    await measurementsPanel.getByRole("button", { name: "Save drawn measurement" }).click();
    await expect(measurementsPanel.locator("tr").filter({ hasText: "Patio outline" })).toBeVisible();

    scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(viewportWidth + 1);
  });
});
