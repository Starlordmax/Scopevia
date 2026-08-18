import { test, expect, type Page } from "@playwright/test";
import { authFile, uniqueSuffix } from "./fixtures/session";
import { getCapturedPortalOtpCode } from "./fixtures/portal";

test.use({ storageState: authFile("owner-a") });

/** Creates a client (with an email) + a direct proposal, marks it ready, and returns the detail page URL. */
async function createReadyProposal(page: Page, suffix: string): Promise<{ proposalUrl: string; clientEmail: string }> {
  const clientName = `E2E Revision Client ${suffix}`;
  const clientEmail = `revision-client-${suffix}@example.com`;

  await page.goto("/clients/new");
  await page.getByLabel("Client type").selectOption("individual");
  await page.getByLabel("Display name").fill(clientName);
  await page.getByLabel("Email").fill(clientEmail);
  await page.getByRole("button", { name: "Create client" }).click();
  await page.waitForURL(/\/clients\/[0-9a-f-]+$/);

  await page.goto("/proposals/new");
  await page.getByLabel("Client", { exact: true }).selectOption({ label: clientName });
  await page.waitForURL(/clientId=/);
  await page.getByLabel("Proposal title").fill(`E2E Revision Proposal ${suffix}`);
  await page.getByLabel("Service type").selectOption("custom");
  await page.getByLabel("Custom service name").fill("Custom test service");
  await page.getByRole("button", { name: "Save and continue" }).click();
  await page.waitForURL(/\/proposals\/[0-9a-f-]+\/edit\?step=measurements/);
  const proposalUrl = page.url().replace(/\/edit\?step=measurements$/, "");

  await page.goto(`${proposalUrl}/edit?step=scope`);
  await page.getByLabel("Short summary").fill("Original scope summary");
  await page.getByRole("button", { name: "Save and continue" }).click();

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

test.describe("Proposal revision flow", () => {
  test("decline -> create revised version -> edit -> mark ready -> new link; old link keeps showing the old declined version", async ({
    page,
    browser,
  }) => {
    test.setTimeout(120_000);
    const suffix = uniqueSuffix();
    const { proposalUrl, clientEmail } = await createReadyProposal(page, suffix);
    const oldPortalUrl = await createPortalLink(page, proposalUrl);

    // Client declines with a reason.
    const visitor1 = await openPortalAsVisitor(browser, oldPortalUrl, clientEmail);
    await visitor1.page.getByRole("button", { name: "Decline" }).click();
    await visitor1.page.getByLabel("Reason (optional)").fill("Timing isn't right");
    visitor1.page.once("dialog", (dialog) => dialog.accept());
    await visitor1.page.getByRole("button", { name: "Decline proposal" }).click();
    await expect(visitor1.page.getByRole("heading", { name: "Proposal declined" })).toBeVisible({ timeout: 15_000 });
    await visitor1.context.close();

    // Contractor sees the declined reason and the revision card.
    await page.goto(proposalUrl);
    await expect(page.locator(".badge").filter({ hasText: "declined" }).first()).toBeVisible();
    // Both the pre-existing "Client response" card (Phase 3B) and the new
    // revision card (Phase 3B.1) mention the reason -- .first() confirms
    // presence without asserting which card it came from; the regex below
    // is specific enough to uniquely identify the revision card's own copy.
    await expect(page.getByText("Reason: Timing isn't right").first()).toBeVisible();
    await expect(page.getByText(/This proposal was declined\. Reason: Timing isn't right\./)).toBeVisible();

    // Editing directly is blocked -- no "Continue editing" button while responded to.
    await expect(page.getByRole("link", { name: "Continue editing" })).toHaveCount(0);

    // Version history shows exactly one (locked/superseded-to-be) version so far.
    await expect(page.getByText("Version history")).toHaveCount(0); // fewer than 2 versions -- panel hides itself

    await page.getByRole("button", { name: "Create revised version" }).click();
    await page.waitForURL(/\/edit\?step=scope$/);

    // The new draft version is editable -- no locked banner, real form fields.
    await expect(page.getByText("This version is locked because the client already responded.")).toHaveCount(0);
    const summaryField = page.getByLabel("Short summary");
    await expect(summaryField).toHaveValue("Original scope summary");
    await summaryField.fill("Revised scope summary after decline");
    await page.getByRole("button", { name: "Save and continue" }).click();

    await page.goto(proposalUrl);
    await expect(page.locator(".badge").filter({ hasText: "draft" }).first()).toBeVisible();
    await expect(page.getByText("Revision in progress")).toBeVisible();

    // Version history now shows both versions, the old one's declined response, and no response yet on the new one.
    await expect(page.getByText("Version history")).toBeVisible();
    await expect(page.getByText("Version 2 (current)")).toBeVisible();
    await expect(page.getByText("Version 1")).toBeVisible();

    await page.getByRole("button", { name: "Mark ready" }).click();
    await expect(page.locator(".badge").filter({ hasText: "ready" }).first()).toBeVisible({ timeout: 30_000 });

    const newPortalUrl = await createPortalLink(page, proposalUrl);
    expect(newPortalUrl).not.toBe(oldPortalUrl);

    // The OLD link still resolves to the OLD, declined version -- never the new draft/ready content.
    const oldVisitor = await openPortalAsVisitor(browser, oldPortalUrl, clientEmail);
    await expect(oldVisitor.page.getByRole("heading", { name: "Proposal declined" })).toBeVisible();
    await oldVisitor.context.close();

    // The NEW link shows the NEW (not yet responded) version, ready for a fresh decision.
    const newVisitor = await openPortalAsVisitor(browser, newPortalUrl, clientEmail);
    await expect(newVisitor.page.getByRole("heading", { name: "Ready to move forward?" })).toBeVisible();
    await newVisitor.context.close();
  });

  test("accepted proposals require an explicit confirmation before creating a revision", async ({ page, browser }) => {
    test.setTimeout(60_000);
    const suffix = uniqueSuffix();
    const { proposalUrl, clientEmail } = await createReadyProposal(page, suffix);
    const portalUrl = await createPortalLink(page, proposalUrl);

    const visitor = await openPortalAsVisitor(browser, portalUrl, clientEmail);
    await visitor.page.getByRole("button", { name: "Accept proposal" }).first().click();
    await visitor.page.getByLabel("Your name").fill("Jane Client");
    await visitor.page.getByRole("checkbox").check();
    visitor.page.once("dialog", (dialog) => dialog.accept());
    await visitor.page.getByRole("button", { name: "Accept proposal" }).last().click();
    await expect(visitor.page.getByRole("heading", { name: "Proposal accepted" })).toBeVisible({ timeout: 15_000 });
    await visitor.context.close();

    await page.goto(proposalUrl);
    await expect(page.getByText("This proposal has already been accepted. To make changes, create a new revision.")).toBeVisible();

    // Dismissing the confirm dialog must NOT create a revision.
    page.once("dialog", (dialog) => dialog.dismiss());
    await page.getByRole("button", { name: "Create new revision" }).click();
    await expect(page.locator(".badge").filter({ hasText: "accepted" }).first()).toBeVisible();

    // Accepting the confirm dialog does.
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Create new revision" }).click();
    await page.waitForURL(/\/edit\?step=scope$/);
  });
});
