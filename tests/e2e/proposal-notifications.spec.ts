import { test, expect, type Page } from "@playwright/test";
import { authFile, getManifest, uniqueSuffix } from "./fixtures/session";
import { getCapturedPortalOtpCode } from "./fixtures/portal";
import { getCapturedNotification, getAllCapturedNotifications } from "./fixtures/notifications";

test.use({ storageState: authFile("owner-a") });

async function createReadyProposal(page: Page, suffix: string): Promise<{ proposalUrl: string; clientEmail: string }> {
  const clientName = `E2E Notify Client ${suffix}`;
  const clientEmail = `notify-client-${suffix}@example.com`;

  await page.goto("/clients/new");
  await page.getByLabel("Client type").selectOption("individual");
  await page.getByLabel("Display name").fill(clientName);
  await page.getByLabel("Email").fill(clientEmail);
  await page.getByRole("button", { name: "Create client" }).click();
  await page.waitForURL(/\/clients\/[0-9a-f-]+$/);

  await page.goto("/proposals/new");
  await page.getByLabel("Client").selectOption({ label: clientName });
  await page.waitForURL(/clientId=/);
  await page.getByLabel("Proposal title").fill(`E2E Notify Proposal ${suffix}`);
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

async function openPortalAsVisitor(browser: import("@playwright/test").Browser, portalUrl: string, clientEmail: string) {
  const context = await browser.newContext();
  const visitorPage = await context.newPage();
  await visitorPage.goto(portalUrl);
  await visitorPage.getByLabel("Email").fill(clientEmail);
  await visitorPage.getByRole("button", { name: "Send access code" }).click();
  await visitorPage.waitForURL(/\/verify\?email=/);

  const code = await getCapturedPortalOtpCode(clientEmail);
  await visitorPage.getByLabel("Access code").fill(code);
  await visitorPage.getByRole("button", { name: "View proposal" }).click();
  await visitorPage.waitForURL(/\/view$/);

  return { context, page: visitorPage };
}

test.describe("Proposal viewed notification", () => {
  test("the contractor team is notified on the client's first view, and a reload does not spam a second email", async ({ page, browser }) => {
    test.setTimeout(60_000);
    const suffix = uniqueSuffix();
    const { proposalUrl, clientEmail } = await createReadyProposal(page, suffix);
    const portalUrl = await createPortalLink(page, proposalUrl);
    const ownerEmail = getManifest().users.ownerA.email;

    const visitor = await openPortalAsVisitor(browser, portalUrl, clientEmail);

    // ownerA's email is shared across every test in this file (and the
    // mobile spec) -- matching on the full subject, which embeds this
    // test's own unique proposal title, is what keeps this assertion
    // correct when several such tests run in parallel against the same
    // recipient's append-only capture file.
    const subject = `Proposal viewed: E2E Notify Proposal ${suffix}`;
    const notification = await getCapturedNotification(ownerEmail, subject);
    expect(notification.text).toContain(clientEmail);
    expect(notification.text).toContain(`E2E Notify Proposal ${suffix}`);

    // A reload of the SAME session must not send a second "viewed" email.
    await visitor.page.reload();
    await visitor.page.waitForLoadState("networkidle");
    const all = await getAllCapturedNotifications(ownerEmail);
    const viewedCount = all.filter((n) => n.subject === subject).length;
    expect(viewedCount).toBe(1);

    await visitor.context.close();
  });
});

test.describe("Proposal accepted notification", () => {
  test("the contractor team and the client both receive a notification when the proposal is accepted", async ({ page, browser }) => {
    test.setTimeout(60_000);
    const suffix = uniqueSuffix();
    const { proposalUrl, clientEmail } = await createReadyProposal(page, suffix);
    const portalUrl = await createPortalLink(page, proposalUrl);
    const ownerEmail = getManifest().users.ownerA.email;

    const visitor = await openPortalAsVisitor(browser, portalUrl, clientEmail);
    await visitor.page.getByRole("button", { name: "Accept proposal" }).first().click();
    await visitor.page.getByLabel("Your name").fill("Jane Client");
    await visitor.page.getByRole("checkbox").check();
    visitor.page.once("dialog", (dialog) => dialog.accept());
    await visitor.page.getByRole("button", { name: "Accept proposal" }).last().click();
    await expect(visitor.page.getByRole("heading", { name: "Proposal accepted" })).toBeVisible({ timeout: 15_000 });
    await visitor.context.close();

    // ownerA's email is shared across every notification test -- matching
    // on the full subject (which embeds this test's own unique proposal
    // title) avoids picking up a different, concurrently-running test's
    // notification to the same recipient.
    const teamNotification = await getCapturedNotification(ownerEmail, `Proposal accepted: E2E Notify Proposal ${suffix}`);
    expect(teamNotification.text).toContain("Jane Client");
    expect(teamNotification.text).toContain(clientEmail);

    const clientConfirmation = await getCapturedNotification(clientEmail, "Proposal accepted");
    expect(clientConfirmation.text).toContain(`E2E Notify Proposal ${suffix}`);
    expect(clientConfirmation.text).not.toMatch(/e-signature|legally binding/i);

    await page.goto(proposalUrl);
    await expect(page.locator(".badge").filter({ hasText: "accepted" }).first()).toBeVisible();
  });
});

test.describe("Proposal declined notification", () => {
  test("the contractor team is notified with the decline reason", async ({ page, browser }) => {
    test.setTimeout(60_000);
    const suffix = uniqueSuffix();
    const { proposalUrl, clientEmail } = await createReadyProposal(page, suffix);
    const portalUrl = await createPortalLink(page, proposalUrl);
    const ownerEmail = getManifest().users.ownerA.email;

    const visitor = await openPortalAsVisitor(browser, portalUrl, clientEmail);
    await visitor.page.getByRole("button", { name: "Decline" }).click();
    await visitor.page.getByLabel("Reason (optional)").fill("Chose another contractor");
    visitor.page.once("dialog", (dialog) => dialog.accept());
    await visitor.page.getByRole("button", { name: "Decline proposal" }).click();
    await expect(visitor.page.getByRole("heading", { name: "Proposal declined" })).toBeVisible({ timeout: 15_000 });
    await visitor.context.close();

    // Same reasoning as the accepted test above: match the full subject,
    // not just the "Proposal declined" prefix, since ownerA's email is
    // shared across concurrently-running tests.
    const teamNotification = await getCapturedNotification(ownerEmail, `Proposal declined: E2E Notify Proposal ${suffix}`);
    expect(teamNotification.text).toContain("Chose another contractor");
    expect(teamNotification.text).toContain(clientEmail);
    expect(teamNotification.text).toMatch(/revised version/i);

    const clientConfirmation = await getCapturedNotification(clientEmail, "We received your response");
    expect(clientConfirmation.text).toContain(`E2E Notify Proposal ${suffix}`);

    await page.goto(proposalUrl);
    await expect(page.locator(".badge").filter({ hasText: "declined" }).first()).toBeVisible();
  });
});
