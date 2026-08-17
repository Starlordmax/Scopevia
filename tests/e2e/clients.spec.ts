import { test, expect } from "@playwright/test";
import { authFile, uniqueSuffix } from "./fixtures/session";

test.use({ storageState: authFile("owner-a") });

test.describe("Clients", () => {
  test("create an individual client and find it in the list and in search", async ({ page }) => {
    const suffix = uniqueSuffix();
    const name = `E2E Indiv ${suffix}`;

    await page.goto("/clients/new");
    await expect(page.getByRole("heading", { name: "New client" })).toBeVisible();
    await page.getByLabel("Client type").selectOption("individual");
    await page.getByLabel("Display name").fill(name);
    await page.getByLabel("First name").fill("Jane");
    await page.getByLabel("Last name").fill("Doe");
    await page.getByLabel("Email").fill(`jane-${suffix}@example.com`);
    await page.getByLabel("Phone", { exact: true }).fill("555-0100");
    await page.getByRole("button", { name: "Create client" }).click();

    // Real redirect to the detail page — proves the server action succeeded.
    await page.waitForURL(/\/clients\/[0-9a-f-]+$/);
    await expect(page.getByRole("heading", { name: new RegExp(name) })).toBeVisible();
    await expect(page.getByText("Email: jane-" + suffix + "@example.com")).toBeVisible();

    await page.goto("/clients");
    await expect(page.getByRole("link", { name })).toBeVisible();

    await page.getByPlaceholder("Search by name, email, phone…").fill(name);
    await page.getByRole("button", { name: "Search" }).click();
    await expect(page.getByRole("link", { name })).toBeVisible();
  });

  test("create a business client with a legal name", async ({ page }) => {
    const suffix = uniqueSuffix();
    const name = `E2E Biz ${suffix}`;

    await page.goto("/clients/new");
    await page.getByLabel("Client type").selectOption("business");
    await page.getByLabel("Display name").fill(name);
    await page.getByLabel("Legal name").fill(`${name} LLC`);
    await page.getByRole("button", { name: "Create client" }).click();

    await page.waitForURL(/\/clients\/[0-9a-f-]+$/);
    await expect(page.getByRole("heading", { name: new RegExp(name) })).toBeVisible();

    // Reload to prove persistence, not just optimistic client state.
    await page.reload();
    await expect(page.getByRole("heading", { name: new RegExp(name) })).toBeVisible();
  });

  test("submitting the form with the required display name empty shows a red, inline error and creates no partial record", async ({
    page,
  }) => {
    await page.goto("/clients/new");
    await page.getByLabel("Display name").fill("");
    await page.getByRole("button", { name: "Create client" }).click();

    // No `required` attribute — the empty submit reaches the Server
    // Action, which returns a field-level error rendered inline (red
    // border + message), not a browser popup. Still no partial record:
    // we never leave /clients/new, and no technical/SQL message is shown.
    await expect(page).toHaveURL(/\/clients\/new$/);
    const displayName = page.getByLabel("Display name");
    await expect(displayName).toHaveClass(/field-input-error/);
    await expect(displayName).toHaveAttribute("aria-invalid", "true");
    // The same message also appears in the top-of-form error banner (by
    // design — a general error never replaces the field-level one), so
    // target the field-specific message by id rather than getByText.
    await expect(page.locator("#displayName-error")).toHaveText("Display name is required");
    await expect(displayName).toBeFocused();

    // Correcting the field and resubmitting clears the red state and
    // actually creates the client.
    await displayName.fill("E2E Fixed After Error");
    await page.getByRole("button", { name: "Create client" }).click();
    await page.waitForURL(/\/clients\/[0-9a-f-]+$/);
  });

  test("editing a client persists after reload", async ({ page }) => {
    const suffix = uniqueSuffix();
    const name = `E2E Edit ${suffix}`;
    await page.goto("/clients/new");
    await page.getByLabel("Display name").fill(name);
    await page.getByRole("button", { name: "Create client" }).click();
    await page.waitForURL(/\/clients\/[0-9a-f-]+$/);
    const url = page.url();

    await page.getByRole("link", { name: "Edit" }).click();
    await expect(page.getByRole("heading", { name: "Edit client" })).toBeVisible();
    await page.getByLabel("Phone", { exact: true }).fill("555-0199");
    await page.getByRole("button", { name: "Save changes" }).click();

    await page.waitForURL(url);
    await expect(page.getByText("Phone: 555-0199")).toBeVisible();
    await page.reload();
    await expect(page.getByText("Phone: 555-0199")).toBeVisible();
  });

  test("archiving hides a client from the active list but it is findable via the archived filter, and restore brings it back", async ({
    page,
  }) => {
    const suffix = uniqueSuffix();
    const name = `E2E Archive ${suffix}`;
    await page.goto("/clients/new");
    await page.getByLabel("Display name").fill(name);
    await page.getByRole("button", { name: "Create client" }).click();
    await page.waitForURL(/\/clients\/[0-9a-f-]+$/);
    const url = page.url();

    await page.getByRole("button", { name: "Archive" }).click();
    await page.waitForURL(url);
    await expect(page.getByRole("heading", { name: new RegExp(`${name}.*Archived`) })).toBeVisible();

    await page.goto("/clients");
    await expect(page.getByRole("link", { name })).toHaveCount(0);

    await page.getByRole("link", { name: "View archived clients" }).click();
    await expect(page).toHaveURL(/archived=1/);
    await expect(page.getByRole("link", { name })).toBeVisible();

    await page.getByRole("link", { name }).click();
    await page.getByRole("button", { name: "Restore" }).click();
    await page.waitForURL(url);
    await expect(page.getByRole("heading", { name: new RegExp(`^${name}$`) })).toBeVisible();

    await page.goto("/clients");
    await expect(page.getByRole("link", { name })).toBeVisible();
  });
});
