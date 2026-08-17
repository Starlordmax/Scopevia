import { test, expect } from "@playwright/test";
import { authFile, uniqueSuffix } from "./fixtures/session";

test.use({ storageState: authFile("owner-a") });

test.describe("Client Address + Material ZIP Defaults — New Client form", () => {
  test("Website is gone, Address fields are present, and a client's ZIP flows into Materials & Costs", async ({ page }) => {
    test.setTimeout(60_000);
    const suffix = uniqueSuffix();
    const name = `E2E ZIP Client ${suffix}`;

    await page.goto("/clients/new");
    await expect(page.getByRole("heading", { name: "New client" })).toBeVisible();
    await expect(page.getByLabel("Website")).toHaveCount(0);
    await expect(page.getByText("Address", { exact: true })).toBeVisible();
    await expect(page.getByPlaceholder("Start typing an address…")).toBeVisible();

    await page.getByLabel("Client type").selectOption("individual");
    await page.getByLabel("Display name").fill(name);
    await page.getByLabel("First name").fill("Jane");
    await page.getByLabel("Last name").fill("Doe");
    await page.getByLabel("Email").fill(`jane-zip-${suffix}@example.com`);
    await page.getByLabel("Phone", { exact: true }).fill("555-0100");
    await page.getByLabel("Street address").fill("123 Main St");
    await page.getByLabel("City").fill("Miami");
    await page.getByLabel("State").fill("FL");
    await page.getByLabel("ZIP code").fill("33101");
    await page.getByRole("button", { name: "Create client" }).click();
    await page.waitForURL(/\/clients\/[0-9a-f-]+$/);

    // Address shows on the client's own detail page.
    await expect(page.getByText("Address:")).toBeVisible();
    await expect(page.getByText("123 Main St")).toBeVisible();

    await page.goto("/proposals/new");
    await page.getByLabel("Client").selectOption({ label: name });
    await page.waitForURL(/clientId=/);
    await page.getByLabel("Proposal title").fill(`E2E ZIP Proposal ${suffix}`);
    await page.getByLabel("Service type").selectOption("custom");
    await page.getByLabel("Custom service name").fill("Custom test service");
    await page.getByRole("button", { name: "Save and continue" }).click();
    await page.waitForURL(/\/proposals\/[0-9a-f-]+\/edit\?step=measurements/);
    const proposalUrl = page.url().replace(/\/edit\?step=measurements$/, "");

    await page.goto(`${proposalUrl}/edit?step=materials`);
    await expect(page.locator("#zipCode")).toHaveValue("33101");
    await expect(page.getByText("Using ZIP code from the client address. You can change it for this proposal.")).toBeVisible();
    await expect(page.getByText(/Results for ZIP 33101/)).toBeVisible({ timeout: 15_000 });
  });

  test("a manual ZIP override in Materials & Costs is never overwritten", async ({ page }) => {
    test.setTimeout(60_000);
    const suffix = uniqueSuffix();
    const name = `E2E Override Client ${suffix}`;

    await page.goto("/clients/new");
    await page.getByLabel("Display name").fill(name);
    await page.getByLabel("ZIP code").fill("60601");
    await page.getByRole("button", { name: "Create client" }).click();
    await page.waitForURL(/\/clients\/[0-9a-f-]+$/);

    await page.goto("/proposals/new");
    await page.getByLabel("Client").selectOption({ label: name });
    await page.waitForURL(/clientId=/);
    await page.getByLabel("Proposal title").fill(`E2E Override Proposal ${suffix}`);
    await page.getByLabel("Service type").selectOption("custom");
    await page.getByLabel("Custom service name").fill("Custom test service");
    await page.getByRole("button", { name: "Save and continue" }).click();
    await page.waitForURL(/\/proposals\/[0-9a-f-]+\/edit\?step=measurements/);
    const proposalUrl = page.url().replace(/\/edit\?step=measurements$/, "");

    await page.goto(`${proposalUrl}/edit?step=materials`);
    await expect(page.locator("#zipCode")).toHaveValue("60601");

    await page.locator("#zipCode").fill("10001");
    await page.getByRole("button", { name: "Save ZIP" }).click();
    await page.waitForTimeout(1000);

    await page.reload();
    await expect(page.locator("#zipCode")).toHaveValue("10001");
  });

  test("a non-US postal code does not block client creation and is not forced into the proposal's pricing ZIP", async ({ page }) => {
    test.setTimeout(60_000);
    const suffix = uniqueSuffix();
    const name = `E2E Intl Client ${suffix}`;

    await page.goto("/clients/new");
    await page.getByLabel("Display name").fill(name);
    await page.getByLabel("Street address").fill("10 Downing St");
    await page.getByLabel("City").fill("London");
    await page.getByLabel("State").fill("England");
    await page.getByLabel("ZIP code").fill("SW1A 2AA");
    await page.getByLabel("Country").fill("GB");
    await page.getByRole("button", { name: "Create client" }).click();
    await page.waitForURL(/\/clients\/[0-9a-f-]+$/);
    await expect(page.getByRole("heading", { name: new RegExp(name) })).toBeVisible();

    await page.goto("/proposals/new");
    await page.getByLabel("Client").selectOption({ label: name });
    await page.waitForURL(/clientId=/);
    await page.getByLabel("Proposal title").fill(`E2E Intl Proposal ${suffix}`);
    await page.getByLabel("Service type").selectOption("custom");
    await page.getByLabel("Custom service name").fill("Custom test service");
    await page.getByRole("button", { name: "Save and continue" }).click();
    await page.waitForURL(/\/proposals\/[0-9a-f-]+\/edit\?step=measurements/);
    const proposalUrl = page.url().replace(/\/edit\?step=measurements$/, "");

    await page.goto(`${proposalUrl}/edit?step=materials`);
    await expect(page.locator("#zipCode")).toHaveValue("");
    await expect(page.getByText("Enter the job ZIP code to price materials for this area.")).toBeVisible();
  });
});

