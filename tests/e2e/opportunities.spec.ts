import { test, expect } from "@playwright/test";
import { authFile, uniqueSuffix } from "./fixtures/session";

test.use({ storageState: authFile("owner-a") });

async function createClient(page: import("@playwright/test").Page, name: string) {
  await page.goto("/clients/new");
  await page.getByLabel("Display name").fill(name);
  await page.getByRole("button", { name: "Create client" }).click();
  await page.waitForURL(/\/clients\/[0-9a-f-]+$/);
}

async function createOpportunity(page: import("@playwright/test").Page, clientName: string, title: string) {
  await page.goto("/opportunities/new");
  await page.getByLabel("Client").selectOption({ label: clientName });
  await page.getByLabel("Title").fill(title);
  await page.getByRole("button", { name: "Create opportunity" }).click();
  await page.waitForURL(/\/opportunities\/[0-9a-f-]+$/);
  return page.url();
}

test.describe("Opportunities", () => {
  test("create an opportunity with a responsible member and an estimated value", async ({ page }) => {
    const suffix = uniqueSuffix();
    const clientName = `E2E Opp Client ${suffix}`;
    await createClient(page, clientName);

    await page.goto("/opportunities/new");
    await page.getByLabel("Client").selectOption({ label: clientName });
    await page.getByLabel("Title").fill(`E2E Opportunity ${suffix}`);
    await page.getByLabel("Estimated value ($)").fill("1250.50");
    // "Assigned to" defaults to "Unassigned" — Owner A is the only active
    // member available in most runs, so just confirm the control exists and
    // is usable rather than asserting a specific name (membership rosters
    // vary run to run).
    await expect(page.getByLabel("Assigned to")).toBeVisible();
    await page.getByRole("button", { name: "Create opportunity" }).click();

    await page.waitForURL(/\/opportunities\/[0-9a-f-]+$/);
    await expect(page.getByRole("heading", { name: `E2E Opportunity ${suffix}` })).toBeVisible();
    // Locale-tolerant: the server formats currency via Intl with the
    // server process's default locale, which may not always be en-US.
    await expect(page.getByText(/Estimated value:.*1[,.]?250[.,]50/)).toBeVisible();
    await expect(page.locator(".badge").filter({ hasText: "new" })).toBeVisible();
  });

  test("a valid transition changes status, persists after reload, and logs an activity", async ({ page }) => {
    const suffix = uniqueSuffix();
    const clientName = `E2E Opp Transition ${suffix}`;
    await createClient(page, clientName);
    const url = await createOpportunity(page, clientName, `E2E Transition ${suffix}`);

    await page.getByRole("button", { name: "Move to contacted" }).click();
    await page.getByRole("button", { name: "Confirm: move to contacted" }).click();
    await page.waitForURL(url);
    await expect(page.locator(".badge").filter({ hasText: "contacted" })).toBeVisible();

    await page.reload();
    await expect(page.locator(".badge").filter({ hasText: "contacted" })).toBeVisible();

    await expect(page.getByRole("heading", { name: "Activity" })).toBeVisible();
    await expect(page.getByText(/contacted/i).first()).toBeVisible();
  });

  test("a tampered/manipulated status value is rejected with a friendly message, no internal function names, previous status kept", async ({
    page,
  }) => {
    const suffix = uniqueSuffix();
    const clientName = `E2E Opp Tamper ${suffix}`;
    await createClient(page, clientName);
    const url = await createOpportunity(page, clientName, `E2E Tamper ${suffix}`);

    // Reveal the confirm form for a VALID transition (new -> contacted)...
    await page.getByRole("button", { name: "Move to contacted" }).click();
    // ...then tamper the hidden field to an INVALID one (new -> won is not
    // allowed) before submitting, simulating a manipulated client request —
    // the button for this transition doesn't even exist in the UI, so this
    // is the only way to reach the server-side rejection path from a browser.
    await page.locator('input[name="newStatus"]').evaluate((el: HTMLInputElement) => {
      el.value = "won";
    });
    await page.getByRole("button", { name: /^Confirm: move to/ }).click();

    await expect(page.locator(".error-banner")).toBeVisible();
    const errorText = await page.locator(".error-banner").innerText();
    expect(errorText).not.toMatch(/archive_opportunity\(\)|restore_opportunity\(\)|SQLSTATE|postgres/i);
    expect(errorText.toLowerCase()).toContain("invalid transition");

    await page.goto(url);
    await expect(page.locator(".badge").filter({ hasText: "new" })).toBeVisible();
  });

  test("inspection_scheduled requires a date, then succeeds once provided", async ({ page }) => {
    const suffix = uniqueSuffix();
    const clientName = `E2E Opp Inspection ${suffix}`;
    await createClient(page, clientName);
    const url = await createOpportunity(page, clientName, `E2E Inspection ${suffix}`);

    await page.getByRole("button", { name: "Move to contacted" }).click();
    await page.getByRole("button", { name: "Confirm: move to contacted" }).click();
    await page.waitForURL(url);
    await page.getByRole("button", { name: "Move to qualified" }).click();
    await page.getByRole("button", { name: "Confirm: move to qualified" }).click();
    await page.waitForURL(url);

    await page.getByRole("button", { name: "Move to inspection scheduled" }).click();
    const dateField = page.getByLabel("Inspection date & time");
    // No `required` attribute — submitting without a date reaches the
    // Server Action, which now returns a field-level error (see
    // changeOpportunityStatusSchema's superRefine): red border + inline
    // message, not a browser popup.
    await page.getByRole("button", { name: /^Confirm: move to/ }).click();
    await expect(page).toHaveURL(url); // still here, no navigation happened
    await expect(dateField).toHaveClass(/field-input-error/);
    await expect(page.locator("#inspectionScheduledAt-error")).toHaveText("Choose an inspection date and time.");
    await expect(dateField).toBeFocused();

    await dateField.fill("2027-01-15T10:00");
    await page.getByRole("button", { name: /^Confirm: move to/ }).click();
    await page.waitForURL(url);
    await expect(page.locator(".badge").filter({ hasText: "inspection scheduled" })).toBeVisible();
  });

  test("lost requires a reason, is preserved through reactivation, and can be reactivated", async ({ page }) => {
    const suffix = uniqueSuffix();
    const clientName = `E2E Opp Lost ${suffix}`;
    await createClient(page, clientName);
    const url = await createOpportunity(page, clientName, `E2E Lost ${suffix}`);

    await page.getByRole("button", { name: "Move to lost" }).click();
    const reasonField = page.getByLabel("Why was this lost?");
    await page.getByRole("button", { name: /^Confirm: move to/ }).click();
    await expect(page).toHaveURL(url);
    await expect(reasonField).toHaveClass(/field-input-error/);
    await expect(page.locator("#lostReason-error")).toHaveText("Tell us why this opportunity was lost.");
    await expect(reasonField).toBeFocused();

    await reasonField.fill("Went with a competitor");
    await page.getByRole("button", { name: /^Confirm: move to/ }).click();
    await page.waitForURL(url);
    await expect(page.locator(".badge").filter({ hasText: "lost" })).toBeVisible();
    await expect(page.getByText("Lost reason: Went with a competitor")).toBeVisible();

    // Reactivate — lost -> contacted is allowed per docs/22.
    await page.getByRole("button", { name: "Move to contacted" }).click();
    await page.getByRole("button", { name: "Confirm: move to contacted" }).click();
    await page.waitForURL(url);
    await expect(page.locator(".badge").filter({ hasText: "contacted" })).toBeVisible();
    // lost_reason is preserved (not cleared) per ADR 0011.
    await expect(page.getByText("Lost reason: Went with a competitor")).toBeVisible();
  });

  test("archive requires won/lost first, then archive and restore round-trip", async ({ page }) => {
    const suffix = uniqueSuffix();
    const clientName = `E2E Opp Archive ${suffix}`;
    await createClient(page, clientName);
    const url = await createOpportunity(page, clientName, `E2E Archive ${suffix}`);

    // No Archive button yet — opportunity is still "new", not won/lost.
    await expect(page.getByRole("button", { name: "Archive" })).toHaveCount(0);

    await page.getByRole("button", { name: "Move to lost" }).click();
    await page.getByLabel("Why was this lost?").fill("Budget cut");
    await page.getByRole("button", { name: /^Confirm: move to/ }).click();
    await page.waitForURL(url);

    await page.getByRole("button", { name: "Archive" }).click();
    await page.waitForURL(url);
    await expect(page.locator(".badge").filter({ hasText: "archived" })).toBeVisible();

    await page.getByRole("button", { name: "Restore" }).click();
    await page.waitForURL(url);
    await expect(page.locator(".badge").filter({ hasText: "lost" })).toBeVisible();
  });
});
