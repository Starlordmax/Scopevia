import { test, expect } from "@playwright/test";
import { authFile, uniqueSuffix } from "./fixtures/session";

/**
 * Runs only under the "mobile" Playwright project (390x844 — see
 * playwright.config.ts), same pattern as material-catalog.mobile.spec.ts.
 * Covers manual entry, the draw-layout rectangle (via mouse-emulated
 * pointer events — Playwright's mouse API dispatches real Pointer
 * Events, which is what the canvas listens for, so this exercises the
 * same code path a touch drag would), and generating labor (Labor step)
 * and a material (Materials & Costs step) from the saved measurement, all
 * with explicit no-horizontal-overflow checks. Also confirms Measurements
 * itself carries no generate panels, per docs/34-proposal-builder-ux.md.
 */
test.use({ storageState: authFile("owner-a") });

test.describe("Measurements / Takeoff builder (mobile, 390x844)", () => {
  test("manual entry, draw layout, and generate material all work with no horizontal overflow", async ({ page }) => {
    test.setTimeout(120_000);
    const suffix = uniqueSuffix();
    const clientName = `E2E Mobile Measurements Client ${suffix}`;

    await page.goto("/clients/new");
    await page.getByLabel("Display name").fill(clientName);
    await page.getByRole("button", { name: "Create client" }).click();
    await page.waitForURL(/\/clients\/[0-9a-f-]+$/);

    await page.goto("/proposals/new");
    await page.getByLabel("Client", { exact: true }).selectOption({ label: clientName });
    await page.waitForURL(/clientId=/);
    await page.getByLabel("Proposal title").fill(`E2E Mobile Measurements ${suffix}`);
    await page.getByLabel("Service type").selectOption("flooring");
    await page.getByRole("button", { name: "Save and continue" }).click();
    await page.waitForURL(/\/proposals\/[0-9a-f-]+\/edit\?step=measurements/);
    const proposalUrl = page.url().replace(/\/edit\?step=measurements$/, "");

    const viewportWidth = page.viewportSize()!.width;

    await page.goto(`${proposalUrl}/edit?step=measurements`);
    let scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(viewportWidth + 1);

    const measurementsPanel = page.locator(".section-card").filter({ has: page.getByRole("heading", { name: "Measurements" }) });

    // Manual entry, touch-friendly (plain form controls, no drag needed).
    await measurementsPanel.locator("#groupName").fill("Bedroom");
    await measurementsPanel.getByRole("button", { name: "+ Add group" }).click();
    await measurementsPanel.locator("#measurementGroupId").selectOption({ label: "Bedroom" });
    await measurementsPanel.locator("#name").fill("Bedroom floor");
    await measurementsPanel.locator("#length").fill("10");
    await measurementsPanel.locator("#width").fill("8");
    await expect(measurementsPanel.locator(".unsaved-preview-tile")).toContainText("80.00 sq ft");
    await measurementsPanel.getByRole("button", { name: "Save measurement" }).click();
    await expect(measurementsPanel.locator("tr").filter({ hasText: "Bedroom floor" })).toBeVisible();

    scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(viewportWidth + 1);

    // Draw layout, rectangle mode: drag a rectangle via mouse-emulated
    // pointer events (the canvas listens for Pointer Events, which
    // Playwright's mouse API dispatches regardless of device — the same
    // code path a real touch drag exercises). Freehand is now the default
    // drawing mode (Phase 2C.1), so explicitly switch to rectangle here.
    await measurementsPanel.getByRole("button", { name: "Draw layout" }).click();
    await measurementsPanel.locator("#drawingMode").selectOption("rectangle");
    const svg = measurementsPanel.locator("svg");
    await svg.scrollIntoViewIfNeeded();
    const box = (await svg.boundingBox())!;
    await page.mouse.move(box.x + 20, box.y + 20);
    await page.mouse.down();
    await page.mouse.move(box.x + 140, box.y + 100, { steps: 5 });
    await page.mouse.up();

    scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(viewportWidth + 1);

    await measurementsPanel.locator("#scaleReferenceLength").fill("12");
    await expect(measurementsPanel.locator(".unsaved-preview-tile").getByText(/sq ft$/)).toBeVisible();
    await measurementsPanel.locator("#drawRectGroupId").selectOption({ label: "Bedroom" });
    await measurementsPanel.locator("#name").fill("Bedroom sketch");
    await measurementsPanel.getByRole("button", { name: "Save drawn measurement" }).click();
    await expect(measurementsPanel.locator("tr").filter({ hasText: "Bedroom sketch" })).toBeVisible();

    scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(viewportWidth + 1);

    // Measurements itself carries no generate panels.
    await expect(page.getByRole("heading", { name: "Generate materials from a saved measurement" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Generate labor from a saved measurement" })).toHaveCount(0);

    // Labor: generate labor from the saved measurement, no overflow.
    await page.goto(`${proposalUrl}/edit?step=labor`);
    scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(viewportWidth + 1);

    const generateLaborPanel = page
      .locator(".section-card")
      .filter({ has: page.getByRole("heading", { name: "Generate labor from a saved measurement" }) });
    await generateLaborPanel.locator("#laborLabel").fill("Bedroom floor install labor");
    await generateLaborPanel.locator("#pricingMethod").selectOption("area");
    await generateLaborPanel.locator("#rateCents").fill("4.00");
    await generateLaborPanel.getByRole("button", { name: "Add labor to proposal" }).click();

    const savedLabor = page.locator(".section-card").filter({ has: page.getByRole("heading", { name: "Saved labor" }) });
    await expect(savedLabor.locator("tr").filter({ hasText: "Bedroom floor install labor" })).toBeVisible();
    scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(viewportWidth + 1);

    // Materials & Costs: set a ZIP so the catalog has local pricing, search, then generate a material.
    await page.goto(`${proposalUrl}/edit?step=materials`);
    await page.getByLabel("ZIP code").fill("33101");
    await page.getByRole("button", { name: "Save ZIP" }).click();

    await page.getByLabel("Search the material catalog").fill("Laminate Flooring");
    await page.getByRole("button", { name: "Search" }).click();
    await page.waitForURL(/catalogSearch=Laminate/);

    scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(viewportWidth + 1);

    const generateMaterialsPanel = page
      .locator(".section-card")
      .filter({ has: page.getByRole("heading", { name: "Generate materials from a saved measurement" }) });
    const laminateOption = generateMaterialsPanel.locator("#genMaterial option", { hasText: "Laminate Flooring" });
    const laminateOptionValue = await laminateOption.getAttribute("value");
    await generateMaterialsPanel.locator("#genMaterial").selectOption({ value: laminateOptionValue! });
    await generateMaterialsPanel.locator("#coverageRate").fill("1");
    await generateMaterialsPanel.getByRole("button", { name: "Add to proposal" }).click();

    const savedCosts = page.locator(".section-card").filter({ has: page.getByRole("heading", { name: "Saved costs" }) });
    await expect(savedCosts.locator("tr").filter({ hasText: "Laminate Flooring" })).toBeVisible();
    scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(viewportWidth + 1);
  });

  /**
   * Phase 2C.1: freehand/brush drawing via touch (mouse-emulated Pointer
   * Events, same justification as the rectangle-mode test above), the
   * primary/recommended drawing mode -- confirms it works at 390x844 with
   * no horizontal overflow at any step, and that material generation from
   * a freehand-derived area works the same as from a rectangle.
   */
  test("freehand draw, close shape, and generate material work with no horizontal overflow", async ({ page }) => {
    test.setTimeout(120_000);
    const suffix = uniqueSuffix();
    const clientName = `E2E Mobile Freehand Client ${suffix}`;

    await page.goto("/clients/new");
    await page.getByLabel("Display name").fill(clientName);
    await page.getByRole("button", { name: "Create client" }).click();
    await page.waitForURL(/\/clients\/[0-9a-f-]+$/);

    await page.goto("/proposals/new");
    await page.getByLabel("Client", { exact: true }).selectOption({ label: clientName });
    await page.waitForURL(/clientId=/);
    await page.getByLabel("Proposal title").fill(`E2E Mobile Freehand ${suffix}`);
    await page.getByLabel("Service type").selectOption("flooring");
    await page.getByRole("button", { name: "Save and continue" }).click();
    await page.waitForURL(/\/proposals\/[0-9a-f-]+\/edit\?step=measurements/);
    const proposalUrl = page.url().replace(/\/edit\?step=measurements$/, "");

    const viewportWidth = page.viewportSize()!.width;

    await page.goto(`${proposalUrl}/edit?step=measurements`);
    const measurementsPanel = page.locator(".section-card").filter({ has: page.getByRole("heading", { name: "Measurements" }) });

    await measurementsPanel.locator("#groupName").fill("Bathroom");
    await measurementsPanel.getByRole("button", { name: "+ Add group" }).click();

    let scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(viewportWidth + 1);

    await measurementsPanel.getByRole("button", { name: "Draw layout" }).click();
    await expect(measurementsPanel.locator("#drawingMode")).toHaveValue("freehand");

    scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(viewportWidth + 1);

    const svg = measurementsPanel.locator("svg");
    // page.mouse.move() dispatches at raw viewport coordinates and does not
    // auto-scroll (unlike locator actions) -- scroll the canvas into view first.
    await svg.scrollIntoViewIfNeeded();
    const box = (await svg.boundingBox())!;
    await page.mouse.move(box.x + 20, box.y + 20);
    await page.mouse.down();
    await page.mouse.move(box.x + 140, box.y + 20, { steps: 8 });
    await page.mouse.move(box.x + 140, box.y + 80, { steps: 8 });
    await page.mouse.move(box.x + 20, box.y + 80, { steps: 8 });
    await page.mouse.up();

    scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(viewportWidth + 1);

    await measurementsPanel.getByRole("button", { name: "Close shape" }).click();
    await expect(measurementsPanel.getByRole("button", { name: "Shape closed ✓" })).toBeVisible();

    await measurementsPanel.locator("#scaleReferenceLength").fill("12");
    await expect(measurementsPanel.locator(".unsaved-preview-tile").getByText(/sq ft$/)).toBeVisible();
    await measurementsPanel.locator("#freehandGroupId").selectOption({ label: "Bathroom" });
    await measurementsPanel.locator("#name").fill("Bathroom sketch (freehand)");

    scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(viewportWidth + 1);

    await measurementsPanel.getByRole("button", { name: "Save drawn measurement" }).click();
    await expect(measurementsPanel.locator("tr").filter({ hasText: "Bathroom sketch (freehand)" })).toBeVisible();

    scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(viewportWidth + 1);

    // Measurements itself carries no generate panels.
    await expect(page.getByRole("heading", { name: "Generate materials from a saved measurement" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Generate labor from a saved measurement" })).toHaveCount(0);

    // Labor: generate labor from the freehand-derived measurement, no overflow.
    await page.goto(`${proposalUrl}/edit?step=labor`);
    scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(viewportWidth + 1);

    const generateLaborPanel = page
      .locator(".section-card")
      .filter({ has: page.getByRole("heading", { name: "Generate labor from a saved measurement" }) });
    await generateLaborPanel.locator("#laborLabel").fill("Bathroom sketch install labor");
    await generateLaborPanel.locator("#pricingMethod").selectOption("area");
    await generateLaborPanel.locator("#rateCents").fill("4.00");
    await generateLaborPanel.getByRole("button", { name: "Add labor to proposal" }).click();

    const savedLabor = page.locator(".section-card").filter({ has: page.getByRole("heading", { name: "Saved labor" }) });
    await expect(savedLabor.locator("tr").filter({ hasText: "Bathroom sketch install labor" })).toBeVisible();
    scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(viewportWidth + 1);

    // Materials & Costs: set a ZIP so the catalog has local pricing, search, then generate a material from the freehand-derived area.
    await page.goto(`${proposalUrl}/edit?step=materials`);
    await page.getByLabel("ZIP code").fill("33101");
    await page.getByRole("button", { name: "Save ZIP" }).click();

    await page.getByLabel("Search the material catalog").fill("Laminate Flooring");
    await page.getByRole("button", { name: "Search" }).click();
    await page.waitForURL(/catalogSearch=Laminate/);

    scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(viewportWidth + 1);

    const generateMaterialsPanel = page
      .locator(".section-card")
      .filter({ has: page.getByRole("heading", { name: "Generate materials from a saved measurement" }) });
    const laminateOption = generateMaterialsPanel.locator("#genMaterial option", { hasText: "Laminate Flooring" });
    const laminateOptionValue = await laminateOption.getAttribute("value");
    await generateMaterialsPanel.locator("#genMaterial").selectOption({ value: laminateOptionValue! });
    await generateMaterialsPanel.locator("#coverageRate").fill("1");
    await generateMaterialsPanel.getByRole("button", { name: "Add to proposal" }).click();

    const savedCosts = page.locator(".section-card").filter({ has: page.getByRole("heading", { name: "Saved costs" }) });
    await expect(savedCosts.locator("tr").filter({ hasText: "Laminate Flooring" })).toBeVisible();
    scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(viewportWidth + 1);
  });
});
