import { test, expect } from "@playwright/test";
import { authFile, uniqueSuffix } from "./fixtures/session";

/**
 * Custom service name (New Proposal form) + multi-stroke freehand
 * drawing + inline field validation (Measurements step) — see
 * docs/74-custom-service-name-and-multistroke-drawing.md.
 */
test.describe("Custom service name + multi-stroke drawing + inline validation", () => {
  test.use({ storageState: authFile("owner-a") });

  test("Custom service name is required, drawn strokes stay separate, and field errors show inline in red", async ({ page }) => {
    test.setTimeout(120_000);
    const suffix = uniqueSuffix();
    const clientName = `E2E Custom/Multistroke Client ${suffix}`;
    const proposalTitle = `E2E Custom Service Proposal ${suffix}`;

    await page.goto("/clients/new");
    await page.getByLabel("Display name").fill(clientName);
    await page.getByRole("button", { name: "Create client" }).click();
    await page.waitForURL(/\/clients\/[0-9a-f-]+$/);

    // --- New Proposal: Custom service type needs a name ---
    await page.goto("/proposals/new");
    await page.getByLabel("Client", { exact: true }).selectOption({ label: clientName });
    await page.waitForURL(/clientId=/);
    await page.getByLabel("Proposal title").fill(proposalTitle);

    // Custom service name field is absent until "Custom" is selected.
    await expect(page.getByLabel("Custom service name")).toHaveCount(0);
    await page.getByLabel("Service type").selectOption("custom");
    await expect(page.getByLabel("Custom service name")).toBeVisible();

    // Try to save without a custom service name -- rejected, field marked
    // invalid, error shown, page never navigates away.
    await page.getByRole("button", { name: "Save and continue" }).click();
    await expect(page.locator("#customServiceName-error")).toHaveText("Enter a name for this custom service.");
    await expect(page.getByLabel("Custom service name")).toHaveAttribute("aria-invalid", "true");
    await expect(page).toHaveURL(/\/proposals\/new/);

    const customServiceName = `Deck repair ${suffix}`;
    await page.getByLabel("Custom service name").fill(customServiceName);
    await page.getByRole("button", { name: "Save and continue" }).click();
    await page.waitForURL(/\/proposals\/[0-9a-f-]+\/edit\?step=measurements/);
    const proposalUrl = page.url().replace(/\/edit\?step=measurements$/, "");

    // The custom service name is shown (never the bare word "custom")
    // in the builder's page header, present on every step.
    await expect(page.getByText(customServiceName)).toBeVisible();

    // --- Measurements: multi-stroke freehand drawing ---
    const measurementsPanel = page.locator(".section-card").filter({ has: page.getByRole("heading", { name: "Measurements" }) });
    await measurementsPanel.locator("#groupName").fill("Deck");
    await measurementsPanel.getByRole("button", { name: "+ Add group" }).click();
    await expect(measurementsPanel.locator("#measurementGroupId option", { hasText: "Deck" })).toHaveCount(1);

    await measurementsPanel.getByRole("button", { name: "Draw layout" }).click();
    await expect(measurementsPanel.locator("#drawingMode")).toHaveValue("freehand");

    const svg = measurementsPanel.locator("svg");
    await svg.scrollIntoViewIfNeeded();
    const box = (await svg.boundingBox())!;

    // Stroke 1: a 100px horizontal segment.
    await page.mouse.move(box.x + 20, box.y + 20);
    await page.mouse.down();
    await page.mouse.move(box.x + 120, box.y + 20, { steps: 10 });
    await page.mouse.up();

    // A single open stroke is already a valid linear measurement (e.g.
    // tracing one board), so Save is enabled here -- Undo removes the
    // WHOLE stroke, not just a point, leaving zero strokes behind. Close
    // shape has nothing to work with anymore and disables, but Save
    // itself stays clickable -- see docs/76-measurements-draw-validation-visible-fix.md:
    // a disabled Save button on an empty drawing used to be a silent
    // no-op with no red state at all, so Save is never disabled for
    // "nothing drawn yet" anymore, only for structural preconditions
    // (no group, or mid-drag).
    await expect(measurementsPanel.getByRole("button", { name: "Save drawn measurement" })).toBeEnabled();
    await measurementsPanel.getByRole("button", { name: "Undo" }).click();
    await expect(measurementsPanel.getByRole("button", { name: "Save drawn measurement" })).toBeEnabled();
    await expect(measurementsPanel.getByRole("button", { name: "Close shape" })).toBeDisabled();

    // Redraw stroke 1, then a SEPARATE stroke 2 far away (lifting the
    // pen/finger in between) -- they must not auto-connect. Both strokes
    // stay within the canvas's 320px-wide viewport (draw-layout-canvas.tsx's
    // VIEWPORT_WIDTH) so neither endpoint gets clamped. Stroke 1: x 10->100
    // (90px). Stroke 2: x 200->290 (90px). Bounding box spans 10px to
    // 290px (280px wide); calibrated to represent 28ft -> 10px/ft. If
    // strokes wrongly connected into one continuous path, the open-path
    // preview would read the full bounding width, 28.00 ft; the correct
    // multi-stroke sum is 18.00 ft (9ft + 9ft, excluding the 100px/10ft
    // gap between them).
    await page.mouse.move(box.x + 10, box.y + 20);
    await page.mouse.down();
    await page.mouse.move(box.x + 100, box.y + 20, { steps: 10 });
    await page.mouse.up();

    await page.mouse.move(box.x + 200, box.y + 20);
    await page.mouse.down();
    await page.mouse.move(box.x + 290, box.y + 20, { steps: 10 });
    await page.mouse.up();

    await measurementsPanel.locator("#scaleReferenceLength").fill("28");
    await expect(measurementsPanel.locator(".unsaved-preview-tile")).toContainText("18.00 ft");
    await expect(measurementsPanel.locator(".unsaved-preview-tile")).not.toContainText("28.00 ft");

    // Clear removes everything and starts over.
    await measurementsPanel.getByRole("button", { name: "Clear" }).click();
    await expect(measurementsPanel.getByRole("button", { name: "Undo" })).toBeDisabled();
    await expect(measurementsPanel.getByRole("button", { name: "Close shape" })).toBeDisabled();

    // --- Draw again, this time as a closed area, and exercise field validation ---
    await page.mouse.move(box.x + 20, box.y + 20);
    await page.mouse.down();
    await page.mouse.move(box.x + 120, box.y + 20, { steps: 5 });
    await page.mouse.move(box.x + 120, box.y + 120, { steps: 5 });
    await page.mouse.move(box.x + 20, box.y + 120, { steps: 5 });
    await page.mouse.up();
    await measurementsPanel.getByRole("button", { name: "Close shape" }).click();
    await expect(measurementsPanel.getByRole("button", { name: "Shape closed ✓" })).toBeVisible();

    await measurementsPanel.locator("#freehandGroupId").selectOption({ label: "Deck" });

    // Leave the name empty and set a reference length, then submit --
    // the RPC's own re-validation rejects it and the name field turns red.
    await measurementsPanel.locator("#scaleReferenceLength").fill("10");
    await measurementsPanel.getByRole("button", { name: "Save drawn measurement" }).click();
    await expect(measurementsPanel.locator("#name-error")).toHaveText("Measurement name is required.");
    await expect(measurementsPanel.locator("#name")).toHaveAttribute("aria-invalid", "true");

    // Fill the name, clear the reference length -- Save stays clickable
    // (see docs/76-measurements-draw-validation-visible-fix.md: it's never
    // disabled just because a field is invalid), but clicking it with an
    // empty reference length shows a red, client-side error on that field
    // instead of silently doing nothing.
    await measurementsPanel.locator("#name").fill("Deck outline");
    await measurementsPanel.locator("#scaleReferenceLength").fill("");
    await expect(measurementsPanel.getByRole("button", { name: "Save drawn measurement" })).toBeEnabled();
    await measurementsPanel.getByRole("button", { name: "Save drawn measurement" }).click();
    await expect(measurementsPanel.locator("#scaleReferenceLength-error")).toHaveText("Enter a reference length greater than 0.");
    await expect(measurementsPanel.locator("#scaleReferenceLength")).toHaveAttribute("aria-invalid", "true");

    // Fill a valid reference length and save successfully.
    await measurementsPanel.locator("#scaleReferenceLength").fill("10");
    await measurementsPanel.getByRole("button", { name: "Save drawn measurement" }).click();
    await expect(measurementsPanel.locator("tr").filter({ hasText: "Deck outline" })).toBeVisible();

    // --- Proposal preview shows the custom service name ---
    await page.goto(`${proposalUrl}/preview`);
    await expect(page.getByText(customServiceName)).toBeVisible();
  });
});
