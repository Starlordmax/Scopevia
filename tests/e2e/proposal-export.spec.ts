import { test, expect, type Page } from "@playwright/test";
import { authFile, uniqueSuffix } from "./fixtures/session";
import { getCapturedPortalOtpCode } from "./fixtures/portal";

test.use({ storageState: authFile("owner-a") });

const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;

async function assertNoUuidVisible(page: Page) {
  const text = await page.locator("body").innerText();
  expect(text).not.toMatch(UUID_RE);
}

async function createReadyProposal(page: Page, suffix: string): Promise<{ proposalUrl: string; clientEmail: string; clientName: string }> {
  const clientName = `E2E Export Client ${suffix}`;
  const clientEmail = `export-client-${suffix}@example.com`;

  await page.goto("/clients/new");
  await page.getByLabel("Client type").selectOption("individual");
  await page.getByLabel("Display name").fill(clientName);
  await page.getByLabel("Email").fill(clientEmail);
  await page.getByRole("button", { name: "Create client" }).click();
  await page.waitForURL(/\/clients\/[0-9a-f-]+$/);

  await page.goto("/proposals/new");
  await page.getByLabel("Client").selectOption({ label: clientName });
  await page.waitForURL(/clientId=/);
  await page.getByLabel("Proposal title").fill(`E2E Export Proposal ${suffix}`);
  await page.getByLabel("Service type").selectOption("custom");
  await page.getByRole("button", { name: "Save and continue" }).click();
  await page.waitForURL(/\/proposals\/[0-9a-f-]+\/edit\?step=measurements/);
  const proposalUrl = page.url().replace(/\/edit\?step=measurements$/, "");

  await page.goto(`${proposalUrl}/edit?step=scope`);
  await page.getByLabel("Short summary").fill("Full interior repaint");
  await page.getByRole("button", { name: "Save and continue" }).click();

  await page.goto(proposalUrl);
  await page.getByRole("button", { name: "Mark ready" }).click();
  await expect(page.locator(".badge").filter({ hasText: "ready" })).toBeVisible({ timeout: 30_000 });

  return { proposalUrl, clientEmail, clientName };
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

test.describe("Contractor proposal export", () => {
  test("opens a clean, control-free printable document with the right content", async ({ page }) => {
    test.setTimeout(60_000);
    const suffix = uniqueSuffix();
    const { proposalUrl, clientName } = await createReadyProposal(page, suffix);

    await page.goto(proposalUrl);
    await page.getByRole("link", { name: "Print / Save as PDF" }).click();
    await page.waitForURL(/\/print$/);

    await expect(page.getByText(`E2E Export Proposal ${suffix}`)).toBeVisible();
    await expect(page.getByText(clientName)).toBeVisible();
    await expect(page.getByText("Full interior repaint")).toBeVisible();
    await expect(page.getByText("Total").first()).toBeVisible();

    // No edit/portal controls leak into the export view.
    await expect(page.getByRole("link", { name: "Continue editing" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Mark ready" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Create client portal link" })).toHaveCount(0);

    // No internal UUIDs rendered anywhere on the page.
    await assertNoUuidVisible(page);

    // The print button itself is present (and will be hidden by print CSS, not by absence from the DOM).
    await expect(page.getByRole("button", { name: "Print / Save as PDF" })).toBeVisible();
  });

  test("the Version History table can print a specific historical version", async ({ page, browser }) => {
    test.setTimeout(90_000);
    const suffix = uniqueSuffix();
    const { proposalUrl, clientEmail } = await createReadyProposal(page, suffix);
    const portalUrl = await createPortalLink(page, proposalUrl);

    const visitor = await openPortalAsVisitor(browser, portalUrl, clientEmail);
    await visitor.page.getByRole("button", { name: "Decline" }).click();
    visitor.page.once("dialog", (dialog) => dialog.accept());
    await visitor.page.getByRole("button", { name: "Decline proposal" }).click();
    await expect(visitor.page.getByRole("heading", { name: "Proposal declined" })).toBeVisible({ timeout: 15_000 });
    await visitor.context.close();

    await page.goto(proposalUrl);
    await page.getByRole("button", { name: "Create revised version" }).click();
    await page.waitForURL(/\/edit\?step=scope$/);

    await page.goto(proposalUrl);
    await expect(page.getByText("Version 1")).toBeVisible();
    const version1Row = page.locator("tr", { hasText: "Version 1" });
    await version1Row.getByRole("link", { name: "Print" }).click();
    await page.waitForURL(/\/print\?version=/);

    // The historical version's export shows its own recorded response.
    await expect(page.getByText("Declined").first()).toBeVisible();
  });
});

test.describe("Client Portal export", () => {
  test("client can export before and after responding; the response appears once recorded", async ({ page, browser }) => {
    test.setTimeout(90_000);
    const suffix = uniqueSuffix();
    const { proposalUrl, clientEmail } = await createReadyProposal(page, suffix);
    const portalUrl = await createPortalLink(page, proposalUrl);

    const visitor = await openPortalAsVisitor(browser, portalUrl, clientEmail);

    await visitor.page.getByRole("link", { name: "Print / Save as PDF" }).click();
    await visitor.page.waitForURL(/\/print$/);
    await expect(visitor.page.getByText(`E2E Export Proposal ${suffix}`)).toBeVisible();
    await expect(visitor.page.getByText("Client response")).toHaveCount(0);
    await assertNoUuidVisible(visitor.page);

    await visitor.page.getByRole("link", { name: "Back" }).click();
    await visitor.page.waitForURL(/\/view$/);
    await visitor.page.getByRole("button", { name: "Accept proposal" }).first().click();
    await visitor.page.getByLabel("Your name").fill("Jane Client");
    await visitor.page.getByRole("checkbox").check();
    visitor.page.once("dialog", (dialog) => dialog.accept());
    await visitor.page.getByRole("button", { name: "Accept proposal" }).last().click();
    await expect(visitor.page.getByRole("heading", { name: "Proposal accepted" })).toBeVisible({ timeout: 15_000 });

    await visitor.page.getByRole("link", { name: "Print / Save as PDF" }).click();
    await visitor.page.waitForURL(/\/print$/);
    await expect(visitor.page.getByText("Client response")).toBeVisible();
    await expect(visitor.page.getByText(/Accepted.*Jane Client/s)).toBeVisible();
    await assertNoUuidVisible(visitor.page);

    await visitor.context.close();
  });
});

test.describe("Proposal export — revision safety", () => {
  test("old portal link exports the old version; new portal link exports the new version", async ({ page, browser }) => {
    test.setTimeout(120_000);
    const suffix = uniqueSuffix();
    const { proposalUrl, clientEmail } = await createReadyProposal(page, suffix);
    const oldPortalUrl = await createPortalLink(page, proposalUrl);

    const oldVisitor = await openPortalAsVisitor(browser, oldPortalUrl, clientEmail);
    await oldVisitor.page.getByRole("button", { name: "Decline" }).click();
    await oldVisitor.page.getByLabel("Reason (optional)").fill("Need lower price");
    oldVisitor.page.once("dialog", (dialog) => dialog.accept());
    await oldVisitor.page.getByRole("button", { name: "Decline proposal" }).click();
    await expect(oldVisitor.page.getByRole("heading", { name: "Proposal declined" })).toBeVisible({ timeout: 15_000 });

    await page.goto(proposalUrl);
    await page.getByRole("button", { name: "Create revised version" }).click();
    await page.waitForURL(/\/edit\?step=scope$/);
    await page.getByLabel("Short summary").fill("Revised: lower-cost scope");
    await page.getByRole("button", { name: "Save and continue" }).click();

    await page.goto(proposalUrl);
    await page.getByRole("button", { name: "Mark ready" }).click();
    await expect(page.locator(".badge").filter({ hasText: "ready" }).first()).toBeVisible({ timeout: 30_000 });
    const newPortalUrl = await createPortalLink(page, proposalUrl);

    // Old link's export still shows the OLD declined content -- never the revision.
    await oldVisitor.page.getByRole("link", { name: "Print / Save as PDF" }).click();
    await oldVisitor.page.waitForURL(/\/print$/);
    await expect(oldVisitor.page.getByText("Declined").first()).toBeVisible();
    await expect(oldVisitor.page.getByText("Revised: lower-cost scope")).toHaveCount(0);
    await oldVisitor.context.close();

    // New link's export shows the NEW revised content, no response yet.
    const newVisitor = await openPortalAsVisitor(browser, newPortalUrl, clientEmail);
    await newVisitor.page.getByRole("link", { name: "Print / Save as PDF" }).click();
    await newVisitor.page.waitForURL(/\/print$/);
    await expect(newVisitor.page.getByText("Revised: lower-cost scope")).toBeVisible();
    await expect(newVisitor.page.getByText("Client response")).toHaveCount(0);
    await newVisitor.context.close();
  });
});
