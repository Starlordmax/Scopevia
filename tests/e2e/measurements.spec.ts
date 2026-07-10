import { test, expect } from "@playwright/test";
import { authFile, uniqueSuffix } from "./fixtures/session";

/**
 * The brief's exact worked scenario end-to-end: create proposal -> go to
 * Measurements -> add a manual room (20ft x 15ft, confirm area 300 sq
 * ft) -> set a ZIP in Materials & Costs -> generate a flooring material
 * from the measurement (confirm the waste-adjusted quantity) -> generate
 * labor by area -> confirm the proposal total -> confirm Preview shows
 * the measurement plus what it generated. See
 * docs/45-measurements-takeoff-builder.md.
 */
test.describe("Measurements / Takeoff builder", () => {
  test.use({ storageState: authFile("owner-a") });

  test("manual room measurement -> generate flooring material with waste -> generate area labor -> total and preview", async ({ page }) => {
    test.setTimeout(120_000);
    const suffix = uniqueSuffix();
    const clientName = `E2E Measurements Client ${suffix}`;
    const proposalTitle = `E2E Measurements Proposal ${suffix}`;

    await page.goto("/clients/new");
    await page.getByLabel("Display name").fill(clientName);
    await page.getByRole("button", { name: "Create client" }).click();
    await page.waitForURL(/\/clients\/[0-9a-f-]+$/);

    await page.goto("/proposals/new");
    await page.getByLabel("Client").selectOption({ label: clientName });
    await page.waitForURL(/clientId=/);
    await page.getByLabel("Proposal title").fill(proposalTitle);
    await page.getByLabel("Service type").selectOption("flooring");
    await page.getByRole("button", { name: "Save and continue" }).click();
    await page.waitForURL(/\/proposals\/[0-9a-f-]+\/edit\?step=scope/);
    const proposalUrl = page.url().replace(/\/edit\?step=scope$/, "");

    // --- Measurements step: manual room entry ---
    await page.goto(`${proposalUrl}/edit?step=measurements`);
    const measurementsPanel = page.locator(".section-card").filter({ has: page.getByRole("heading", { name: "Measurements" }) });

    await measurementsPanel.locator("#groupName").fill("Living Room");
    await measurementsPanel.getByRole("button", { name: "+ Add group" }).click();
    await expect(measurementsPanel.locator("#measurementGroupId option", { hasText: "Living Room" })).toHaveCount(1);

    await measurementsPanel.locator("#measurementGroupId").selectOption({ label: "Living Room" });
    await measurementsPanel.locator("#measurementName").fill("Living room floor");
    // measurementType defaults to floor_area, shapeType defaults to manual_rectangle -- exactly what this scenario needs.
    await measurementsPanel.locator("#length").fill("20");
    await measurementsPanel.locator("#width").fill("15");
    await expect(measurementsPanel.getByText("Not saved yet.")).toBeVisible();
    await expect(measurementsPanel.locator(".unsaved-preview-tile")).toContainText("300.00 sq ft");

    await measurementsPanel.getByRole("button", { name: "Save measurement" }).click();
    const savedRow = measurementsPanel.locator("tr").filter({ hasText: "Living room floor" });
    await expect(savedRow).toBeVisible();
    await expect(savedRow).toContainText("300");

    // --- Set a ZIP in Materials & Costs so the catalog has local pricing ---
    await page.goto(`${proposalUrl}/edit?step=materials`);
    await page.getByLabel("ZIP code").fill("33101");
    await page.getByRole("button", { name: "Save ZIP" }).click();

    // --- Back to Measurements: generate a flooring material from the measurement ---
    await page.goto(`${proposalUrl}/edit?step=measurements`);
    const generatePanel = page.locator(".section-card").filter({ has: page.getByRole("heading", { name: "Generate materials from measurement" }) });

    await generatePanel.getByLabel("Search the material catalog").fill("Laminate Flooring");
    await generatePanel.getByRole("button", { name: "Search" }).click();
    await page.waitForURL(/catalogSearch=Laminate/);

    const laminateOption = generatePanel.locator("#genMaterial option", { hasText: "Laminate Flooring" });
    await expect(laminateOption).toHaveCount(1);
    const laminateOptionValue = await laminateOption.getAttribute("value");
    await generatePanel.locator("#genMaterial").selectOption({ value: laminateOptionValue! });
    await generatePanel.locator("#measurementValueField").selectOption("area");
    await generatePanel.locator("#coverageRate").fill("1");
    await generatePanel.locator("#coats").fill("1");
    await generatePanel.locator("#genWaste").fill("10");
    await generatePanel.getByRole("button", { name: "Add to proposal" }).click();

    // --- Generate labor by area ($4.00/sq ft x 300 sq ft = $1,200.00) ---
    await generatePanel.locator("#laborLabel").fill("Flooring install labor");
    await generatePanel.locator("#pricingMethod").selectOption("area");
    await generatePanel.locator("#laborRate").fill("4.00");
    await generatePanel.getByRole("button", { name: "Add labor to proposal" }).click();

    // --- Confirm the generated material landed in Materials & Costs' Saved
    // costs with the waste-adjusted quantity: 300 sq ft x 1 coat x 1.10
    // waste / 1 coverage = 330 sq ft, at $3.50/sq ft (ZIP 33101) = $1,155.00 ---
    await page.goto(`${proposalUrl}/edit?step=materials`);
    const savedCosts = page.locator(".section-card").filter({ has: page.getByRole("heading", { name: "Saved costs" }) });
    const laminateRow = savedCosts.locator("tr").filter({ hasText: "Laminate Flooring" });
    await expect(laminateRow).toContainText("330");
    await expect(laminateRow).toContainText("$1,155.00");

    // --- Confirm the proposal total: $1,155.00 material + $1,200.00 labor = $2,355.00 ---
    await page.goto(proposalUrl);
    await expect(page.getByText("$1,200.00").first()).toBeVisible(); // Labor tile
    await expect(page.getByText("$1,155.00").first()).toBeVisible(); // Materials & costs tile
    await expect(page.getByText("$2,355.00").first()).toBeVisible(); // Total tile

    // --- Preview shows the measurement and what it generated, no canvas/JSON/IDs ---
    await page.goto(`${proposalUrl}/preview`);
    // exact: true -- the proposal's own title ("E2E Measurements Proposal
    // ...") otherwise substring-matches "Measurements" too.
    await expect(page.getByRole("heading", { name: "Measurements", exact: true })).toBeVisible();
    const previewRow = page.locator("tr").filter({ hasText: "Living room floor" });
    await expect(previewRow).toContainText("Living Room"); // group name shown as a hint
    await expect(previewRow).toContainText("300");
    await expect(previewRow).toContainText("Material: Laminate Flooring");
    await expect(previewRow).toContainText("Labor: Flooring install labor");
    await expect(page.getByText(/proposal_measurement_id|shape_data|measurement_type=|"points"/)).toHaveCount(0);
  });
});
