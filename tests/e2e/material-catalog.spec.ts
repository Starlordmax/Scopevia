import { test, expect } from "@playwright/test";
import { authFile, uniqueSuffix } from "./fixtures/session";

/**
 * The brief's exact worked scenario end-to-end: create proposal -> ZIP
 * 33101 -> search "Paint" -> add Interior Paint qty 3 (-> $126.00) ->
 * change ZIP to 78701 -> add another material -> confirm the FIRST item
 * still shows its original (33101) price, unaffected -> add a custom cost
 * -> confirm total -> delete proposal -> confirm it disappears from
 * Active -> Archived -> restore -> confirm it's back in Active with total
 * intact. See docs/42-material-catalog-by-zip.md.
 */
test.describe("Material catalog by ZIP", () => {
  test.use({ storageState: authFile("owner-a") });

  test("browse, add from catalog with ZIP-based pricing, change ZIP without disturbing existing items, add a custom cost, then delete/restore", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const suffix = uniqueSuffix();
    const clientName = `E2E Catalog Client ${suffix}`;
    const proposalTitle = `E2E Catalog Proposal ${suffix}`;

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
    await page.waitForURL(/\/proposals\/[0-9a-f-]+\/edit\?step=measurements/);
    const proposalUrl = page.url().replace(/\/edit\?step=measurements$/, "");

    await page.goto(`${proposalUrl}/edit?step=materials`);

    // Set the pricing ZIP to Miami.
    await page.getByLabel("ZIP code").fill("33101");
    await page.getByRole("button", { name: "Save ZIP" }).click();
    await expect(page.getByText("Changing ZIP code only affects new materials you add.")).toBeVisible();

    // ZIP + search + results all live in one "Material pricing" panel.
    // Scoped specifically — the "Saved costs" table below it also gets a
    // row named "Interior Paint" once added, and both tables are on
    // screen at once.
    const catalogTable = page.locator(".section-card").filter({ has: page.getByRole("heading", { name: "Material pricing" }) });
    await page.getByLabel("Search the material catalog").fill("Paint");
    await page.getByRole("button", { name: "Search" }).click();
    await page.waitForURL(/catalogSearch=Paint/);
    await expect(catalogTable.getByRole("heading", { name: "Results for ZIP 33101" })).toBeVisible();

    const interiorPaintRow = catalogTable.locator("tr").filter({ hasText: "Interior Paint" });
    await expect(interiorPaintRow).toBeVisible();
    await expect(interiorPaintRow).toContainText("$42.00");

    await interiorPaintRow.getByLabel("Quantity").fill("3");
    await interiorPaintRow.getByRole("button", { name: "Add to proposal" }).click();

    // Saved, snapshotted: $42.00 x 3 = $126.00.
    const savedCosts = page.locator(".section-card").filter({ has: page.getByRole("heading", { name: "Saved costs" }) });
    await expect(savedCosts.getByRole("cell", { name: "Interior Paint" })).toBeVisible();
    await expect(savedCosts.getByText("via catalog — ZIP 33101")).toBeVisible();
    await expect(savedCosts.getByText("Saved materials & costs subtotal:").locator("..")).toContainText("$126.00");

    // Change the ZIP to Austin, then add another material.
    await page.getByLabel("ZIP code").fill("78701");
    await page.getByRole("button", { name: "Save ZIP" }).click();
    await expect(page.getByLabel("ZIP code")).toHaveValue("78701");

    await page.getByLabel("Search the material catalog").fill("Paint");
    await page.getByRole("button", { name: "Search" }).click();
    await page.waitForURL(/catalogSearch=Paint/);

    const interiorPaintRowAustin = catalogTable.locator("tr").filter({ hasText: "Interior Paint" });
    await expect(interiorPaintRowAustin).toContainText("$38.00");
    await interiorPaintRowAustin.getByLabel("Quantity").fill("1");
    await interiorPaintRowAustin.getByRole("button", { name: "Add to proposal" }).click();

    // The FIRST item (added at 33101) must be completely unaffected by the
    // ZIP change — this is the core "snapshot, not live reference"
    // guarantee. Scoped to the Saved costs table specifically (the search
    // results table above it also has rows, but is a different table and
    // outside this locator).
    const firstItemRow = savedCosts.locator("tr").filter({ hasText: "via catalog — ZIP 33101" });
    await expect(firstItemRow).toContainText("$42.00");
    await expect(firstItemRow).toContainText("$126.00");
    await expect(savedCosts.getByText("Saved materials & costs subtotal:").locator("..")).toContainText("$164.00"); // 126 + 38

    // Add a custom (non-catalog) cost.
    const customCostSection = page.locator(".section-card").filter({ has: page.getByRole("heading", { name: "Add a custom cost" }) });
    await customCostSection.getByLabel("Description").fill("Job site cleanup fee");
    await customCostSection.getByLabel("Quantity").fill("1");
    await customCostSection.getByLabel("Unit price ($)").fill("25");
    await customCostSection.getByRole("button", { name: "+ Add cost item" }).click();
    await expect(savedCosts.getByRole("cell", { name: "Job site cleanup fee" })).toBeVisible();
    await expect(savedCosts.getByText("Saved materials & costs subtotal:").locator("..")).toContainText("$189.00"); // 126 + 38 + 25

    // Delete (archive) the proposal, confirm it vanishes from Active and
    // appears in Archived, then restore it with the total intact.
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

    await page.goto("/proposals");
    await expect(page.getByText(proposalTitle)).toHaveCount(0);
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
    await page.goto(proposalUrl);
    await expect(page.getByText("$189.00").first()).toBeVisible();
  });

  test("a material with no price for the current ZIP shows 'No price available' and cannot be added at zero cost", async ({ browser }) => {
    // Sales (proposals.update, no manage_pricing) has no override field at
    // all, so a no-price item's Add button must be disabled outright —
    // Owner/Estimator (manage_pricing) keep it enabled since they could
    // still type an explicit override price.
    const salesContext = await browser.newContext({ storageState: authFile("sales-a") });
    const page = await salesContext.newPage();
    const suffix = uniqueSuffix();
    const clientName = `E2E No Price Client ${suffix}`;

    await page.goto("/clients/new");
    await page.getByLabel("Display name").fill(clientName);
    await page.getByRole("button", { name: "Create client" }).click();
    await page.waitForURL(/\/clients\/[0-9a-f-]+$/);

    await page.goto("/proposals/new");
    await page.getByLabel("Client").selectOption({ label: clientName });
    await page.waitForURL(/clientId=/);
    await page.getByLabel("Proposal title").fill(`E2E No Price ${suffix}`);
    await page.getByLabel("Service type").selectOption("flooring");
    await page.getByRole("button", { name: "Save and continue" }).click();
    await page.waitForURL(/\/proposals\/[0-9a-f-]+\/edit\?step=measurements/);
    const proposalUrl = page.url().replace(/\/edit\?step=measurements$/, "");

    await page.goto(`${proposalUrl}/edit?step=materials`);
    await page.getByLabel("ZIP code").fill("33101");
    await page.getByRole("button", { name: "Save ZIP" }).click();

    await page.getByLabel("Search the material catalog").fill("Construction Debris Disposal");
    await page.getByRole("button", { name: "Search" }).click();
    await page.waitForURL(/catalogSearch=/);

    const debrisRow = page.locator("tr").filter({ hasText: "Construction Debris Disposal" });
    await expect(debrisRow).toContainText("No price available for this ZIP");
    // Sales has no manage_pricing, so no override field is rendered at all
    // -- the Add button must stay disabled rather than silently adding at $0.
    await expect(debrisRow.getByRole("button", { name: "Add to proposal" })).toBeDisabled();
  });

  test("category filter narrows results and updates the results heading", async ({ page }) => {
    const suffix = uniqueSuffix();
    const clientName = `E2E Category Filter Client ${suffix}`;

    await page.goto("/clients/new");
    await page.getByLabel("Display name").fill(clientName);
    await page.getByRole("button", { name: "Create client" }).click();
    await page.waitForURL(/\/clients\/[0-9a-f-]+$/);

    await page.goto("/proposals/new");
    await page.getByLabel("Client").selectOption({ label: clientName });
    await page.waitForURL(/clientId=/);
    await page.getByLabel("Proposal title").fill(`E2E Category Filter ${suffix}`);
    await page.getByLabel("Service type").selectOption("bathroom_remodeling");
    await page.getByRole("button", { name: "Save and continue" }).click();
    await page.waitForURL(/\/proposals\/[0-9a-f-]+\/edit\?step=measurements/);
    const proposalUrl = page.url().replace(/\/edit\?step=measurements$/, "");

    await page.goto(`${proposalUrl}/edit?step=materials`);
    const catalogTable = page.locator(".section-card").filter({ has: page.getByRole("heading", { name: "Material pricing" }) });

    await page.getByLabel("ZIP code").fill("33101");
    await page.getByRole("button", { name: "Save ZIP" }).click();

    // Scoped to the catalog panel — "Add a custom cost" below it has its
    // own, differently-optioned "Category" select.
    await catalogTable.getByLabel("Category").selectOption("plumbing");
    await catalogTable.getByRole("button", { name: "Search" }).click();
    await page.waitForURL(/catalogCategory=plumbing/);

    await expect(catalogTable.getByRole("heading", { name: "Showing plumbing materials for ZIP 33101" })).toBeVisible();
    const rows = catalogTable.locator("tbody tr");
    await expect(rows).toHaveCount(3);
    await expect(catalogTable).toContainText("Toilet, Standard");
    await expect(catalogTable).toContainText("Bathtub, Standard");
    await expect(catalogTable).toContainText("Shower Fixture Set");
    // Confirms this isn't a name-only match — none of these names contain
    // "plumbing" as a substring, so a working category filter (not a
    // coincidental text match) is what's actually narrowing the list.
    await expect(catalogTable).not.toContainText("Interior Paint");
  });

  test("empty states: no ZIP yet, no match for a search, and materials with no price for the ZIP", async ({ page }) => {
    const suffix = uniqueSuffix();
    const clientName = `E2E Empty States Client ${suffix}`;

    await page.goto("/clients/new");
    await page.getByLabel("Display name").fill(clientName);
    await page.getByRole("button", { name: "Create client" }).click();
    await page.waitForURL(/\/clients\/[0-9a-f-]+$/);

    await page.goto("/proposals/new");
    await page.getByLabel("Client").selectOption({ label: clientName });
    await page.waitForURL(/clientId=/);
    await page.getByLabel("Proposal title").fill(`E2E Empty States ${suffix}`);
    await page.getByLabel("Service type").selectOption("custom");
    await page.getByRole("button", { name: "Save and continue" }).click();
    await page.waitForURL(/\/proposals\/[0-9a-f-]+\/edit\?step=measurements/);
    const proposalUrl = page.url().replace(/\/edit\?step=measurements$/, "");

    // Case A: no ZIP saved yet, no filters -> the base catalog still has
    // rows (price-less), so this only shows the "enter a ZIP" hint when a
    // filter narrows it to zero, e.g. a nonsense search.
    await page.goto(`${proposalUrl}/edit?step=materials`);
    const catalogTable = page.locator(".section-card").filter({ has: page.getByRole("heading", { name: "Material pricing" }) });
    await catalogTable.getByLabel("Search the material catalog").fill("zzz-no-such-material-zzz");
    await catalogTable.getByRole("button", { name: "Search" }).click();
    await page.waitForURL(/catalogSearch=/);
    await expect(catalogTable.getByText("Enter a ZIP code to load material pricing.")).toBeVisible();

    // Case B: ZIP set, search matches nothing.
    await page.getByLabel("ZIP code").fill("33101");
    await page.getByRole("button", { name: "Save ZIP" }).click();
    await catalogTable.getByLabel("Search the material catalog").fill("zzz-no-such-material-zzz");
    await catalogTable.getByRole("button", { name: "Search" }).click();
    await page.waitForURL(/catalogSearch=/);
    await expect(catalogTable.getByText("No materials match your search for this ZIP code. Try a different keyword, category, or add a custom cost below.")).toBeVisible();

    // Case C: ZIP set to one with no coverage at all for any material
    // (outside the 4 seeded demo ZIPs and not the global-default items) —
    // materials list, but none priced.
    await page.getByLabel("ZIP code").fill("55555");
    await page.getByRole("button", { name: "Save ZIP" }).click();
    await catalogTable.getByLabel("Search the material catalog").fill("Bathtub");
    await catalogTable.getByRole("button", { name: "Search" }).click();
    await page.waitForURL(/catalogSearch=Bathtub/);
    await expect(catalogTable.getByText("No price is available for these materials in this ZIP code. Try another ZIP code or add a custom cost.")).toBeVisible();
    await expect(catalogTable.getByRole("cell", { name: "Bathtub, Standard" })).toBeVisible();
  });

  test("catalog results are paginated: first page caps at 20, 'Load more' reveals the rest, add-to-proposal still works after loading more", async ({
    page,
  }) => {
    const suffix = uniqueSuffix();
    const clientName = `E2E Pagination Client ${suffix}`;

    await page.goto("/clients/new");
    await page.getByLabel("Display name").fill(clientName);
    await page.getByRole("button", { name: "Create client" }).click();
    await page.waitForURL(/\/clients\/[0-9a-f-]+$/);

    await page.goto("/proposals/new");
    await page.getByLabel("Client").selectOption({ label: clientName });
    await page.waitForURL(/clientId=/);
    await page.getByLabel("Proposal title").fill(`E2E Pagination ${suffix}`);
    await page.getByLabel("Service type").selectOption("custom");
    await page.getByRole("button", { name: "Save and continue" }).click();
    await page.waitForURL(/\/proposals\/[0-9a-f-]+\/edit\?step=measurements/);
    const proposalUrl = page.url().replace(/\/edit\?step=measurements$/, "");

    await page.goto(`${proposalUrl}/edit?step=materials`);
    const catalogTable = page.locator(".section-card").filter({ has: page.getByRole("heading", { name: "Material pricing" }) });

    // No search/category filter -> the full seeded catalog (26+ items)
    // matches, but only the first page should ever render.
    await page.getByLabel("ZIP code").fill("33101");
    await page.getByRole("button", { name: "Save ZIP" }).click();
    await expect(catalogTable.getByRole("heading", { name: "Results for ZIP 33101" })).toBeVisible();

    const rows = catalogTable.locator("tbody tr");
    await expect(rows).toHaveCount(20);
    await expect(catalogTable.getByText(/^Showing 20 of \d+ materials\.$/)).toBeVisible();
    const loadMoreButton = catalogTable.getByRole("button", { name: "Load more materials" });
    await expect(loadMoreButton).toBeVisible();

    await loadMoreButton.click();
    await page.waitForURL(/catalogLimit=40/);

    // The full catalog is under 40, so the second page shows everything
    // and "Load more" disappears (hasMore is now false).
    const rowCountAfterLoadMore = await rows.count();
    expect(rowCountAfterLoadMore).toBeGreaterThan(20);
    await expect(catalogTable.getByText(new RegExp(`^Showing ${rowCountAfterLoadMore} of ${rowCountAfterLoadMore} materials\\.$`))).toBeVisible();
    await expect(catalogTable.getByRole("button", { name: "Load more materials" })).toHaveCount(0);

    // Add-to-proposal still works on a row only visible after "Load more"
    // — owner-a has manage_pricing, so an explicit override price makes
    // this deterministic regardless of whether the last alphabetical
    // item happens to already have a resolved ZIP price.
    const lastRow = rows.last();
    await lastRow.getByLabel(/^Quantity/).fill("2");
    await lastRow.getByPlaceholder("Override price ($)").fill("10.00");
    await lastRow.getByRole("button", { name: "Add to proposal" }).click();
    const savedCosts = page.locator(".section-card").filter({ has: page.getByRole("heading", { name: "Saved costs" }) });
    await expect(savedCosts.locator("tbody tr")).toHaveCount(1);
  });
});
