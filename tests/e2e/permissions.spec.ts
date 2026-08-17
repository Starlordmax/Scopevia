import { test, expect } from "@playwright/test";
import { authFile, uniqueSuffix } from "./fixtures/session";

test.describe("Viewer permissions", () => {
  test.use({ storageState: authFile("viewer-a") });

  test("can view clients/opportunities/proposals but sees no mutation controls", async ({ page }) => {
    await page.goto("/clients");
    await expect(page.getByRole("heading", { name: "Clients" })).toBeVisible();
    await expect(page.getByRole("link", { name: "+ New client" })).toHaveCount(0);

    await page.goto("/opportunities");
    await expect(page.getByRole("heading", { name: "Opportunities" })).toBeVisible();
    await expect(page.getByRole("link", { name: "+ New" })).toHaveCount(0);

    await page.goto("/proposals");
    await expect(page.getByRole("heading", { name: "Proposals", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "+ New proposal" })).toHaveCount(0);
  });

  test("direct URL access to creation routes redirects away instead of rendering the form", async ({ page }) => {
    await page.goto("/clients/new");
    await page.waitForURL(/\/clients$/);
    await expect(page.getByLabel("Display name")).toHaveCount(0);

    await page.goto("/opportunities/new");
    await page.waitForURL(/\/opportunities$/);

    // /projects/new is a legacy route that now redirects unconditionally
    // for every user, permission or not — Projects is no longer a UI
    // module at all (docs/38-navigation-simplification.md). See
    // projects.spec.ts for dedicated redirect coverage.
    await page.goto("/projects/new");
    await page.waitForURL(/\/proposals$/);
  });

  test("Members admin is denied without leaking member data", async ({ page }) => {
    await page.goto("/members");
    await expect(page.getByText(/does not include access to this page/)).toBeVisible();
    await expect(page.locator("table")).toHaveCount(0);
  });
});

test.describe("Sales permissions", () => {
  test.use({ storageState: authFile("sales-a") });

  test("can create a client and an opportunity, and change its status", async ({ page }) => {
    const suffix = uniqueSuffix();
    const clientName = `E2E Sales Client ${suffix}`;

    await page.goto("/clients/new");
    await page.getByLabel("Display name").fill(clientName);
    await page.getByRole("button", { name: "Create client" }).click();
    await page.waitForURL(/\/clients\/[0-9a-f-]+$/);

    await page.goto("/opportunities/new");
    await page.getByLabel("Client").selectOption({ label: clientName });
    await page.getByLabel("Title").fill(`E2E Sales Opp ${suffix}`);
    await page.getByRole("button", { name: "Create opportunity" }).click();
    await page.waitForURL(/\/opportunities\/[0-9a-f-]+$/);

    await page.getByRole("button", { name: "Move to contacted" }).click();
    await page.getByRole("button", { name: "Confirm: move to contacted" }).click();
    await page.waitForLoadState("networkidle");
    await expect(page.locator(".badge").filter({ hasText: "contacted" })).toBeVisible();
  });

  // The old "Sales can create a project but has no update controls" UI test
  // is gone along with the Projects module it exercised (Projects has no
  // reachable UI for any user now — see projects.spec.ts). The equivalent
  // permission differentiation for the new primary workflow is covered by
  // tests/e2e/proposals.spec.ts ("Proposals — Sales permissions"), and the
  // backend check independent of any UI is
  // tests/rls/phase1-crm.test.ts "Sales can create a project but cannot
  // update it (no projects.update)".

  test("cannot access Members admin", async ({ page }) => {
    await page.goto("/members");
    await expect(page.getByText(/does not include access to this page/)).toBeVisible();
  });
});

test.describe("Field Worker permissions", () => {
  // The old version of this test used a Project (created by, never
  // assigned to, Field Worker) to demonstrate tenant-wide — not
  // assignment-scoped — visibility, per docs/20. Projects has no reachable
  // UI at all now (see projects.spec.ts), so this is adapted to the same
  // underlying claim using Proposals, which Field Worker can view
  // tenant-wide under the new primary workflow (field_worker has
  // proposals.view — see supabase/migrations/20260706141600). The
  // "add a note" assertion from the old test is dropped, not silently
  // preserved: Field Worker's only Phase-1 UI surface for notes.create was
  // the Project detail page, which no longer exists in the UI for anyone.
  // This is a real, documented regression in docs/38-navigation-simplification.md
  // ("Known limitations"), not something faked here to keep the test green.
  test("sees proposals tenant-wide (not assignment-scoped) but not clients/opportunities", async ({ browser }) => {
    const suffix = uniqueSuffix();
    const clientName = `E2E FW Client ${suffix}`;
    const proposalTitle = `E2E FW Proposal ${suffix}`;

    const ownerContext = await browser.newContext({ storageState: authFile("owner-a") });
    const ownerPage = await ownerContext.newPage();
    await ownerPage.goto("/clients/new");
    await ownerPage.getByLabel("Display name").fill(clientName);
    await ownerPage.getByRole("button", { name: "Create client" }).click();
    await ownerPage.waitForURL(/\/clients\/[0-9a-f-]+$/);

    await ownerPage.goto("/proposals/new");
    await ownerPage.getByLabel("Client").selectOption({ label: clientName });
    await ownerPage.waitForURL(/clientId=/);
    await ownerPage.getByLabel("Proposal title").fill(proposalTitle);
    await ownerPage.getByLabel("Service type").selectOption("custom");
    await ownerPage.getByLabel("Custom service name").fill("Custom test service");
    await ownerPage.getByRole("button", { name: "Save and continue" }).click();
    await ownerPage.waitForURL(/\/proposals\/[0-9a-f-]+\/edit\?step=measurements/);
    const proposalUrl = ownerPage.url().replace(/\/edit\?step=measurements$/, "");
    await ownerContext.close();

    const fwContext = await browser.newContext({ storageState: authFile("field-worker-a") });
    const fwPage = await fwContext.newPage();

    // Tenant-wide visibility: Field Worker sees this proposal even though
    // it was created by (and never assigned to) someone else.
    await fwPage.goto("/proposals");
    await expect(fwPage.getByRole("link", { name: proposalTitle })).toBeVisible();

    await fwPage.goto("/clients");
    await expect(fwPage.getByText(/does not include access to this page/)).toBeVisible();

    await fwPage.goto("/opportunities");
    await expect(fwPage.getByText(/does not include access to this page/)).toBeVisible();

    await fwPage.goto(proposalUrl);
    await expect(fwPage.getByText(proposalTitle)).toBeVisible();
    // No pricing/mark-ready/archive controls — Field Worker lacks
    // proposals.manage_pricing and the mark-ready/archive permissions.
    await expect(fwPage.getByRole("button", { name: "Mark ready" })).toHaveCount(0);
    await expect(fwPage.getByRole("button", { name: "Archive" })).toHaveCount(0);

    await fwContext.close();
  });
});

