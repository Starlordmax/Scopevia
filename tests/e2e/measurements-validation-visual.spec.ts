import { test, expect } from "@playwright/test";
import { authFile, uniqueSuffix } from "./fixtures/session";

/**
 * Visual proof that Measurements → Draw layout → Freehand actually
 * shows red-state validation for missing required fields, not just
 * that the underlying fieldErrors architecture exists. See
 * docs/76-measurements-draw-validation-visible-fix.md.
 */
test.use({ storageState: authFile("owner-a") });

test.describe("Measurements — Draw layout / Freehand visual validation", () => {
  test("clicking Save with no drawing at all turns the canvas red and shows 'Draw the area before saving.'", async ({ page }) => {
    const suffix = uniqueSuffix();
    const clientName = `E2E Draw Validation Client ${suffix}`;

    await page.goto("/clients/new");
    await page.getByLabel("Display name").fill(clientName);
    await page.getByRole("button", { name: "Create client" }).click();
    await page.waitForURL(/\/clients\/[0-9a-f-]+$/);

    await page.goto("/proposals/new");
    await page.getByLabel("Client", { exact: true }).selectOption({ label: clientName });
    await page.waitForURL(/clientId=/);
    await page.getByLabel("Proposal title").fill(`E2E Draw Validation Proposal ${suffix}`);
    await page.getByLabel("Service type").selectOption("interior_painting");
    await page.getByRole("button", { name: "Save and continue" }).click();
    await page.waitForURL(/\/proposals\/[0-9a-f-]+\/edit\?step=measurements/);

    const measurementsPanel = page.locator(".section-card").filter({ has: page.getByRole("heading", { name: "Measurements" }) });
    await measurementsPanel.locator("#groupName").fill("Bathroom");
    await measurementsPanel.getByRole("button", { name: "+ Add group" }).click();
    await expect(measurementsPanel.locator("#measurementGroupId option", { hasText: "Bathroom" })).toHaveCount(1);

    await measurementsPanel.getByRole("button", { name: "Draw layout" }).click();
    await expect(measurementsPanel.locator("#drawingMode")).toHaveValue("freehand");

    // Nothing drawn at all -- click Save immediately.
    const saveButton = measurementsPanel.getByRole("button", { name: "Save drawn measurement" });
    await expect(saveButton).toBeEnabled();
    await saveButton.click();

    const canvas = measurementsPanel.locator("#drawing");
    await expect(canvas).toHaveAttribute("aria-invalid", "true");
    await expect(canvas).toHaveCSS("border-color", "rgb(220, 38, 38)"); // --color-danger
    await expect(measurementsPanel.locator("#drawing-error")).toHaveText("Draw the area before saving.");
    await expect(canvas).toBeFocused();

    // Still on the same page, no partial measurement created.
    await expect(page).toHaveURL(/step=measurements/);

    await page.screenshot({ path: "test-results/validation-review/measurements-draw-errors.png", fullPage: true });
  });

  test("a drawn shape with a missing/zero reference length turns that field red and does not silently no-op", async ({ page }) => {
    const suffix = uniqueSuffix();
    const clientName = `E2E Draw RefLength Client ${suffix}`;

    await page.goto("/clients/new");
    await page.getByLabel("Display name").fill(clientName);
    await page.getByRole("button", { name: "Create client" }).click();
    await page.waitForURL(/\/clients\/[0-9a-f-]+$/);

    await page.goto("/proposals/new");
    await page.getByLabel("Client", { exact: true }).selectOption({ label: clientName });
    await page.waitForURL(/clientId=/);
    await page.getByLabel("Proposal title").fill(`E2E Draw RefLength Proposal ${suffix}`);
    await page.getByLabel("Service type").selectOption("interior_painting");
    await page.getByRole("button", { name: "Save and continue" }).click();
    await page.waitForURL(/\/proposals\/[0-9a-f-]+\/edit\?step=measurements/);

    const measurementsPanel = page.locator(".section-card").filter({ has: page.getByRole("heading", { name: "Measurements" }) });
    await measurementsPanel.locator("#groupName").fill("Kitchen");
    await measurementsPanel.getByRole("button", { name: "+ Add group" }).click();
    await expect(measurementsPanel.locator("#measurementGroupId option", { hasText: "Kitchen" })).toHaveCount(1);

    await measurementsPanel.getByRole("button", { name: "Draw layout" }).click();

    const svg = measurementsPanel.locator("#drawing svg");
    await svg.scrollIntoViewIfNeeded();
    const box = (await svg.boundingBox())!;
    await page.mouse.move(box.x + 20, box.y + 20);
    await page.mouse.down();
    await page.mouse.move(box.x + 120, box.y + 20, { steps: 10 });
    await page.mouse.up();

    // Clear the reference length -- a real, drawn shape but no valid scale.
    await measurementsPanel.locator("#scaleReferenceLength").fill("0");
    await measurementsPanel.locator("#name").fill("Kitchen wall trim");

    const saveButton = measurementsPanel.getByRole("button", { name: "Save drawn measurement" });
    await expect(saveButton).toBeEnabled();
    await saveButton.click();

    const referenceLengthField = measurementsPanel.locator("#scaleReferenceLength");
    await expect(referenceLengthField).toHaveClass(/field-input-error/);
    await expect(referenceLengthField).toHaveAttribute("aria-invalid", "true");
    await expect(measurementsPanel.locator("#scaleReferenceLength-error")).toHaveText("Enter a reference length greater than 0.");
    await expect(referenceLengthField).toBeFocused();

    // The drawing itself is NOT also flagged -- only the actually-invalid field is.
    await expect(measurementsPanel.locator("#drawing")).not.toHaveAttribute("aria-invalid", "true");

    await expect(page).toHaveURL(/step=measurements/);

    await page.screenshot({ path: "test-results/validation-review/measurements-draw-reflength-error.png", fullPage: true });
  });

  test("Manual entry: an invalid length (0) turns that field red instead of silently blocking via the native number-input popup", async ({
    page,
  }) => {
    const suffix = uniqueSuffix();
    const clientName = `E2E Manual Entry Validation Client ${suffix}`;

    await page.goto("/clients/new");
    await page.getByLabel("Display name").fill(clientName);
    await page.getByRole("button", { name: "Create client" }).click();
    await page.waitForURL(/\/clients\/[0-9a-f-]+$/);

    await page.goto("/proposals/new");
    await page.getByLabel("Client", { exact: true }).selectOption({ label: clientName });
    await page.waitForURL(/clientId=/);
    await page.getByLabel("Proposal title").fill(`E2E Manual Entry Validation Proposal ${suffix}`);
    await page.getByLabel("Service type").selectOption("interior_painting");
    await page.getByRole("button", { name: "Save and continue" }).click();
    await page.waitForURL(/\/proposals\/[0-9a-f-]+\/edit\?step=measurements/);

    const measurementsPanel = page.locator(".section-card").filter({ has: page.getByRole("heading", { name: "Measurements" }) });
    await measurementsPanel.locator("#groupName").fill("Bedroom");
    await measurementsPanel.getByRole("button", { name: "+ Add group" }).click();
    await expect(measurementsPanel.locator("#measurementGroupId option", { hasText: "Bedroom" })).toHaveCount(1);

    // Manual entry is the default mode -- fill length/width with an
    // invalid (zero) length, leave name blank, and try to save.
    await measurementsPanel.locator("#length").fill("0");
    await measurementsPanel.locator("#width").fill("10");

    const saveButton = measurementsPanel.getByRole("button", { name: "Save measurement" });
    await expect(saveButton).toBeEnabled();
    await saveButton.click();

    const nameField = measurementsPanel.locator("#name");
    const lengthField = measurementsPanel.locator("#length");
    await expect(nameField).toHaveClass(/field-input-error/);
    await expect(lengthField).toHaveClass(/field-input-error/);
    await expect(measurementsPanel.locator("#name-error")).toHaveText("Measurement name is required.");
    await expect(measurementsPanel.locator("#length-error")).toHaveText("Length must be greater than zero");
    // Focus lands on the FIRST invalid field, per fieldErrors' key order.
    await expect(page.locator(":focus")).toHaveCount(1);

    await expect(page).toHaveURL(/step=measurements/);
  });
});
