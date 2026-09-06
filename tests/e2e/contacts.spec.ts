import { test, expect } from "@playwright/test";
import { authFile, uniqueSuffix } from "./fixtures/session";

test.use({ storageState: authFile("owner-a") });

async function createClientAndOpen(page: import("@playwright/test").Page, name: string) {
  await page.goto("/clients/new");
  await page.getByLabel("Display name").fill(name);
  await page.getByRole("button", { name: "Create client" }).click();
  await page.waitForURL(/\/clients\/[0-9a-f-]+$/);
  return page.url();
}

test.describe("Client contacts", () => {
  test("primary contact switching: only one primary survives a switch, and it holds after reload", async ({ page }) => {
    const suffix = uniqueSuffix();
    await createClientAndOpen(page, `E2E Contacts ${suffix}`);

    await page.getByRole("button", { name: "+ Add contact" }).click();
    await page.getByLabel("First name").fill("Alpha");
    await page.getByLabel("Last name").fill("One");
    await page.getByLabel("Make primary contact").check();
    await page.getByRole("button", { name: "Add contact" }).click();
    await page.waitForLoadState("networkidle");
    await expect(page.locator("li.card").filter({ hasText: "Alpha One" })).toBeVisible();
    await expect(page.locator("li.card").filter({ hasText: "Alpha One" }).getByText("Primary", { exact: true })).toBeVisible();

    // The create-contact form is uncontrolled and stays open/mounted after a
    // successful submit (the RSC refresh updates `contacts` without
    // remounting the component or resetting `showForm`) — there is no
    // "+ Add contact" toggle to click again. Reuse the same form, and
    // explicitly clear the "Make primary" checkbox left checked from before.
    await page.getByLabel("First name").fill("Beta");
    await page.getByLabel("Last name").fill("Two");
    await page.getByLabel("Make primary contact").uncheck();
    await page.getByRole("button", { name: "Add contact" }).click();
    await page.waitForLoadState("networkidle");
    const betaRow = page.locator("li.card").filter({ hasText: "Beta Two" });
    await expect(betaRow).toBeVisible();
    await expect(betaRow.getByText("Primary", { exact: true })).toHaveCount(0);

    await betaRow.getByRole("button", { name: "Make primary" }).click();
    await page.waitForLoadState("networkidle");

    await expect(page.locator("li.card").filter({ hasText: "Alpha One" }).getByText("Primary", { exact: true })).toHaveCount(0);
    await expect(page.locator("li.card").filter({ hasText: "Beta Two" }).getByText("Primary", { exact: true })).toBeVisible();

    // Reload to confirm this is real persisted state, not optimistic UI.
    await page.reload();
    const primaryBadges = page.locator("li.card").getByText("Primary", { exact: true });
    await expect(primaryBadges).toHaveCount(1);
    await expect(page.locator("li.card").filter({ hasText: "Beta Two" }).getByText("Primary", { exact: true })).toBeVisible();
  });

  test("edit, archive, and restore a contact", async ({ page }) => {
    const suffix = uniqueSuffix();
    await createClientAndOpen(page, `E2E Contact Edit ${suffix}`);

    await page.getByRole("button", { name: "+ Add contact" }).click();
    await page.getByLabel("First name").fill("Gamma");
    await page.getByRole("button", { name: "Add contact" }).click();
    const row = page.locator("li.card").filter({ hasText: "Gamma" });
    await expect(row).toBeVisible();

    await row.getByRole("button", { name: "Edit" }).click();
    await row.getByLabel("Phone").fill("555-0177");
    await row.getByRole("button", { name: "Save" }).click();
    await expect(row.getByText("555-0177")).toBeVisible();
    await page.reload();
    await expect(page.locator("li.card").filter({ hasText: "Gamma" }).getByText("555-0177")).toBeVisible();

    const gammaRow = page.locator("li.card").filter({ hasText: "Gamma" });
    await gammaRow.getByRole("button", { name: "Archive" }).click();
    await page.waitForLoadState("networkidle");
    await expect(page.locator("li.card").filter({ hasText: "Gamma" }).getByText("Archived")).toBeVisible();

    await page.locator("li.card").filter({ hasText: "Gamma" }).getByRole("button", { name: "Restore" }).click();
    await page.waitForLoadState("networkidle");
    await expect(page.locator("li.card").filter({ hasText: "Gamma" }).getByText("Archived")).toHaveCount(0);
  });

  test("required-field validation shows a red, inline error for an empty first name; no duplicate created on rapid double submit", async ({
    page,
  }) => {
    const suffix = uniqueSuffix();
    await createClientAndOpen(page, `E2E Contact Validation ${suffix}`);

    await page.getByRole("button", { name: "+ Add contact" }).click();
    await page.getByRole("button", { name: "Add contact" }).click();
    // No `required` attribute — the empty submit reaches the Server
    // Action, which returns a field-level error rendered inline (red
    // border + message + focus), not a browser popup. The form itself is
    // still open, not replaced by a fresh empty toggle state.
    const firstName = page.getByLabel("First name");
    await expect(firstName).toBeVisible();
    await expect(firstName).toHaveClass(/field-input-error/);
    // The same message also appears in the top-of-form error banner (by
    // design), so target the field-specific message by id.
    await expect(page.locator("#firstName-error")).toHaveText("First name is required");
    await expect(firstName).toBeFocused();

    await firstName.fill(`Delta-${suffix}`);
    const submit = page.getByRole("button", { name: "Add contact" });
    // Fire two rapid clicks to simulate an eager double-submit; the button
    // disables itself on the first click (see components/submit-button.tsx),
    // so at most one request should ever reach the server.
    await Promise.all([submit.click(), submit.click({ force: true }).catch(() => {})]);
    await page.waitForLoadState("networkidle");

    const matches = page.locator("li.card").filter({ hasText: `Delta-${suffix}` });
    await expect(matches).toHaveCount(1);
  });
});
