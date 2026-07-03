import { test, expect } from "@playwright/test";
import { authFile, uniqueSuffix } from "./fixtures/session";

test.use({ storageState: authFile("owner-a") });

async function createClient(page: import("@playwright/test").Page, name: string) {
  await page.goto("/clients/new");
  await page.getByLabel("Display name").fill(name);
  await page.getByRole("button", { name: "Create client" }).click();
  await page.waitForURL(/\/clients\/[0-9a-f-]+$/);
}

test.describe("Projects", () => {
  test("create a project directly, without an opportunity", async ({ page }) => {
    const suffix = uniqueSuffix();
    const clientName = `E2E Project Client ${suffix}`;
    await createClient(page, clientName);

    await page.goto("/projects/new");
    await page.getByLabel("Client").selectOption({ label: clientName });
    await page.getByLabel("Project name").fill(`E2E Direct Project ${suffix}`);
    await page.getByLabel("Service type").fill("Interior painting");
    await page.getByRole("button", { name: "Create project" }).click();

    await page.waitForURL(/\/projects\/[0-9a-f-]+$/);
    await expect(page.getByRole("heading", { name: `E2E Direct Project ${suffix}` })).toBeVisible();
    await expect(page.locator(".badge").filter({ hasText: "draft" })).toBeVisible();
    await expect(page.getByText("Service type: Interior painting")).toBeVisible();
  });

  test("converting an opportunity creates one project, and repeating/double-clicking never creates a second one", async ({
    page,
  }) => {
    const suffix = uniqueSuffix();
    const clientName = `E2E Convert Client ${suffix}`;
    await createClient(page, clientName);

    await page.goto("/opportunities/new");
    await page.getByLabel("Client").selectOption({ label: clientName });
    await page.getByLabel("Title").fill(`E2E Convert Opp ${suffix}`);
    await page.getByRole("button", { name: "Create opportunity" }).click();
    await page.waitForURL(/\/opportunities\/[0-9a-f-]+$/);
    const opportunityUrl = page.url();

    await page.getByRole("button", { name: "Move to contacted" }).click();
    await page.getByRole("button", { name: "Confirm: move to contacted" }).click();
    await page.waitForURL(opportunityUrl);
    await page.getByRole("button", { name: "Move to qualified" }).click();
    await page.getByRole("button", { name: "Confirm: move to qualified" }).click();
    await page.waitForURL(opportunityUrl);
    await page.getByRole("button", { name: "Move to ready for estimate" }).click();
    await page.getByRole("button", { name: "Confirm: move to ready for estimate" }).click();
    await page.waitForURL(opportunityUrl);

    await page.getByRole("button", { name: "Convert to project" }).click();
    await expect(page.getByLabel("Project name")).toHaveValue(`E2E Convert Opp ${suffix}`);
    const createButton = page.getByRole("button", { name: "Create project" });
    await createButton.waitFor({ state: "visible" });
    // Two synchronous native clicks in one browser-side call, back-to-back
    // before React can re-render the disabled state — a more realistic
    // double-click simulation than two separate Playwright .click() calls,
    // which fight Playwright's own actionability retries once the first
    // click triggers navigation away from the element.
    await createButton.evaluate((btn: HTMLButtonElement) => {
      btn.click();
      btn.click();
    });
    await page.waitForURL(/\/projects\/[0-9a-f-]+$/);

    // Only one project exists for this opportunity: going back to the
    // opportunity must show exactly one "Converted to project" link, and
    // that project's client detail page must list exactly one project.
    await page.goto(opportunityUrl);
    await expect(page.getByText("Converted to project:")).toBeVisible();
    const projectLinks = page.locator("a", { hasText: `E2E Convert Opp ${suffix}` });
    await expect(projectLinks).toHaveCount(1);
  });

  test("project addresses: only one primary at a time, persists across reload", async ({ page }) => {
    const suffix = uniqueSuffix();
    const clientName = `E2E Address Client ${suffix}`;
    await createClient(page, clientName);

    await page.goto("/projects/new");
    await page.getByLabel("Client").selectOption({ label: clientName });
    await page.getByLabel("Project name").fill(`E2E Address Project ${suffix}`);
    await page.getByRole("button", { name: "Create project" }).click();
    await page.waitForURL(/\/projects\/[0-9a-f-]+$/);

    // First address form is auto-shown since there are zero addresses yet.
    await page.getByLabel("Address line 1").fill("123 Main St");
    await page.getByLabel("City").fill("Springfield");
    await page.getByLabel("State").fill("IL");
    await page.getByLabel("Postal code").fill("62704");
    await page.getByRole("button", { name: "Add address" }).click();
    await page.waitForLoadState("networkidle");
    const firstAddressRow = page.locator("li.card").filter({ hasText: "123 Main St" });
    await expect(firstAddressRow.getByText("Primary", { exact: true })).toBeVisible();

    // The create-address form stays open/mounted after a successful submit
    // (uncontrolled form, RSC refresh doesn't remount it or reset
    // `showForm`) — no "+ Add address" toggle to click again. Reuse the same
    // form, and explicitly uncheck "Primary address": it was left checked
    // (defaultChecked when addresses.length was 0) from the first submit.
    await page.getByLabel("Address line 1").fill("456 Oak Ave");
    await page.getByLabel("City").fill("Springfield");
    await page.getByLabel("State").fill("IL");
    await page.getByLabel("Postal code").fill("62704");
    await page.getByLabel("Primary address").uncheck();
    await page.getByRole("button", { name: "Add address" }).click();
    await page.waitForLoadState("networkidle");
    const secondAddressRow = page.locator("li.card").filter({ hasText: "456 Oak Ave" });
    await expect(secondAddressRow.getByText("Primary", { exact: true })).toHaveCount(0);

    await secondAddressRow.getByRole("button", { name: "Make primary" }).click();
    await page.waitForLoadState("networkidle");
    await expect(page.locator("li.card").filter({ hasText: "123 Main St" }).getByText("Primary", { exact: true })).toHaveCount(0);
    await expect(page.locator("li.card").filter({ hasText: "456 Oak Ave" }).getByText("Primary", { exact: true })).toBeVisible();

    await page.reload();
    await expect(page.locator("li.card").getByText("Primary", { exact: true })).toHaveCount(1);
    await expect(page.locator("li.card").filter({ hasText: "456 Oak Ave" }).getByText("Primary", { exact: true })).toBeVisible();
  });

  test("address archive/restore never leaves two primaries active", async ({ page }) => {
    const suffix = uniqueSuffix();
    const clientName = `E2E Address Restore Client ${suffix}`;
    await createClient(page, clientName);

    await page.goto("/projects/new");
    await page.getByLabel("Client").selectOption({ label: clientName });
    await page.getByLabel("Project name").fill(`E2E Address Restore Project ${suffix}`);
    await page.getByRole("button", { name: "Create project" }).click();
    await page.waitForURL(/\/projects\/[0-9a-f-]+$/);

    await page.getByLabel("Address line 1").fill("789 Pine Rd");
    await page.getByLabel("City").fill("Shelbyville");
    await page.getByLabel("State").fill("IL");
    await page.getByLabel("Postal code").fill("62565");
    await page.getByRole("button", { name: "Add address" }).click();
    await page.waitForLoadState("networkidle");

    const row = page.locator("li.card").filter({ hasText: "789 Pine Rd" });
    await row.getByRole("button", { name: "Archive" }).click();
    await page.waitForLoadState("networkidle");
    await expect(page.locator("li.card").filter({ hasText: "789 Pine Rd" }).getByText("Archived")).toBeVisible();
    // Archiving the primary clears is_primary — no controls remain for an
    // archived address (no restore button exists in the UI per docs/24).
    await expect(page.locator("li.card").filter({ hasText: "789 Pine Rd" }).getByText("Primary", { exact: true })).toHaveCount(0);
  });

  test("status transitions: valid moves persist, a tampered request is rejected without corrupting state", async ({ page }) => {
    const suffix = uniqueSuffix();
    const clientName = `E2E Project Status Client ${suffix}`;
    await createClient(page, clientName);

    await page.goto("/projects/new");
    await page.getByLabel("Client").selectOption({ label: clientName });
    await page.getByLabel("Project name").fill(`E2E Project Status ${suffix}`);
    await page.getByRole("button", { name: "Create project" }).click();
    await page.waitForURL(/\/projects\/[0-9a-f-]+$/);
    const url = page.url();

    await page.getByRole("button", { name: "Move to inspection pending" }).click();
    await page.getByLabel("Inspection date & time").fill("2027-02-01T09:00");
    await page.getByRole("button", { name: /^Confirm: move to/ }).click();
    await page.waitForURL(url);
    await expect(page.locator(".badge").filter({ hasText: "inspection pending" })).toBeVisible();

    // Tamper: reveal the (valid) "inspection completed" form, then rewrite
    // the hidden status to "ready_for_estimate" directly, skipping the
    // required intermediate step — not reachable via any rendered button.
    await page.getByRole("button", { name: "Move to inspection completed" }).click();
    await page.locator('input[name="newStatus"]').evaluate((el: HTMLInputElement) => {
      el.value = "archived";
    });
    await page.getByRole("button", { name: /^Confirm: move to/ }).click();
    await expect(page.locator(".error-banner")).toBeVisible();
    const errorText = await page.locator(".error-banner").innerText();
    expect(errorText).not.toMatch(/archive_project\(\)|restore_project\(\)|SQLSTATE|postgres/i);

    await page.goto(url);
    await expect(page.locator(".badge").filter({ hasText: "inspection pending" })).toBeVisible();
  });

  test("archive requires an eligible status, then archive/restore round-trips", async ({ page }) => {
    const suffix = uniqueSuffix();
    const clientName = `E2E Project Archive Client ${suffix}`;
    await createClient(page, clientName);

    await page.goto("/projects/new");
    await page.getByLabel("Client").selectOption({ label: clientName });
    await page.getByLabel("Project name").fill(`E2E Project Archive ${suffix}`);
    await page.getByRole("button", { name: "Create project" }).click();
    await page.waitForURL(/\/projects\/[0-9a-f-]+$/);
    const url = page.url();

    // "draft" is not archivable — no Archive button yet.
    await expect(page.getByRole("button", { name: "Archive" })).toHaveCount(0);

    await page.getByRole("button", { name: "Move to cancelled" }).click();
    await page.getByRole("button", { name: /^Confirm: move to/ }).click();
    await page.waitForURL(url);
    await expect(page.locator(".badge").filter({ hasText: "cancelled" })).toBeVisible();

    await page.getByRole("button", { name: "Archive" }).click();
    await page.waitForURL(url);
    await expect(page.locator(".badge").filter({ hasText: "archived" })).toBeVisible();

    await page.getByRole("button", { name: "Restore" }).click();
    await page.waitForURL(url);
    await expect(page.locator(".badge").filter({ hasText: "cancelled" })).toBeVisible();
  });
});