test.describe("Client Address + Material ZIP Defaults — Quick Create Client", () => {
  test("a client quick-created with an address gets its ZIP used automatically in Materials & Costs", async ({ page }) => {
    test.setTimeout(60_000);
    const suffix = uniqueSuffix();

    await page.goto("/proposals/new");
    await page.getByRole("button", { name: "+ New client" }).click();
    await expect(page.getByRole("heading", { name: "Create new client" })).toBeVisible();
    await expect(page.getByLabel("Website")).toHaveCount(0);

    await page.getByLabel("First name").fill("Quick");
    await page.getByLabel("Last name").fill("ZipTest");
    await page.getByLabel("Email").fill(`quick-zip-${suffix}@example.com`);
    await page.getByLabel("Phone").fill("555-333-4444");
    await page.getByLabel("Street address").fill("456 Ocean Dr");
    await page.getByLabel("City").fill("Miami Beach");
    await page.getByLabel("State").fill("FL");
    await page.getByLabel("ZIP code").fill("33139");
    await page.getByRole("button", { name: "Create client" }).click();
    await expect(page.getByText("Client created and selected.")).toBeVisible({ timeout: 15_000 });

    await page.getByLabel("Proposal title").fill(`E2E Quick ZIP Proposal ${suffix}`);
    await page.getByLabel("Service type").selectOption("custom");
    await page.getByLabel("Custom service name").fill("Custom test service");
    await page.getByRole("button", { name: "Save and continue" }).click();
    await page.waitForURL(/\/proposals\/[0-9a-f-]+\/edit\?step=measurements/);
    const proposalUrl = page.url().replace(/\/edit\?step=measurements$/, "");

    await page.goto(`${proposalUrl}/edit?step=materials`);
    await expect(page.locator("#zipCode")).toHaveValue("33139");
  });
});
