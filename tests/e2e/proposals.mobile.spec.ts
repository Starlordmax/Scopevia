import { test, expect } from "@playwright/test";
import { authFile, uniqueSuffix } from "./fixtures/session";

/**
 * Runs only under the "mobile" Playwright project (390x844 — see
 * playwright.config.ts), same pattern as pipeline.mobile.spec.ts.
 */
test.use({ storageState: authFile("owner-a") });

test.describe("Proposal Builder (mobile, 390x844)", () => {
  test("stepper, forms, and pricing summary are usable with no horizontal overflow", async ({ page }) => {
    const suffix = uniqueSuffix();
    const clientName = `E2E Mobile Proposal Client ${suffix}`;

    await page.goto("/clients/new");
    await page.getByLabel("Display name").fill(clientName);
    await page.getByRole("button", { name: "Create client" }).click();
    await page.waitForURL(/\/clients\/[0-9a-f-]+$/);

    await page.goto("/proposals/new");
    await page.getByLabel("Client").selectOption({ label: clientName });
    await page.waitForURL(/clientId=/);
    await page.getByLabel("Proposal title").fill(`E2E Mobile Proposal ${suffix}`);
    await page.getByLabel("Service type").selectOption("interior_painting");
    await page.getByRole("button", { name: "Save and continue" }).click();
    await page.waitForURL(/step=scope/);

    const viewportWidth = page.viewportSize()!.width;
    let scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(viewportWidth + 1);

    // The stepper must scroll horizontally within its own container (not the
    // page) and every step must remain reachable by tapping.
    await expect(page.locator(".proposal-stepper")).toBeVisible();

    await page.getByRole("link", { name: "Continue to Labor" }).click();
    await page.waitForURL(/step=labor/);
    await page.getByLabel("Label").fill("Lead painter");
    await page.getByLabel("Workers").fill("2");
    await page.getByLabel("Days").fill("5");
    await page.getByLabel("Hours/day").fill("8");
    await page.getByLabel("Rate per hour ($)").fill("30");
    await page.getByRole("button", { name: "+ Add labor item" }).click();
    await expect(page.getByRole("cell", { name: "Lead painter" })).toBeVisible();

    scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(viewportWidth + 1);

    // The live preview tile must fit within the viewport, not overflow off-screen.
    const previewTile = page.locator(".metric-tile").last();
    const box = await previewTile.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewportWidth + 1);

    await page.getByRole("link", { name: "Continue to Materials & Costs" }).click();
    await page.waitForURL(/step=materials/);
    // Scoped to "Add a custom cost" — the material catalog's per-row Add
    // forms above it also have a "Quantity — <material name>" field whose
    // accessible name contains "Quantity" as a substring (Playwright's
    // getByLabel default match).
    const customCostSection = page.locator(".section-card").filter({ has: page.getByRole("heading", { name: "Add a custom cost" }) });
    await customCostSection.getByLabel("Description").fill("Exterior paint");
    await customCostSection.getByLabel("Quantity").fill("5");
    await customCostSection.getByLabel("Unit price ($)").fill("40");
    await customCostSection.getByRole("button", { name: "+ Add cost item" }).click();
    // Scoped to "Saved costs" — the material catalog's own results table
    // above it has a real "Exterior Paint" row too (case-insensitive
    // substring match would otherwise make this ambiguous).
    const savedCosts = page.locator(".section-card").filter({ has: page.getByRole("heading", { name: "Saved costs" }) });
    await expect(savedCosts.getByRole("cell", { name: "Exterior paint" })).toBeVisible();

    await page.getByRole("link", { name: "Continue to Photos" }).click();
    await page.waitForURL(/step=photos/);
    scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(viewportWidth + 1);

    // The upload button must be reachable and clearly a positive action on
    // a small viewport too — see docs/41-photo-gallery-ui-fix.md.
    const uploadButton = page.getByRole("button", { name: "Upload job photo" });
    await expect(uploadButton).toHaveClass(/button-success/);
    const uploadBox = await uploadButton.boundingBox();
    expect(uploadBox).not.toBeNull();
    if (uploadBox) {
      expect(uploadBox.x + uploadBox.width).toBeLessThanOrEqual(viewportWidth + 1);
      expect(uploadBox.height).toBeGreaterThanOrEqual(36); // adequate touch target
    }

    // Scoped to the "Current job photos" section specifically: .photo-thumb
    // is also used by the (collapsed) "Select from Portfolio" picker further
    // down this same page, which can independently contain tenant-wide
    // portfolio photos left over from other tests sharing this tenant —
    // an unscoped page-wide locator would be ambiguous (Playwright strict
    // mode) or match the wrong section's thumbnail entirely.
    const currentJobSection = page.locator(".section-card").filter({ has: page.getByRole("heading", { name: "Current job photos" }) });

    const filePath = require.resolve("./fixtures/one-pixel.png");
    await page.getByLabel("Upload a photo").setInputFiles(filePath);
    await uploadButton.click();
    await expect(currentJobSection.locator(".photo-thumb")).toBeVisible({ timeout: 15_000 });
    scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(viewportWidth + 1);
    const thumbBox = await currentJobSection.locator(".photo-thumb").first().boundingBox();
    expect(thumbBox).not.toBeNull();
    if (thumbBox) {
      // Two columns fit at this viewport width — a thumbnail must not
      // stretch to fill the whole screen.
      expect(thumbBox.width).toBeLessThan(viewportWidth * 0.7);
    }

    await page.getByRole("link", { name: "Continue to Terms & Pricing" }).click();
    await page.waitForURL(/step=pricing/);
    await page.getByLabel("Tax rate (%)").fill("7");
    await page.getByRole("button", { name: "Save and continue" }).click();
    await page.waitForURL(/step=review/);

    // The document/pricing summary must be readable without horizontal scroll,
    // and must show the real computed total — never a stale $0.00.
    scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(viewportWidth + 1);
    await expect(page.locator(".pricing-summary-total")).toBeVisible();
    await expect(page.locator(".pricing-summary-row").filter({ hasText: "Labor" })).toContainText("$2,400.00");
    await expect(page.locator(".pricing-summary-total")).not.toContainText("$0.00");

    // Bottom nav includes Proposals and is fully within the viewport.
    const bottomNavProposals = page.locator(".bottom-nav-link", { hasText: "Proposals" });
    await expect(bottomNavProposals).toBeVisible();
    const navBox = await bottomNavProposals.boundingBox();
    expect(navBox).not.toBeNull();
    expect(navBox!.x).toBeGreaterThanOrEqual(0);
    expect(navBox!.x + navBox!.width).toBeLessThanOrEqual(viewportWidth + 1);
  });

  test("Preview page is readable on mobile with no horizontal overflow", async ({ page }) => {
    const suffix = uniqueSuffix();
    const clientName = `E2E Mobile Preview Client ${suffix}`;

    await page.goto("/clients/new");
    await page.getByLabel("Display name").fill(clientName);
    await page.getByRole("button", { name: "Create client" }).click();
    await page.waitForURL(/\/clients\/[0-9a-f-]+$/);

    await page.goto("/proposals/new");
    await page.getByLabel("Client").selectOption({ label: clientName });
    await page.waitForURL(/clientId=/);
    await page.getByLabel("Proposal title").fill(`E2E Mobile Preview ${suffix}`);
    await page.getByLabel("Service type").selectOption("custom");
    await page.getByRole("button", { name: "Save and continue" }).click();
    await page.waitForURL(/step=scope/);

    const proposalUrl = page.url().replace(/\/edit\?step=scope$/, "");
    await page.goto(`${proposalUrl}/preview`);

    const viewportWidth = page.viewportSize()!.width;
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(viewportWidth + 1);
    await expect(page.getByRole("heading", { name: /E2E Mobile Preview/ })).toBeVisible();
  });
});
