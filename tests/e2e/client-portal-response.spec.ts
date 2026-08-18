import { test, expect, type Page } from "@playwright/test";
import { authFile, uniqueSuffix } from "./fixtures/session";
import { getCapturedPortalOtpCode } from "./fixtures/portal";

test.use({ storageState: authFile("owner-a") });

/** Creates a client (with an email) + a direct proposal, marks it ready, and returns the detail page URL. */
async function createReadyProposal(page: Page, suffix: string): Promise<{ proposalUrl: string; clientEmail: string }> {
  const clientName = `E2E Response Client ${suffix}`;
  const clientEmail = `response-client-${suffix}@example.com`;

  await page.goto("/clients/new");
  await page.getByLabel("Client type").selectOption("individual");
  await page.getByLabel("Display name").fill(clientName);
  await page.getByLabel("Email").fill(clientEmail);
  await page.getByRole("button", { name: "Create client" }).click();
  await page.waitForURL(/\/clients\/[0-9a-f-]+$/);

  await page.goto("/proposals/new");
  await page.getByLabel("Client", { exact: true }).selectOption({ label: clientName });
  await page.waitForURL(/clientId=/);
  await page.getByLabel("Proposal title").fill(`E2E Response Proposal ${suffix}`);
  await page.getByLabel("Service type").selectOption("custom");
  await page.getByLabel("Custom service name").fill("Custom test service");
  await page.getByRole("button", { name: "Save and continue" }).click();
  await page.waitForURL(/\/proposals\/[0-9a-f-]+\/edit\?step=measurements/);
  const proposalUrl = page.url().replace(/\/edit\?step=measurements$/, "");

  await page.goto(proposalUrl);
  await page.getByRole("button", { name: "Mark ready" }).click();
  await expect(page.locator(".badge").filter({ hasText: "ready" })).toBeVisible({ timeout: 30_000 });

  return { proposalUrl, clientEmail };
}

async function createPortalLink(page: Page, proposalUrl: string): Promise<string> {
  await page.goto(proposalUrl);
  await page.getByRole("button", { name: "Create client portal link" }).click();
  const urlInput = page.locator("#portal-link-url");
  await expect(urlInput).toBeVisible({ timeout: 15_000 });
  return urlInput.inputValue();
}

/** Runs the full request-code -> verify -> view flow on a fresh, unauthenticated context; returns that page, positioned on /view. */
async function openPortalAsVisitor(browser: import("@playwright/test").Browser, portalUrl: string, clientEmail: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(portalUrl);
  await page.getByLabel("Email").fill(clientEmail);
  await page.getByRole("button", { name: "Send access code" }).click();
  await page.waitForURL(/\/verify\?email=/);

  const code = await getCapturedPortalOtpCode(clientEmail);
  await page.getByLabel("Access code").fill(code);
  await page.getByRole("button", { name: "View proposal" }).click();
  await page.waitForURL(/\/view$/);

  return { context, page };
}

test.describe("Client portal — accept", () => {
  test("client accepts a proposal, sees confirmation, and the contractor sees the accepted status", async ({ page, browser }) => {
    test.setTimeout(60_000);
    const suffix = uniqueSuffix();
    const { proposalUrl, clientEmail } = await createReadyProposal(page, suffix);
    const portalUrl = await createPortalLink(page, proposalUrl);

    const { context: visitorContext, page: visitorPage } = await openPortalAsVisitor(browser, portalUrl, clientEmail);

    await expect(visitorPage.getByRole("heading", { name: "Ready to move forward?" })).toBeVisible();
    await visitorPage.getByRole("button", { name: "Accept proposal" }).first().click();
    await visitorPage.getByLabel("Your name").fill("Jane Client");
    await visitorPage.getByRole("checkbox").check();

    visitorPage.once("dialog", (dialog) => dialog.accept());
    await visitorPage.getByRole("button", { name: "Accept proposal" }).last().click();

    await expect(visitorPage.getByRole("heading", { name: "Proposal accepted" })).toBeVisible({ timeout: 15_000 });
    await expect(visitorPage.getByText("Thank you. Your approval has been recorded")).toBeVisible();

    // Reload: no active buttons, same final state shown again.
    await visitorPage.reload();
    await expect(visitorPage.getByRole("heading", { name: "Proposal accepted" })).toBeVisible();
    await expect(visitorPage.getByRole("button", { name: "Accept proposal" })).toHaveCount(0);
    await expect(visitorPage.getByRole("button", { name: "Decline" })).toHaveCount(0);
    await visitorContext.close();

    // Contractor side. Both the top status badge and the "Client response"
    // card's own badge read "Accepted" -- .first() is enough to confirm
    // the status is reflected; the surrounding text confirms which is which.
    await page.goto(proposalUrl);
    await expect(page.locator(".badge").filter({ hasText: "accepted" }).first()).toBeVisible();
    await expect(page.getByText(/Jane Client/)).toBeVisible();
    await expect(page.getByText(clientEmail)).toBeVisible();
    // The version is now locked -- editing is no longer offered.
    await expect(page.getByRole("link", { name: "Continue editing" })).toHaveCount(0);
    // The Client portal panel must not suggest a state the proposal has
    // already moved past (it's accepted, not merely "not ready yet").
    await expect(page.getByText("Mark this proposal ready to create a client portal link.")).toHaveCount(0);
  });
});

