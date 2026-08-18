import { test, expect } from "@playwright/test";
import { authFile, uniqueSuffix } from "./fixtures/session";

/**
 * Literal, undeniable proof that Measurements' Draw layout validation
 * renders visibly red in a real browser -- exact steps and exact
 * screenshot paths as specced. See
 * docs/76-measurements-draw-validation-visible-fix.md.
 */
test.use({ storageState: authFile("owner-a") });

test.describe("Measurements — real red-state validation proof", () => {
  test("desktop: reference length, custom service name, and empty-canvas all turn red", async ({ page }) => {
    const suffix = uniqueSuffix();
    const clientName = `E2E Red Validation Client ${suffix}`;

    await page.goto("/clients/new");
    await page.getByLabel("Display name").fill(clientName);
    await page.getByRole("button", { name: "Create client" }).click();
    await page.waitForURL(/\/clients\/[0-9a-f-]+$/);

    // --- Proposal creation: Service type = Custom, empty custom name shows red ---
    await page.goto("/proposals/new");
    await page.getByLabel("Client", { exact: true }).selectOption({ label: clientName });
    await page.waitForURL(/clientId=/);
    await page.getByLabel("Proposal title").fill(`E2E Red Validation Proposal ${suffix}`);
    await page.getByLabel("Service type").selectOption("custom");
    await page.getByRole("button", { name: "Save and continue" }).click();

    const customServiceName = page.getByLabel("Custom service name");
    await expect(customServiceName).toHaveClass(/field-input-error/);
    await expect(customServiceName).toHaveAttribute("aria-invalid", "true");
    await expect(page.locator("#customServiceName-error")).toHaveText("Enter a name for this custom service.");
    await expect(customServiceName).toBeFocused();

    // Error clears once the user types.
    await customServiceName.fill(`Deck repair ${suffix}`);
    await page.getByRole("button", { name: "Save and continue" }).click();
    await page.waitForURL(/\/proposals\/[0-9a-f-]+\/edit\?step=measurements/);

    // --- Measurements: Draw layout, missing reference length ---
    const measurementsPanel = page.locator(".section-card").filter({ has: page.getByRole("heading", { name: "Measurements" }) });
    await measurementsPanel.locator("#groupName").fill("Deck");
    await measurementsPanel.getByRole("button", { name: "+ Add group" }).click();
    await expect(measurementsPanel.locator("#measurementGroupId option", { hasText: "Deck" })).toHaveCount(1);

    await measurementsPanel.getByRole("button", { name: "Draw layout" }).click();
    const svg = measurementsPanel.locator("#drawing svg");
    await svg.scrollIntoViewIfNeeded();
    const box = (await svg.boundingBox())!;
    await page.mouse.move(box.x + 20, box.y + 20);
    await page.mouse.down();
    await page.mouse.move(box.x + 120, box.y + 20, { steps: 10 });
    await page.mouse.up();

    await measurementsPanel.locator("#scaleReferenceLength").fill("");
    await measurementsPanel.getByRole("button", { name: "Save drawn measurement" }).click();

    const referenceLengthField = measurementsPanel.locator("#scaleReferenceLength");
    await expect(page.getByText("Enter a reference length greater than 0.")).toBeVisible();
    await expect(referenceLengthField).toHaveAttribute("aria-invalid", "true");
    await expect(referenceLengthField).toHaveClass(/field-input-error/);
    const borderColor = await referenceLengthField.evaluate((el) => getComputedStyle(el).borderColor);
    expect(borderColor).toBe("rgb(220, 38, 38)");

    // --- Empty canvas: Clear the drawing, save again ---
    await measurementsPanel.getByRole("button", { name: "Clear" }).click();
    await measurementsPanel.locator("#scaleReferenceLength").fill("10");
    await measurementsPanel.getByRole("button", { name: "Save drawn measurement" }).click();

    const canvasWrapper = measurementsPanel.locator("#drawing");
    await expect(canvasWrapper).toHaveAttribute("aria-invalid", "true");
    await expect(canvasWrapper).toHaveClass(/field-input-error/);
    await expect(measurementsPanel.locator("#drawing-error")).toHaveText("Draw the area before saving.");
    const canvasBorderColor = await canvasWrapper.evaluate((el) => getComputedStyle(el).borderColor);
    expect(canvasBorderColor).toBe("rgb(220, 38, 38)");

    await page.screenshot({ path: "test-results/validation-review/measurements-red-errors-desktop.png", fullPage: true });
  });

  test("mobile (390x844): the same errors are visible with no horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });

    const suffix = uniqueSuffix();
    const clientName = `E2E Red Validation Mobile Client ${suffix}`;

    await page.goto("/clients/new");
    await page.getByLabel("Display name").fill(clientName);
    await page.getByRole("button", { name: "Create client" }).click();
    await page.waitForURL(/\/clients\/[0-9a-f-]+$/);

    await page.goto("/proposals/new");
    await page.getByLabel("Client", { exact: true }).selectOption({ label: clientName });
    await page.waitForURL(/clientId=/);
    await page.getByLabel("Proposal title").fill(`E2E Red Validation Mobile Proposal ${suffix}`);
    await page.getByLabel("Service type").selectOption("interior_painting");
    await page.getByRole("button", { name: "Save and continue" }).click();
    await page.waitForURL(/\/proposals\/[0-9a-f-]+\/edit\?step=measurements/);

    const measurementsPanel = page.locator(".section-card").filter({ has: page.getByRole("heading", { name: "Measurements" }) });
    await measurementsPanel.locator("#groupName").fill("Patio");
    await measurementsPanel.getByRole("button", { name: "+ Add group" }).click();
    await expect(measurementsPanel.locator("#measurementGroupId option", { hasText: "Patio" })).toHaveCount(1);

    await measurementsPanel.getByRole("button", { name: "Draw layout" }).click();
    await measurementsPanel.getByRole("button", { name: "Save drawn measurement" }).click();

    const canvasWrapper = measurementsPanel.locator("#drawing");
    await expect(canvasWrapper).toHaveAttribute("aria-invalid", "true");
    await expect(measurementsPanel.locator("#drawing-error")).toHaveText("Draw the area before saving.");

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(391);

    await page.screenshot({ path: "test-results/validation-review/measurements-red-errors-mobile.png", fullPage: true });
  });

  /**
   * Reproduces the exact real-user report: draw a full shape, close it,
   * enter a reference length -- but never create a measurement group
   * first. Save used to silently do nothing (the button was `disabled`
   * on `measurementGroups.length === 0`, so the click never even fired),
   * leaving the user with a fully-drawn, fully-scaled shape and no
   * indication anything was wrong. The Group field must now turn red
   * instead.
   */
  test("drawing a full shape with no measurement group created yet turns the Group field red, not a silent no-op", async ({ page }) => {
    const suffix = uniqueSuffix();
    const clientName = `E2E No Group Client ${suffix}`;

    await page.goto("/clients/new");
    await page.getByLabel("Display name").fill(clientName);
    await page.getByRole("button", { name: "Create client" }).click();
    await page.waitForURL(/\/clients\/[0-9a-f-]+$/);

    await page.goto("/proposals/new");
    await page.getByLabel("Client", { exact: true }).selectOption({ label: clientName });
    await page.waitForURL(/clientId=/);
    await page.getByLabel("Proposal title").fill(`E2E No Group Proposal ${suffix}`);
    await page.getByLabel("Service type").selectOption("interior_painting");
    await page.getByRole("button", { name: "Save and continue" }).click();
    await page.waitForURL(/\/proposals\/[0-9a-f-]+\/edit\?step=measurements/);

    // Deliberately skip "+ Add group" entirely -- go straight to Draw layout.
    const measurementsPanel = page.locator(".section-card").filter({ has: page.getByRole("heading", { name: "Measurements" }) });
    await measurementsPanel.getByRole("button", { name: "Draw layout" }).click();

    // Draw a closed shape, exactly like the real report's screenshot.
    const svg = measurementsPanel.locator("#drawing svg");
    await svg.scrollIntoViewIfNeeded();
    const box = (await svg.boundingBox())!;
    await page.mouse.move(box.x + 20, box.y + 20);
    await page.mouse.down();
    await page.mouse.move(box.x + 120, box.y + 20, { steps: 5 });
    await page.mouse.move(box.x + 120, box.y + 120, { steps: 5 });
    await page.mouse.move(box.x + 20, box.y + 120, { steps: 5 });
    await page.mouse.up();
    await measurementsPanel.getByRole("button", { name: "Close shape" }).click();
    await expect(measurementsPanel.getByRole("button", { name: "Shape closed ✓" })).toBeVisible();
    await measurementsPanel.locator("#scaleReferenceLength").fill("10");

    const saveButton = measurementsPanel.getByRole("button", { name: "Save drawn measurement" });
    await expect(saveButton).toBeEnabled();
    await saveButton.click();

    const groupField = measurementsPanel.locator("#freehandGroupId");
    await expect(groupField).toHaveClass(/field-input-error/);
    await expect(groupField).toHaveAttribute("aria-invalid", "true");
    await expect(measurementsPanel.locator("#measurementGroupId-error")).toHaveText("Create a measurement group before saving.");
    const groupBorderColor = await groupField.evaluate((el) => getComputedStyle(el).borderColor);
    expect(groupBorderColor).toBe("rgb(220, 38, 38)");

    await page.screenshot({ path: "test-results/validation-review/measurements-no-group-error.png", fullPage: true });

    // The drawing itself is untouched -- it's still there, still closed,
    // ready to save the moment a group exists (proving nothing was
    // silently discarded).
    await expect(measurementsPanel.getByRole("button", { name: "Shape closed ✓" })).toBeVisible();
    await expect(measurementsPanel.locator("#scaleReferenceLength")).toHaveValue("10");

    // Fixing it (creating a group) and saving again succeeds.
    await measurementsPanel.locator("#groupName").fill("Roof");
    await measurementsPanel.getByRole("button", { name: "+ Add group" }).click();
    await expect(measurementsPanel.locator("#freehandGroupId option", { hasText: "Roof" })).toHaveCount(1);
    await measurementsPanel.locator("#freehandGroupId").selectOption({ label: "Roof" });
    await measurementsPanel.locator("#name").fill("Roof outline");
    await saveButton.click();
    await expect(measurementsPanel.locator("tr").filter({ hasText: "Roof outline" })).toBeVisible();
  });
});
