import { test, expect } from "@playwright/test";
import { authFile, uniqueSuffix } from "./fixtures/session";

test.describe("Proposals — full builder flow", () => {
  test.use({ storageState: authFile("owner-a") });

  test("client -> proposal -> scope -> labor -> materials -> photos -> pricing -> preview -> ready -> dashboard -> draft -> archive -> restore", async ({ page }) => {
    // This is the longest single flow in the suite (client, proposal,
    // every builder step, mark ready, dashboard, draft, archive, restore)
    // — the default 60s budget is too tight under real network latency.
    test.setTimeout(120_000);
    const suffix = uniqueSuffix();
    const clientName = `E2E Proposal Client ${suffix}`;
    const proposalTitle = `E2E Proposal ${suffix}`;

    await page.goto("/clients/new");
    await page.getByLabel("Display name").fill(clientName);
    await page.getByRole("button", { name: "Create client" }).click();
    await page.waitForURL(/\/clients\/[0-9a-f-]+$/);

    // Direct creation, no opportunity selected — must auto-create one.
    await page.goto("/proposals/new");
    await page.getByLabel("Client").selectOption({ label: clientName });
    await page.waitForURL(/clientId=/);
    await page.getByLabel("Proposal title").fill(proposalTitle);
    await page.getByLabel("Service type").selectOption("interior_painting");
    await page.getByRole("button", { name: "Save and continue" }).click();
    await page.waitForURL(/\/proposals\/[0-9a-f-]+\/edit\?step=scope/);
    const proposalUrl = page.url().replace(/\/edit\?step=scope$/, "");

    // Step 2: Scope
    await page.getByLabel("Custom section title").fill("Surface preparation");
    await page.getByRole("button", { name: "+ Add section" }).click();
    await expect(page.getByText("Surface preparation", { exact: true })).toBeVisible();

    await page.getByRole("link", { name: "Continue to Labor" }).click();
    await page.waitForURL(/step=labor/);

    // Step 3: Labor — the brief's worked example (2 workers, 5 days, 8h/day, $30/hr -> $2,400)
    await page.getByLabel("Label").fill("Lead painter");
    await page.getByLabel("Workers").fill("2");
    await page.getByLabel("Days").fill("5");
    await page.getByLabel("Hours/day").fill("8");
    await page.getByLabel("Rate per hour ($)").fill("30");
    await page.getByRole("button", { name: "+ Add labor item" }).click();
    await expect(page.getByRole("cell", { name: "Lead painter" })).toBeVisible();
    await expect(page.getByText("Saved labor total:").locator("..")).toContainText("2,400.00");

    await page.getByRole("link", { name: "Continue to Materials & Costs" }).click();
    await page.waitForURL(/step=materials/);

    // Step 4: Materials. Scoped to "Add a custom cost" specifically — the
    // material catalog's per-row Add forms above it also have a
    // "Quantity — <material name>" field whose accessible name contains
    // "Quantity" as a substring (Playwright's getByLabel default match).
    const customCostSection1 = page.locator(".section-card").filter({ has: page.getByRole("heading", { name: "Add a custom cost" }) });
    await customCostSection1.getByLabel("Description").fill("Exterior paint (5 gal)");
    await customCostSection1.getByLabel("Quantity").fill("5");
    await customCostSection1.getByLabel("Unit price ($)").fill("40");
    await customCostSection1.getByRole("button", { name: "+ Add cost item" }).click();
    await expect(page.getByRole("cell", { name: "Exterior paint (5 gal)" })).toBeVisible();

    await page.getByRole("link", { name: "Continue to Photos" }).click();
    await page.waitForURL(/step=photos/);
    await expect(page.getByRole("heading", { name: "Current job photos" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Previous work" })).toBeVisible();

    await page.getByRole("link", { name: "Continue to Terms & Pricing" }).click();
    await page.waitForURL(/step=pricing/);

    // Step 6: Terms, discount, tax
    await page.getByLabel("Terms").fill("50% deposit required upfront.");
    await page.getByLabel("Exclusions").fill("Permits not included.");
    await page.getByLabel("Discount type").selectOption("percentage");
    await page.getByLabel("Discount value").fill("10");
    await page.getByLabel("Tax rate (%)").fill("7");
    await page.getByRole("button", { name: "Save and continue" }).click();
    await page.waitForURL(/step=review/);

    // Step 7: Review — server-computed total must be present and correct.
    // subtotal 2600, 10% discount = 260 -> discounted 2340 (all taxable),
    // 7% tax on 2340 = 163.80, total = 2600 - 260 + 163.80 = 2503.80.
    await expect(page.getByText("$2,503.80").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Send" })).toBeDisabled();

    await page.getByRole("button", { name: "Mark ready" }).click();
    // waitForURL defaults to waitUntil:"load", which never fires for this
    // Server-Action-driven cross-route redirect (same class of issue as
    // docs/26's tenant-switching fix) — assert on content first, then
    // confirm the URL followed.
    await expect(page.locator(".badge").filter({ hasText: "ready" })).toBeVisible({ timeout: 30_000 });
    await expect(page).toHaveURL(new RegExp(`${proposalUrl.split("/").pop()}$`));

    // Dashboard reflects real state
    await page.goto("/");
    await expect(page.getByRole("link", { name: proposalTitle })).toBeVisible();
    await expect(page.getByText("Ready proposals")).toBeVisible();

    // Return to draft — returnProposalToDraftAction redirects straight into
    // the builder's Review step (jump back into editing), not back to the
    // detail page. A plain <form action={serverAction}> is still
    // progressively enhanced by Next.js — the redirect happens via a
    // client-side transition, not a hard navigation, so waiting on a
    // lifecycle event can resolve before the server round trip finishes
    // (same race documented in docs/26-phase-1.6-ui-redesign.md for tenant
    // switching). Assert on the real resulting content instead.
    await page.goto(proposalUrl);
    await page.getByRole("button", { name: "Return to draft" }).click();
    await expect(page.getByText(/Proposal #\d+ — draft/)).toBeVisible({ timeout: 30_000 });

    await page.goto(`${proposalUrl}/edit?step=labor`);
    await expect(page.getByRole("cell", { name: "Lead painter" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "$30.00/hr" })).toBeVisible();

    // Delete (archive) and restore, via the "Danger zone" secondary
    // section — never the primary action row. Delete requires an explicit
    // native confirm() dialog with the brief's exact copy; Playwright
    // dismisses dialogs by default, so a listener must accept it. Both
    // archiveProposalAction/restoreProposalAction redirect back to the SAME
    // URL the button was clicked from (/proposals/[id] -> /proposals/[id])
    // — unlike Mark Ready/Return to Draft, which redirect between two
    // different routes, a same-URL Server Action redirect gives the
    // client-side router nothing to distinguish "already there" from "just
    // navigated," so relying on a soft-navigation repaint is unreliable
    // (the same root cause as the original tenant-switching bug in
    // docs/26). Poll with an explicit hard reload each iteration instead of
    // trusting the client transition.
    await page.goto(proposalUrl);
    await page.getByText("Danger zone").click();
    page.once("dialog", (dialog) => {
      expect(dialog.message()).toBe(
        "Delete this proposal? This will remove it from your active proposals. You can restore it later from archived proposals."
      );
      dialog.accept();
    });
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

    // Deleted proposals disappear from the Active list...
    await page.goto("/proposals");
    await expect(page.getByText(proposalTitle)).toHaveCount(0);
    // ...and appear in Archived.
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

    // Restored, back in Active, with its total intact.
    await page.goto("/proposals");
    await expect(page.getByText(proposalTitle)).toBeVisible();
    await page.goto(proposalUrl);
    await expect(page.getByText("$2,400.00").first()).toBeVisible();
  });

  test("Portfolio: create a project, upload a photo, and select it as previous work in a proposal", async ({ page }) => {
    const suffix = uniqueSuffix();

    await page.goto("/portfolio/new");
    await page.getByLabel("Title").fill(`E2E Portfolio ${suffix}`);
    await page.getByLabel("Service type").selectOption("bathroom_remodeling");
    await page.getByLabel("General location (optional)").fill("Miami, FL");
    await page.getByRole("button", { name: "Create portfolio item" }).click();
    await page.waitForURL(/\/portfolio\/[0-9a-f-]+$/);

    const filePath = require.resolve("./fixtures/one-pixel.png");

    // The upload button must be visually distinct (green, "positive
    // action" styling) — see docs/41-photo-gallery-ui-fix.md.
    const uploadButton = page.getByRole("button", { name: "Upload portfolio photo" });
    await expect(uploadButton).toHaveClass(/button-success/);

    await page.getByLabel("Upload a photo").setInputFiles(filePath);
    await uploadButton.click();
    await expect(page.locator(".photo-thumb")).toBeVisible({ timeout: 15_000 });

    // Upload two more photos — all three must render as small, grid-laid-out
    // thumbnails, never a single image filling the page.
    for (let i = 0; i < 2; i++) {
      await page.getByLabel("Upload a photo").setInputFiles(filePath);
      await page.getByRole("button", { name: "Upload portfolio photo" }).click();
      await expect(page.locator(".photo-thumb")).toHaveCount(2 + i, { timeout: 15_000 });
    }
    await expect(page.locator(".photo-grid .photo-card")).toHaveCount(3);
    const firstThumbBox = await page.locator(".photo-thumb").first().boundingBox();
    const viewport = page.viewportSize();
    expect(firstThumbBox).not.toBeNull();
    // A thumbnail must be visibly small, not a giant image filling the
    // builder/portfolio page — assert it's well under half the viewport
    // width and has the capped thumbnail height, not an unconstrained one.
    if (firstThumbBox && viewport) {
      expect(firstThumbBox.width).toBeLessThan(viewport.width / 2);
      expect(firstThumbBox.height).toBeLessThanOrEqual(160);
    }

    // Now select it from a fresh proposal's Photos step.
    const clientName = `E2E Portfolio Client ${suffix}`;
    await page.goto("/clients/new");
    await page.getByLabel("Display name").fill(clientName);
    await page.getByRole("button", { name: "Create client" }).click();
    await page.waitForURL(/\/clients\/[0-9a-f-]+$/);

    await page.goto("/proposals/new");
    await page.getByLabel("Client").selectOption({ label: clientName });
    await page.waitForURL(/clientId=/);
    await page.getByLabel("Proposal title").fill(`E2E Portfolio Reuse ${suffix}`);
    await page.getByLabel("Service type").selectOption("bathroom_remodeling");
    await page.getByRole("button", { name: "Save and continue" }).click();
    await page.waitForURL(/step=scope/);

    await page.goto(page.url().replace("step=scope", "step=photos"));
    await page.getByText("Select from Portfolio").click();
    await page.getByRole("button", { name: "+ Add" }).first().click();
    await expect(page.getByText("Added")).toBeVisible({ timeout: 10_000 });
  });
});

test.describe("Job summary (update_proposal_scope)", () => {
  test.use({ storageState: authFile("owner-a") });

  test("saving with only Short summary and Estimated start date filled succeeds and advances to Labor", async ({ page }) => {
    const suffix = uniqueSuffix();
    const clientName = `E2E Scope Partial Client ${suffix}`;

    await page.goto("/clients/new");
    await page.getByLabel("Display name").fill(clientName);
    await page.getByRole("button", { name: "Create client" }).click();
    await page.waitForURL(/\/clients\/[0-9a-f-]+$/);

    await page.goto("/proposals/new");
    await page.getByLabel("Client").selectOption({ label: clientName });
    await page.waitForURL(/clientId=/);
    await page.getByLabel("Proposal title").fill(`E2E Scope Partial ${suffix}`);
    await page.getByLabel("Service type").selectOption("custom");
    await page.getByRole("button", { name: "Save and continue" }).click();
    await page.waitForURL(/\/proposals\/[0-9a-f-]+\/edit\?step=scope/);

    // The exact reported bug: only Short summary + Estimated start date are
    // filled; Scope introduction and Estimated duration are left empty.
    // Previously this failed with "Could not find the function
    // public.update_proposal_scope(...) in the schema cache" because the
    // client omitted the two empty fields instead of sending them as null,
    // and PostgREST could not resolve a matching overload. See
    // docs/37-proposal-scope-rpc-fix.md.
    await page.getByLabel("Short summary").fill("Painting house");
    await page.getByLabel("Estimated start date").fill("2026-01-20");
    await page.getByRole("button", { name: "Save and continue" }).click();

    // Must actually advance to the next step — not error, not stay put.
    await page.waitForURL(/step=labor/);
    await expect(page.getByText(/could not find the function/i)).toHaveCount(0);
    await expect(page.getByText(/schema cache/i)).toHaveCount(0);

    // Confirm the values actually persisted (not silently dropped), and
    // that the two untouched fields saved as genuinely empty, not "0".
    await page.goto(page.url().replace(/step=labor/, "step=scope"));
    await expect(page.getByLabel("Short summary")).toHaveValue("Painting house");
    await expect(page.getByLabel("Estimated start date")).toHaveValue("2026-01-20");
    await expect(page.getByLabel("Scope introduction")).toHaveValue("");
    await expect(page.getByLabel("Estimated duration (days)")).toHaveValue("");
  });

  test("saving with every Job summary field empty succeeds (all fields are optional)", async ({ page }) => {
    const suffix = uniqueSuffix();
    const clientName = `E2E Scope Empty Client ${suffix}`;

    await page.goto("/clients/new");
    await page.getByLabel("Display name").fill(clientName);
    await page.getByRole("button", { name: "Create client" }).click();
    await page.waitForURL(/\/clients\/[0-9a-f-]+$/);

    await page.goto("/proposals/new");
    await page.getByLabel("Client").selectOption({ label: clientName });
    await page.waitForURL(/clientId=/);
    await page.getByLabel("Proposal title").fill(`E2E Scope Empty ${suffix}`);
    await page.getByLabel("Service type").selectOption("custom");
    await page.getByRole("button", { name: "Save and continue" }).click();
    await page.waitForURL(/\/proposals\/[0-9a-f-]+\/edit\?step=scope/);

    // Every optional field left blank — no error of any kind.
    await page.getByRole("button", { name: "Save and continue" }).click();
    await page.waitForURL(/step=labor/);
    await expect(page.getByText(/could not find the function/i)).toHaveCount(0);
  });
});

test.describe("Labor pricing method", () => {
  test.use({ storageState: authFile("owner-a") });

  test("fixed-price labor combines correctly with materials in the Pricing Summary, and both persist on reload", async ({ page }) => {
    const suffix = uniqueSuffix();
    const clientName = `E2E Fixed Labor Client ${suffix}`;

    await page.goto("/clients/new");
    await page.getByLabel("Display name").fill(clientName);
    await page.getByRole("button", { name: "Create client" }).click();
    await page.waitForURL(/\/clients\/[0-9a-f-]+$/);

    await page.goto("/proposals/new");
    await page.getByLabel("Client").selectOption({ label: clientName });
    await page.waitForURL(/clientId=/);
    await page.getByLabel("Proposal title").fill(`E2E Fixed Labor ${suffix}`);
    await page.getByLabel("Service type").selectOption("bathroom_remodeling");
    await page.getByRole("button", { name: "Save and continue" }).click();
    await page.waitForURL(/\/proposals\/[0-9a-f-]+\/edit\?step=scope/);

    // Jump straight to Labor via the stepper (not the sequential "Continue"
    // link) — the reported bug's steps weren't specific about navigation,
    // so this exercises the same interaction pattern used to diagnose it.
    await page.getByRole("link", { name: /3.*Labor/i }).click();
    await page.waitForURL(/step=labor/);

    // Switch to Fixed price mode — the hourly fields must disappear.
    await page.getByRole("button", { name: "Fixed price" }).click();
    await expect(page.getByLabel("Workers")).toHaveCount(0);
    await page.getByLabel("Label").fill("Bathroom remodeling labor");
    await page.getByLabel("Fixed labor price ($)").fill("700.00");
    await page.getByRole("button", { name: "+ Add labor item" }).click();
    await expect(page.getByRole("cell", { name: "Bathroom remodeling labor" })).toBeVisible();
    await expect(page.getByText(/Saved labor total:/)).toContainText("$700.00");

    await page.getByRole("link", { name: /4.*Materials/i }).click();
    await page.waitForURL(/step=materials/);
    // Scoped to "Add a custom cost" — see the comment at the equivalent
    // call in "Proposals — full builder flow" above.
    const customCostSection2 = page.locator(".section-card").filter({ has: page.getByRole("heading", { name: "Add a custom cost" }) });
    await customCostSection2.getByLabel("Description").fill("Paint");
    await customCostSection2.getByLabel("Quantity").fill("2");
    await customCostSection2.getByLabel("Unit price ($)").fill("40.00");
    await customCostSection2.getByRole("button", { name: "+ Add cost item" }).click();
    // Scoped to "Saved costs" — the material catalog's own results table
    // above it also has several rows whose name contains "Paint".
    const savedCosts2 = page.locator(".section-card").filter({ has: page.getByRole("heading", { name: "Saved costs" }) });
    await expect(savedCosts2.getByRole("cell", { name: "Paint" })).toBeVisible();

    await page.getByRole("link", { name: /6.*Terms.*Pricing/i }).click();
    await page.waitForURL(/step=pricing/);
    await page.waitForLoadState("networkidle");

    const laborRow = page.locator(".pricing-summary-row").filter({ hasText: "Labor" });
    const materialsRow = page.locator(".pricing-summary-row").filter({ hasText: "Materials" });
    const totalRow = page.locator(".pricing-summary-row").filter({ hasText: "Total" });
    // The exact manual-verification case from the brief.
    await expect(laborRow).toContainText("$700.00");
    await expect(materialsRow).toContainText("$80.00");
    await expect(totalRow).toContainText("$780.00");

    // Persistence: a hard reload must show the same, server-persisted
    // values — never a stale $0.00.
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(laborRow).toContainText("$700.00");
    await expect(totalRow).toContainText("$780.00");
  });

  test("hourly labor: the brief's worked example (1 worker, 1 day, 8h, $35/hr -> $280) shows correctly in the Pricing Summary", async ({ page }) => {
    const suffix = uniqueSuffix();
    const clientName = `E2E Hourly Labor Client ${suffix}`;

    await page.goto("/clients/new");
    await page.getByLabel("Display name").fill(clientName);
    await page.getByRole("button", { name: "Create client" }).click();
    await page.waitForURL(/\/clients\/[0-9a-f-]+$/);

    await page.goto("/proposals/new");
    await page.getByLabel("Client").selectOption({ label: clientName });
    await page.waitForURL(/clientId=/);
    await page.getByLabel("Proposal title").fill(`E2E Hourly Labor ${suffix}`);
    await page.getByLabel("Service type").selectOption("custom");
    await page.getByRole("button", { name: "Save and continue" }).click();
    await page.waitForURL(/\/proposals\/[0-9a-f-]+\/edit\?step=scope/);

    await page.getByRole("link", { name: /3.*Labor/i }).click();
    await page.waitForURL(/step=labor/);
    // Hourly is the default mode — no extra click needed.
    await page.getByLabel("Label").fill("Solo painter");
    await page.getByLabel("Workers").fill("1");
    await page.getByLabel("Days").fill("1");
    await page.getByLabel("Hours/day").fill("8");
    await page.getByLabel("Rate per hour ($)").fill("35.00");
    await page.getByRole("button", { name: "+ Add labor item" }).click();
    await expect(page.getByRole("cell", { name: "Solo painter" })).toBeVisible();
    await expect(page.getByText(/Saved labor total:/)).toContainText("$280.00");

    await page.getByRole("link", { name: /6.*Terms.*Pricing/i }).click();
    await page.waitForURL(/step=pricing/);
    await page.waitForLoadState("networkidle");
    await expect(page.locator(".pricing-summary-row").filter({ hasText: "Labor" })).toContainText("$280.00");
    await expect(page.locator(".pricing-summary-row").filter({ hasText: "Total" })).toContainText("$280.00");
  });

  test("the exact reported scenario: hourly $280 preview then saved, material $50 preview then saved, summary shows Labor $280 + Materials $50 = Total $330, and survives a reload", async ({
    page,
  }) => {
    const suffix = uniqueSuffix();
    const clientName = `E2E Preview Vs Saved Client ${suffix}`;

    await page.goto("/clients/new");
    await page.getByLabel("Display name").fill(clientName);
    await page.getByRole("button", { name: "Create client" }).click();
    await page.waitForURL(/\/clients\/[0-9a-f-]+$/);

    await page.goto("/proposals/new");
    await page.getByLabel("Client").selectOption({ label: clientName });
    await page.waitForURL(/clientId=/);
    await page.getByLabel("Proposal title").fill(`E2E Preview Vs Saved ${suffix}`);
    await page.getByLabel("Service type").selectOption("custom");
    await page.getByRole("button", { name: "Save and continue" }).click();
    await page.waitForURL(/\/proposals\/[0-9a-f-]+\/edit\?step=scope/);

    await page.getByRole("link", { name: /3.*Labor/i }).click();
    await page.waitForURL(/step=labor/);
    await page.getByLabel("Label").fill("Painting labor");
    await page.getByLabel("Workers").fill("1");
    await page.getByLabel("Days").fill("1");
    await page.getByLabel("Hours/day").fill("8");
    await page.getByLabel("Rate per hour ($)").fill("35.00");

    // Before saving: the preview must show $280.00, clearly marked as
    // NOT saved, and the already-persisted total (correctly $0.00, since
    // nothing has been saved yet) must remain visible and distinct — this
    // is the exact distinction the reported "$0.00" issue turned out to
    // hinge on (see docs/40-proposal-total-refresh-fix.md).
    await expect(page.getByText("Not saved yet.")).toBeVisible();
    await expect(page.locator(".unsaved-preview-tile")).toContainText("$280.00");
    await expect(page.getByText(/Saved labor total:/)).toContainText("$0.00");

    await page.getByRole("button", { name: "+ Add labor item" }).click();
    await expect(page.getByRole("cell", { name: "Painting labor" })).toBeVisible();
    await expect(page.getByText(/Saved labor total:/)).toContainText("$280.00");

    await page.getByRole("link", { name: /4.*Materials/i }).click();
    await page.waitForURL(/step=materials/);
    // Scoped to "Add a custom cost" — see the comment at the equivalent
    // call in "Proposals — full builder flow" above.
    const customCostSection3 = page.locator(".section-card").filter({ has: page.getByRole("heading", { name: "Add a custom cost" }) });
    await customCostSection3.getByLabel("Description").fill("Paint");
    await customCostSection3.getByLabel("Quantity").fill("1");
    await customCostSection3.getByLabel("Unit price ($)").fill("50.00");
    await expect(page.getByText("Not saved yet.")).toBeVisible();
    await expect(page.locator(".unsaved-preview-tile")).toContainText("$50.00");

    await customCostSection3.getByRole("button", { name: "+ Add cost item" }).click();
    // Scoped to "Saved costs" — the material catalog's own results table
    // above it also has several rows whose name contains "Paint".
    const savedCosts3 = page.locator(".section-card").filter({ has: page.getByRole("heading", { name: "Saved costs" }) });
    await expect(savedCosts3.getByRole("cell", { name: "Paint" })).toBeVisible();
    await expect(page.getByText(/Saved materials & costs subtotal:/)).toContainText("$50.00");

    await page.getByRole("link", { name: /6.*Terms.*Pricing/i }).click();
    await page.waitForURL(/step=pricing/);
    await page.waitForLoadState("networkidle");
    const laborRow = page.locator(".pricing-summary-row").filter({ hasText: "Labor" });
    const materialsRow = page.locator(".pricing-summary-row").filter({ hasText: "Materials" });
    const totalRow = page.locator(".pricing-summary-row").filter({ hasText: "Total" });
    await expect(laborRow).toContainText("$280.00");
    await expect(materialsRow).toContainText("$50.00");
    await expect(totalRow).toContainText("$330.00");

    // Reload must show the same, server-persisted values.
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(laborRow).toContainText("$280.00");
    await expect(materialsRow).toContainText("$50.00");
    await expect(totalRow).toContainText("$330.00");
  });
});

test.describe("Proposals — Viewer permissions", () => {
  test.use({ storageState: authFile("viewer-a") });

  test("Viewer sees proposals but has no create/mark-ready/archive controls", async ({ page, browser }) => {
    const ownerContext = await browser.newContext({ storageState: authFile("owner-a") });
    const ownerPage = await ownerContext.newPage();
    const suffix = uniqueSuffix();
    const clientName = `E2E Viewer Client ${suffix}`;
    await ownerPage.goto("/clients/new");
    await ownerPage.getByLabel("Display name").fill(clientName);
    await ownerPage.getByRole("button", { name: "Create client" }).click();
    await ownerPage.waitForURL(/\/clients\/[0-9a-f-]+$/);

    await ownerPage.goto("/proposals/new");
    await ownerPage.getByLabel("Client").selectOption({ label: clientName });
    await ownerPage.waitForURL(/clientId=/);
    await ownerPage.getByLabel("Proposal title").fill(`E2E Viewer Proposal ${suffix}`);
    await ownerPage.getByLabel("Service type").selectOption("custom");
    await ownerPage.getByRole("button", { name: "Save and continue" }).click();
    await ownerPage.waitForURL(/step=scope/);
    await ownerContext.close();

    await page.goto("/proposals");
    await expect(page.getByRole("link", { name: "New proposal" })).toHaveCount(0);
    await expect(page.getByText(`E2E Viewer Proposal ${suffix}`)).toBeVisible();
  });
});

test.describe("Proposals — Sales permissions", () => {
  test.use({ storageState: authFile("sales-a") });

  test("Sales can create and edit scope, but cannot manage pricing", async ({ page }) => {
    const suffix = uniqueSuffix();
    const clientName = `E2E Sales Proposal Client ${suffix}`;

    await page.goto("/clients/new");
    await page.getByLabel("Display name").fill(clientName);
    await page.getByRole("button", { name: "Create client" }).click();
    await page.waitForURL(/\/clients\/[0-9a-f-]+$/);

    await page.goto("/proposals/new");
    await page.getByLabel("Client").selectOption({ label: clientName });
    await page.waitForURL(/clientId=/);
    await page.getByLabel("Proposal title").fill(`E2E Sales Proposal ${suffix}`);
    await page.getByLabel("Service type").selectOption("custom");
    await page.getByRole("button", { name: "Save and continue" }).click();
    await page.waitForURL(/step=scope/);

    await page.getByRole("link", { name: "Continue to Labor" }).click();
    await page.waitForURL(/step=labor/);
    // No permission to manage pricing -> no add-labor form rendered at all.
    await expect(page.getByLabel("Label")).toHaveCount(0);
  });
});

test.describe("Proposals — tenant isolation", () => {
  test.use({ storageState: authFile("owner-a") });

  test("switching tenant hides the previous tenant's proposals, and a stale URL 404s", async ({ page }) => {
    const suffix = uniqueSuffix();
    const clientName = `E2E Isolation Client ${suffix}`;

    await page.goto("/clients/new");
    await page.getByLabel("Display name").fill(clientName);
    await page.getByRole("button", { name: "Create client" }).click();
    await page.waitForURL(/\/clients\/[0-9a-f-]+$/);

    await page.goto("/proposals/new");
    await page.getByLabel("Client").selectOption({ label: clientName });
    await page.waitForURL(/clientId=/);
    const proposalTitle = `E2E Isolation Proposal ${suffix}`;
    await page.getByLabel("Proposal title").fill(proposalTitle);
    await page.getByLabel("Service type").selectOption("custom");
    await page.getByRole("button", { name: "Save and continue" }).click();
    await page.waitForURL(/step=scope/);
    const proposalUrl = page.url().replace(/\/edit\?step=scope$/, "");

    await page.goto("/");
    const switcher = page.getByLabel("Switch business");
    const options = await switcher.locator("option").evaluateAll((els) =>
      els.map((el) => ({ value: (el as HTMLOptionElement).value, text: el.textContent }))
    );
    const tenantB = options.find((o) => o.text?.includes("E2E Tenant B"));
    expect(tenantB).toBeTruthy();
    await switcher.selectOption({ value: tenantB!.value });
    await expect
      .poll(
        async () => (await page.context().cookies()).find((c) => c.name === "scopevia_active_tenant")?.value,
        { timeout: 15_000 }
      )
      .toBe(tenantB!.value);

    await page.goto("/proposals");
    await expect(page.getByText(proposalTitle)).toHaveCount(0);

    await page.goto(proposalUrl);
    await expect(page.getByRole("heading", { name: "404" })).toBeVisible();
  });
});