test.describe("Client portal — decline", () => {
  test("client declines a proposal with a reason, and the contractor sees the declined status and reason", async ({ page, browser }) => {
    test.setTimeout(60_000);
    const suffix = uniqueSuffix();
    const { proposalUrl, clientEmail } = await createReadyProposal(page, suffix);
    const portalUrl = await createPortalLink(page, proposalUrl);

    const { context: visitorContext, page: visitorPage } = await openPortalAsVisitor(browser, portalUrl, clientEmail);

    await visitorPage.getByRole("button", { name: "Decline" }).click();
    await visitorPage.getByLabel("Reason (optional)").fill("Went with another contractor");

    visitorPage.once("dialog", (dialog) => dialog.accept());
    await visitorPage.getByRole("button", { name: "Decline proposal" }).click();

    await expect(visitorPage.getByRole("heading", { name: "Proposal declined" })).toBeVisible({ timeout: 15_000 });
    await expect(visitorPage.getByText("Your response has been recorded.")).toBeVisible();
    // The reason itself is not echoed back to the client -- only recorded for the contractor.
    await expect(visitorPage.getByText("Went with another contractor")).toHaveCount(0);
    await visitorContext.close();

    await page.goto(proposalUrl);
    await expect(page.locator(".badge").filter({ hasText: "declined" }).first()).toBeVisible();
    await expect(page.getByText(clientEmail)).toBeVisible();
    // Phase 3B.1 added a second card (declined-revision prompt) that also
    // mentions the reason within a longer sentence -- .first() is enough to
    // confirm the reason is shown; tests/e2e/proposal-revision.spec.ts
    // covers the revision card's own copy specifically.
    await expect(page.getByText("Reason: Went with another contractor").first()).toBeVisible();
  });

  test("declining with no reason still records the response cleanly", async ({ page, browser }) => {
    test.setTimeout(60_000);
    const suffix = uniqueSuffix();
    const { proposalUrl, clientEmail } = await createReadyProposal(page, suffix);
    const portalUrl = await createPortalLink(page, proposalUrl);

    const { context: visitorContext, page: visitorPage } = await openPortalAsVisitor(browser, portalUrl, clientEmail);

    await visitorPage.getByRole("button", { name: "Decline" }).click();
    visitorPage.once("dialog", (dialog) => dialog.accept());
    await visitorPage.getByRole("button", { name: "Decline proposal" }).click();

    await expect(visitorPage.getByRole("heading", { name: "Proposal declined" })).toBeVisible({ timeout: 15_000 });
    await visitorContext.close();

    await page.goto(proposalUrl);
    await expect(page.locator(".badge").filter({ hasText: "declined" }).first()).toBeVisible();
    await expect(page.getByText(/^Reason:/)).toHaveCount(0);
  });
});

test.describe("Client portal — duplicate response", () => {
  test("a second visitor session cannot respond once the proposal already has a final response", async ({ page, browser }) => {
    // Two full request-code -> verify -> view round trips in one test.
    test.setTimeout(90_000);
    const suffix = uniqueSuffix();
    const { proposalUrl, clientEmail } = await createReadyProposal(page, suffix);
    const portalUrl = await createPortalLink(page, proposalUrl);

    const first = await openPortalAsVisitor(browser, portalUrl, clientEmail);
    await first.page.getByRole("button", { name: "Accept proposal" }).first().click();
    await first.page.getByLabel("Your name").fill("Jane Client");
    await first.page.getByRole("checkbox").check();
    first.page.once("dialog", (dialog) => dialog.accept());
    await first.page.getByRole("button", { name: "Accept proposal" }).last().click();
    await expect(first.page.getByRole("heading", { name: "Proposal accepted" })).toBeVisible({ timeout: 15_000 });
    await first.context.close();

    // A brand new visitor context, reusing the SAME portal link + a fresh
    // OTP for the same authorized email, arriving after the fact.
    const second = await openPortalAsVisitor(browser, portalUrl, clientEmail);
    await expect(second.page.getByRole("heading", { name: "Proposal accepted" })).toBeVisible();
    await expect(second.page.getByRole("button", { name: "Decline" })).toHaveCount(0);
    await second.context.close();
  });
});
