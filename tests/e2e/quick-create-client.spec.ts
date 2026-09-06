import { test, expect } from "@playwright/test";
import { authFile, uniqueSuffix } from "./fixtures/session";

test.use({ storageState: authFile("owner-a") });

test.describe("Quick Create Client — Proposal form", () => {
  test("create a client from the modal, it's auto-selected, and the proposal is created for that client", async ({ page }) => {
    const suffix = uniqueSuffix();
    const email = `quick-client-${suffix}@example.com`;

    await page.goto("/proposals/new");
    await expect(page.getByRole("button", { name: "+ New client" })).toBeVisible();

    await page.getByRole("button", { name: "+ New client" }).click();
    await expect(page.getByRole("heading", { name: "Create new client" })).toBeVisible();

    await page.getByLabel("Client type").selectOption("individual");
    await page.getByLabel("First name").fill("John");
    await page.getByLabel("Last name").fill("Smith");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Phone").fill("555-123-4567");
    await page.getByRole("button", { name: "Create client" }).click();

    // Modal closes, success message shows, new client is selected.
    await expect(page.getByRole("heading", { name: "Create new client" })).toHaveCount(0);
    await expect(page.getByText("Client created and selected.")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("#clientId")).toHaveValue(/.+/);

    const selectedLabel = await page.locator("#clientId option:checked").textContent();
    expect(selectedLabel).toBe("John Smith");

    // Finish creating the proposal with this client.
    await page.getByLabel("Proposal title").fill(`E2E Quick Client Proposal ${suffix}`);
    await page.getByLabel("Service type").selectOption("custom");
    await page.getByLabel("Custom service name").fill("Custom test service");
    await page.getByRole("button", { name: "Save and continue" }).click();
    await page.waitForURL(/\/proposals\/[0-9a-f-]+\/edit\?step=measurements/);

    const proposalUrl = page.url().replace(/\/edit\?step=measurements$/, "");
    await page.goto(proposalUrl);
    await expect(page.getByText("John Smith")).toBeVisible();
  });

  test("business client type: contact name is used as the temporary display name (documented limitation)", async ({ page }) => {
    const suffix = uniqueSuffix();
    await page.goto("/proposals/new");
    await page.getByRole("button", { name: "+ New client" }).click();
    await page.getByLabel("Client type").selectOption("business");
    await page.getByLabel("First name").fill("Acme");
    await page.getByLabel("Last name").fill("Contact");
    await page.getByLabel("Email").fill(`acme-${suffix}@example.com`);
    await page.getByLabel("Phone").fill("555-999-0000");
    await page.getByRole("button", { name: "Create client" }).click();

    await expect(page.getByText("Client created and selected.")).toBeVisible({ timeout: 15_000 });
    const selectedLabel = await page.locator("#clientId option:checked").textContent();
    expect(selectedLabel).toBe("Acme Contact");
  });

  test("typed proposal title and service type survive creating a client mid-form", async ({ page }) => {
    const suffix = uniqueSuffix();
    await page.goto("/proposals/new");
    await page.getByLabel("Proposal title").fill("Title Typed Before Client Creation");
    await page.getByLabel("Service type").selectOption("flooring");

    await page.getByRole("button", { name: "+ New client" }).click();
    await page.getByLabel("First name").fill("Preserve");
    await page.getByLabel("Last name").fill("Data");
    await page.getByLabel("Email").fill(`preserve-${suffix}@example.com`);
    await page.getByLabel("Phone").fill("555-000-1111");
    await page.getByRole("button", { name: "Create client" }).click();
    await expect(page.getByText("Client created and selected.")).toBeVisible({ timeout: 15_000 });

    await expect(page.getByLabel("Proposal title")).toHaveValue("Title Typed Before Client Creation");
    await expect(page.getByLabel("Service type")).toHaveValue("flooring");
  });

  test("Cancel closes the modal without creating a client or losing typed data", async ({ page }) => {
    await page.goto("/proposals/new");
    await page.getByLabel("Proposal title").fill("Should Not Be Lost");

    await page.getByRole("button", { name: "+ New client" }).click();
    await expect(page.getByRole("heading", { name: "Create new client" })).toBeVisible();
    await page.getByLabel("First name").fill("Abandoned");
    await page.getByRole("button", { name: "Cancel" }).click();

    await expect(page.getByRole("heading", { name: "Create new client" })).toHaveCount(0);
    await expect(page.getByLabel("Proposal title")).toHaveValue("Should Not Be Lost");
  });

  test("a duplicate email within the same tenant shows a friendly error and keeps the modal open", async ({ page }) => {
    const suffix = uniqueSuffix();
    const email = `dup-${suffix}@example.com`;

    await page.goto("/proposals/new");
    await page.getByRole("button", { name: "+ New client" }).click();
    await page.getByLabel("First name").fill("First");
    await page.getByLabel("Last name").fill("Client");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Phone").fill("555-222-3333");
    await page.getByRole("button", { name: "Create client" }).click();
    await expect(page.getByText("Client created and selected.")).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: "+ New client" }).click();
    await page.getByLabel("First name").fill("Second");
    await page.getByLabel("Last name").fill("Client");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Phone").fill("555-444-5555");
    await page.getByRole("button", { name: "Create client" }).click();

    // The same message also appears in the top-of-form error banner (by
    // design, once fieldErrors was added alongside it), so target the
    // field-specific message by id to avoid an ambiguous match.
    await expect(page.locator("#email-error")).toHaveText("This email is already associated with an existing client.", {
      timeout: 15_000,
    });
    await expect(page.getByRole("heading", { name: "Create new client" })).toBeVisible();
    await expect(page.getByText("This page couldn't load")).toHaveCount(0);
  });

  test("an invalid email is blocked by the browser's own validation before it ever reaches the server", async ({ page }) => {
    await page.goto("/proposals/new");
    await page.getByRole("button", { name: "+ New client" }).click();
    await page.getByLabel("First name").fill("Bad");
    await page.getByLabel("Last name").fill("Email");
    await page.getByLabel("Email").fill("not-an-email");
    await page.getByLabel("Phone").fill("555-777-8888");

    const isValid = await page.getByLabel("Email").evaluate((el: HTMLInputElement) => el.checkValidity());
    expect(isValid).toBe(false);
  });
});

test.describe("Quick Create Client — permissions", () => {
  test.use({ storageState: authFile("viewer-a") });

  test("Viewer cannot reach New Proposal (and therefore cannot quick-create a client) — no crash either way", async ({ page }) => {
    await page.goto("/proposals/new");
    await expect(page.getByText("This page couldn't load")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "+ New client" })).toHaveCount(0);
  });
});
