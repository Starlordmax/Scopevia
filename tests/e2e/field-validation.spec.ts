import { test, expect, type Page } from "@playwright/test";
import { authFile, uniqueSuffix } from "./fixtures/session";
import { getCapturedPortalOtpCode } from "./fixtures/portal";

/**
 * Cross-cutting coverage for the app-wide required-field red-state UX
 * (see docs/75-global-field-validation.md) — every form here previously
 * relied on either the browser's native `required` popup (never styled,
 * never focus-managed the same way twice) or a generic top-of-form error
 * banner with no per-field indication. Measurements' own validation is
 * covered separately in custom-service-name-and-multistroke.spec.ts; New
 * Client + Opportunities are covered in clients.spec.ts/contacts.spec.ts/
 * opportunities.spec.ts; logo upload is covered in business-branding.spec.ts.
 * This file covers the remaining forms explicitly called out in the brief:
 * Quick Create Client, New Proposal's client selector, and the Client
 * Portal's request-code/verify/accept forms.
 */

/** Creates a client with an email, for portal-flow tests that need one. */
async function createClientWithEmail(page: Page, name: string, email: string): Promise<void> {
  await page.goto("/clients/new");
  await page.getByLabel("Client type").selectOption("individual");
  await page.getByLabel("Display name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Create client" }).click();
  await page.waitForURL(/\/clients\/[0-9a-f-]+$/);
}

test.describe("Quick Create Client — missing fields", () => {
  test.use({ storageState: authFile("owner-a") });

  test("submitting with every field empty shows red state on all four, and focuses the first", async ({ page }) => {
    await page.goto("/proposals/new");
    await page.getByRole("button", { name: "+ New client" }).click();
    await expect(page.getByRole("heading", { name: "Create new client" })).toBeVisible();

    await page.getByRole("button", { name: "Create client" }).click();

    const firstName = page.getByLabel("First name");
    const lastName = page.getByLabel("Last name");
    const email = page.getByLabel("Email");
    const phone = page.getByLabel("Phone");

    await expect(firstName).toHaveClass(/field-input-error/);
    await expect(lastName).toHaveClass(/field-input-error/);
    await expect(email).toHaveClass(/field-input-error/);
    await expect(phone).toHaveClass(/field-input-error/);
    // The same message also appears in the top-of-form error banner (by
    // design), so target each field-specific message by id.
    await expect(page.locator("#firstName-error")).toHaveText("First name is required");
    await expect(page.locator("#lastName-error")).toHaveText("Last name is required");
    await expect(page.locator("#phone-error")).toHaveText("Phone is required");

    // First field in the form is focused, not left to a generic banner.
    await expect(firstName).toBeFocused();

    // The modal never closed and no navigation happened.
    await expect(page.getByRole("heading", { name: "Create new client" })).toBeVisible();
    await expect(page).toHaveURL(/\/proposals\/new/);

    // Correcting the fields and resubmitting clears the red state.
    const suffix = uniqueSuffix();
    await firstName.fill("Jordan");
    await lastName.fill("Rivera");
    await email.fill(`jordan-rivera-${suffix}@example.com`);
    await phone.fill("555-345-6789");
    await page.getByRole("button", { name: "Create client" }).click();
    await expect(page.getByText("Client created and selected.")).toBeVisible({ timeout: 15_000 });
  });
});

test.describe("New Proposal — missing client", () => {
  test.use({ storageState: authFile("owner-a") });

  test("submitting without selecting a client shows a red, inline error on the client selector", async ({ page }) => {
    const suffix = uniqueSuffix();
    await page.goto("/proposals/new");
    await page.getByLabel("Proposal title").fill(`E2E No Client ${suffix}`);
    await page.getByLabel("Service type").selectOption("interior_painting");

    // The client <select>'s empty option is `disabled` (a placeholder,
    // "Select a client…"), so a browser never actually leaves it selected
    // by default once real client options exist — it falls back to the
    // first real client instead. Force the DOM value back to "" to
    // reliably exercise the empty-client submission path (still a real,
    // reachable payload server-side — e.g. a resubmit after a client was
    // deleted, or any non-browser POST).
    const clientSelect = page.locator("#clientId");
    await clientSelect.evaluate((el: HTMLSelectElement) => {
      el.value = "";
    });

    await page.getByRole("button", { name: "Save and continue" }).click();

    await expect(clientSelect).toHaveClass(/field-input-error/);
    await expect(page.locator("#clientId-error")).toHaveText("Please select a client.");
    await expect(page).toHaveURL(/\/proposals\/new/);
  });
});

