import { test, expect } from "@playwright/test";
import { authFile, uniqueSuffix } from "./fixtures/session";

/**
 * Runs only under the "mobile" Playwright project (390x844 — see
 * playwright.config.ts), same pattern as proposals.mobile.spec.ts. Covers
 * the same worked scenario as material-catalog.spec.ts (ZIP-based catalog
 * search, add-from-catalog, ZIP change scoping) plus delete/restore, with
 * mobile-specific layout assertions (no horizontal overflow, usable touch
 * targets) rather than duplicating every desktop assertion.
 */
test.use({ storageState: authFile("owner-a") });

test.describe("Material catalog by ZIP (mobile, 390x844)", () => {
  test("ZIP entry, catalog search, add-from-catalog, and delete/restore all work with no horizontal overflow", async ({ page }) => {
    test.setTimeout(120_000);
    const suffix = uniqueSuffix();
    const clientName = `E2E Mobile Catalog Client ${suffix}`;
    const proposalTitle = `E2E Mobile Catalog Proposal ${suffix}`;

    await page.goto("/clients/new");
    await page.getByLabel("Display name").fill(clientName);
    await page.getByRole("button", { name: "Create client" }).click();
    await page.waitForURL(/\/clients\/[0-9a-f-]+$/);

    await page.goto("/proposals/new");
    await page.getByLabel("Client").selectOption({ label: clientName });
    await page.waitForURL(/clientId=/);
    await page.getByLabel("Proposal title").fill(proposalTitle);
    await page.getByLabel("Service type").selectOption("interior_painting");
    await page.getByRole("button", { name: "Save and continue" }).click();
    await page.waitForURL(/\/proposals\/[0-9a-f-]+\/edit\?step=scope/);
    const proposalUrl = page.url().replace(/\/edit\?step=scope$/, "");

    const viewportWidth = page.viewportSize()!.width;

    await page.goto(`${proposalUrl}/edit?step=materials`);
    let scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(viewportWidth + 1);

    await page.getByLabel("ZIP code").fill("33101");
    const saveZipButton = page.getByRole("button", { name: "Save ZIP" });
    const saveZipBox = await saveZipButton.boundingBox();
    expect(saveZipBox).not.toBeNull();
    if (saveZipBox) expect(saveZipBox.height).toBeGreaterThanOrEqual(32); // adequate touch target
    await saveZipButton.click();
    await expect(page.getByText("Changing ZIP code only affects new materials you add.")).toBeVisible();

    await page.getByLabel("Search the material catalog").fill("Interior Paint");
    await page.getByRole("button", { name: "Search" }).click();
    await page.waitForURL(/catalogSearch=/);
    scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(viewportWidth + 1);

    const interiorPaintRow = page.locator("tr").filter({ hasText: "Interior Paint" });
    await expect(interiorPaintRow).toContainText("$42.00");
    await interiorPaintRow.getByLabel("Quantity").fill("3");
    await interiorPaintRow.getByRole("button", { name: "Add to proposal" }).click();

    const savedCosts = page.locator(".section-card").filter({ has: page.getByRole("heading", { name: "Saved costs" }) });
    await expect(savedCosts.getByRole("cell", { name: "Interior Paint" })).toBeVisible();
    await expect(savedCosts.getByText("Saved materials & costs subtotal:").locator("..")).toContainText("$126.00");
    scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(viewportWidth + 1);

    // Delete and restore, from the collapsed "Danger zone" section.
    await page.goto(proposalUrl);
    await page.getByText("Danger zone").click();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Delete proposal" }).click();
    await expect
      .poll(
        async () => {
          await page.reload();
          return page.locator(".badge").filter({ hasText: "archived" }).count();
        },
        { timeout: 30_000 }
      )
      .toBeGreaterThan(0);

    await page.goto("/proposals?view=archived");
    await expect(page.getByText(proposalTitle)).toBeVisible();

    await page.goto(proposalUrl);
    await page.getByText("Danger zone").click();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Restore proposal" }).click();
    await expect
      .poll(
        async () => {
          await page.reload();
          return page.locator(".badge").filter({ hasText: "draft" }).count();
        },
        { timeout: 30_000 }
      )
      .toBeGreaterThan(0);

    await page.goto("/proposals");
    await expect(page.getByText(proposalTitle)).toBeVisible();
  });
});