test.describe("Tenant switching", () => {
  test.use({ storageState: authFile("owner-a") });

  test("switching tenant changes visible data and hides the previous tenant's records", async ({ page }) => {
    const suffix = uniqueSuffix();
    const clientNameInA = `E2E TenantSwitch A ${suffix}`;

    await page.goto("/");
    // Owner A's default active tenant (no cookie yet) is Tenant A — its name
    // sorts first (see tests/e2e/global-setup.ts).
    await page.goto("/clients/new");
    await page.getByLabel("Display name").fill(clientNameInA);
    await page.getByRole("button", { name: "Create client" }).click();
    await page.waitForURL(/\/clients\/[0-9a-f-]+$/);
    const clientAUrl = page.url();

    // Search rather than just visiting /clients: this suite shares ONE
    // Tenant A across every spec file, which by full-suite run time holds
    // far more than one page's worth of clients (DEFAULT_PAGE_SIZE = 20,
    // sorted alphabetically, not by creation time) — the just-created
    // client is easily pushed past page 1. Searching filters server-side
    // and is unaffected by how many other clients exist.
    await page.goto("/clients");
    await page.getByPlaceholder("Search by name, email, phone…").fill(clientNameInA);
    await page.getByRole("button", { name: "Search" }).click();
    await expect(page.getByRole("link", { name: clientNameInA })).toBeVisible();

    // Switch to Tenant B (Owner A is a viewer there).
    await page.goto("/");
    const switcher = page.getByLabel("Switch business");
    await expect(switcher).toBeVisible();
    const options = await switcher.locator("option").evaluateAll((els) =>
      els.map((el) => ({ value: (el as HTMLOptionElement).value, text: el.textContent }))
    );
    const tenantB = options.find((o) => o.text?.includes("E2E Tenant B"));
    expect(tenantB).toBeTruthy();
    await switcher.selectOption({ value: tenantB!.value });
    // selectOption() writes the <select>'s DOM value synchronously and fires
    // "change" — it does NOT wait for the onChange handler's
    // form.requestSubmit() to finish the switchTenantAction round trip.
    // That round trip is a Server Action submit, which React/Next.js handle
    // via fetch and a client-side router update, never a hard navigation —
    // so waitForLoadState("load") never sees a new "load" event, and
    // option:checked reflects the DOM write Playwright itself just made, not
    // anything server-confirmed. Both looked like valid sync signals and
    // both passed instantly while the action was still in flight, letting
    // the very next page.goto("/clients") race ahead of the cookie actually
    // being set — it would load with the OLD (or no) active-tenant cookie
    // and silently fall back to Tenant A. The cookie itself is the only
    // signal that's actually tied to the server having processed the
    // switch, so poll for it directly instead of trusting the DOM.
    await expect
      .poll(
        async () => (await page.context().cookies()).find((c) => c.name === "scopevia_active_tenant")?.value,
        { timeout: 15_000 }
      )
      .toBe(tenantB!.value);

    await page.goto("/clients");
    // Tenant A's client must not appear under Tenant B.
    await expect(page.getByRole("link", { name: clientNameInA })).toHaveCount(0);
    // Viewer role in Tenant B: no create control either.
    await expect(page.getByRole("link", { name: "+ New client" })).toHaveCount(0);

    // A stale URL to the Tenant A client must not expose it while active in
    // B — Next.js's notFound() renders its built-in 404, and critically the
    // client's name/details are never present in the response at all.
    await page.goto(clientAUrl);
    await expect(page.getByRole("heading", { name: "404" })).toBeVisible();
    await expect(page.getByText(clientNameInA)).toHaveCount(0);
  });

  test("a manipulated tenant id in the switcher is rejected, not silently accepted", async ({ page }) => {
    await page.goto("/");
    const switcher = page.getByLabel("Switch business");
    await expect(switcher).toBeVisible();

    const fakeTenantId = "00000000-0000-0000-0000-000000000000";
    await switcher.evaluate((el: HTMLSelectElement, value: string) => {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = "Injected fake tenant";
      el.appendChild(opt);
    }, fakeTenantId);
    await switcher.selectOption(fakeTenantId);

    await page.waitForURL(/\/select-tenant\?error=not_a_member/);
    await expect(page.getByText("That workspace is not available. Choose another.")).toBeVisible();
  });
});