test.describe("Client Portal — request code / verify / accept, missing fields", () => {
  test.use({ storageState: authFile("owner-a") });

  async function createReadyProposalWithPortalLink(page: Page, suffix: string): Promise<{ portalUrl: string; clientEmail: string }> {
    const clientName = `E2E Field Validation Client ${suffix}`;
    const clientEmail = `field-validation-${suffix}@example.com`;
    await createClientWithEmail(page, clientName, clientEmail);

    await page.goto("/proposals/new");
    await page.getByLabel("Client", { exact: true }).selectOption({ label: clientName });
    await page.waitForURL(/clientId=/);
    await page.getByLabel("Proposal title").fill(`E2E Field Validation Proposal ${suffix}`);
    await page.getByLabel("Service type").selectOption("custom");
    await page.getByLabel("Custom service name").fill("Custom test service");
    await page.getByRole("button", { name: "Save and continue" }).click();
    await page.waitForURL(/\/proposals\/[0-9a-f-]+\/edit\?step=measurements/);
    const proposalUrl = page.url().replace(/\/edit\?step=measurements$/, "");

    await page.goto(proposalUrl);
    await page.getByRole("button", { name: "Mark ready" }).click();
    await expect(page.locator(".badge").filter({ hasText: "ready" })).toBeVisible({ timeout: 30_000 });

    await page.getByRole("button", { name: "Create client portal link" }).click();
    const urlInput = page.locator("#portal-link-url");
    await expect(urlInput).toBeVisible({ timeout: 15_000 });
    const portalUrl = await urlInput.inputValue();

    return { portalUrl, clientEmail };
  }

  test("request-code form: submitting with a blank email shows a red, inline error", async ({ page, browser }) => {
    const suffix = uniqueSuffix();
    const { portalUrl } = await createReadyProposalWithPortalLink(page, suffix);

    const visitorContext = await browser.newContext();
    const visitorPage = await visitorContext.newPage();
    await visitorPage.goto(portalUrl);

    await visitorPage.getByRole("button", { name: "Send access code" }).click();

    const emailField = visitorPage.getByLabel("Email");
    await expect(emailField).toHaveClass(/field-input-error/);
    await expect(emailField).toHaveAttribute("aria-invalid", "true");
    // Exact zod-default wording for an empty/malformed email isn't pinned
    // here (only its custom messages are, elsewhere) — what matters is
    // that a real, non-empty message renders right under the field.
    await expect(visitorPage.locator("#email-error")).not.toBeEmpty();
    await expect(visitorPage).toHaveURL(portalUrl);

    await visitorContext.close();
  });

  test("verify form: submitting with a blank code shows a red, inline error and stays on /verify", async ({ page, browser }) => {
    const suffix = uniqueSuffix();
    const { portalUrl, clientEmail } = await createReadyProposalWithPortalLink(page, suffix);

    const visitorContext = await browser.newContext();
    const visitorPage = await visitorContext.newPage();
    await visitorPage.goto(portalUrl);
    await visitorPage.getByLabel("Email").fill(clientEmail);
    await visitorPage.getByRole("button", { name: "Send access code" }).click();
    await visitorPage.waitForURL(/\/verify\?email=/);

    await visitorPage.getByRole("button", { name: "View proposal" }).click();

    const codeField = visitorPage.getByLabel("Access code");
    await expect(codeField).toHaveClass(/field-input-error/);
    // The same message also appears in the top-of-form error banner (by
    // design), so target the field-specific message by id.
    await expect(visitorPage.locator("#code-error")).toHaveText("Enter the 6-digit code from your email");
    await expect(visitorPage).toHaveURL(/\/verify\?email=/);

    // Correcting it with the real captured code succeeds.
    const code = await getCapturedPortalOtpCode(clientEmail);
    await codeField.fill(code);
    await visitorPage.getByRole("button", { name: "View proposal" }).click();
    await visitorPage.waitForURL(/\/view$/);

    await visitorContext.close();
  });

  test("accept form: submitting with an empty name and unchecked terms shows both red, inline errors", async ({ page, browser }) => {
    const suffix = uniqueSuffix();
    const { portalUrl, clientEmail } = await createReadyProposalWithPortalLink(page, suffix);

    const visitorContext = await browser.newContext();
    const visitorPage = await visitorContext.newPage();
    await visitorPage.goto(portalUrl);
    await visitorPage.getByLabel("Email").fill(clientEmail);
    await visitorPage.getByRole("button", { name: "Send access code" }).click();
    await visitorPage.waitForURL(/\/verify\?email=/);
    const code = await getCapturedPortalOtpCode(clientEmail);
    await visitorPage.getByLabel("Access code").fill(code);
    await visitorPage.getByRole("button", { name: "View proposal" }).click();
    await visitorPage.waitForURL(/\/view$/);

    await visitorPage.getByRole("button", { name: "Accept proposal" }).click();
    visitorPage.once("dialog", (dialog) => dialog.accept());
    await visitorPage.getByRole("button", { name: "Accept proposal" }).click();

    const nameField = visitorPage.getByLabel("Your name");
    await expect(nameField).toHaveClass(/field-input-error/);
    // The same messages also appear in the top-of-form error banner (by
    // design — only the first Zod issue makes it into that banner, but
    // BOTH fields are marked invalid below), so target by id.
    await expect(visitorPage.locator("#clientName-error")).toHaveText("Please enter your name");
    await expect(visitorPage.locator("#acceptedTerms-error")).toHaveText("Please confirm you've reviewed the proposal before accepting");
    await expect(nameField).toBeFocused();
    await expect(visitorPage.getByRole("heading", { name: "Proposal accepted" })).toHaveCount(0);

    // Correcting both and resubmitting succeeds.
    await nameField.fill("Jane Visitor");
    await visitorPage.getByRole("checkbox").check();
    visitorPage.once("dialog", (dialog) => dialog.accept());
    await visitorPage.getByRole("button", { name: "Accept proposal" }).click();
    await expect(visitorPage.getByRole("heading", { name: "Proposal accepted" })).toBeVisible({ timeout: 15_000 });

    await visitorContext.close();
  });
});
