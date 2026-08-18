import { test, expect, type Page } from "@playwright/test";
import { authFile, uniqueSuffix } from "./fixtures/session";
import { getCapturedPortalOtpCode, hasNoCapturedPortalOtpCode } from "./fixtures/portal";

test.use({ storageState: authFile("owner-a") });

/** Creates a client (with an email) + a direct proposal, marks it ready, and returns the detail page URL. */
async function createReadyProposal(page: Page, suffix: string): Promise<{ proposalUrl: string; clientEmail: string }> {
  const clientName = `E2E Portal Client ${suffix}`;
  const clientEmail = `portal-client-${suffix}@example.com`;

  await page.goto("/clients/new");
  await page.getByLabel("Client type").selectOption("individual");
  await page.getByLabel("Display name").fill(clientName);
  await page.getByLabel("Email").fill(clientEmail);
  await page.getByRole("button", { name: "Create client" }).click();
  await page.waitForURL(/\/clients\/[0-9a-f-]+$/);

  await page.goto("/proposals/new");
  await page.getByLabel("Client", { exact: true }).selectOption({ label: clientName });
  await page.waitForURL(/clientId=/);
  await page.getByLabel("Proposal title").fill(`E2E Portal Proposal ${suffix}`);
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

test.describe("Client portal — contractor side", () => {
  test("creating a link shows the URL once, adds it to the list, and it can be revoked", async ({ page }) => {
    const suffix = uniqueSuffix();
    const { proposalUrl } = await createReadyProposal(page, suffix);

    const portalUrl = await createPortalLink(page, proposalUrl);
    expect(portalUrl).toMatch(/\/p\/[A-Za-z0-9_-]{20,}$/);

    // The link now shows in the table with an "Active" status and a Revoke button.
    await expect(page.locator(".badge").filter({ hasText: "active" })).toBeVisible();
    await expect(page.getByText("Not yet viewed")).toBeVisible();

    // This suite always runs with EMAIL_PROVIDER unset (dev capture) --
    // the contractor-only dev-mode notice must be visible here...
    await expect(page.getByText("Email provider is in development mode. Codes are captured locally for testing.")).toBeVisible();

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Revoke" }).click();
    await expect(page.locator(".badge").filter({ hasText: "revoked" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: "Revoke" })).toHaveCount(0);
  });

  test("a draft (not-yet-ready) proposal shows a hint instead of a create-link button", async ({ page }) => {
    const suffix = uniqueSuffix();
    const clientName = `E2E Portal Draft Client ${suffix}`;
    await page.goto("/clients/new");
    await page.getByLabel("Display name").fill(clientName);
    await page.getByRole("button", { name: "Create client" }).click();
    await page.waitForURL(/\/clients\/[0-9a-f-]+$/);

    await page.goto("/proposals/new");
    await page.getByLabel("Client", { exact: true }).selectOption({ label: clientName });
    await page.waitForURL(/clientId=/);
    await page.getByLabel("Proposal title").fill(`E2E Portal Draft Proposal ${suffix}`);
    await page.getByLabel("Service type").selectOption("custom");
    await page.getByLabel("Custom service name").fill("Custom test service");
    await page.getByRole("button", { name: "Save and continue" }).click();
    await page.waitForURL(/\/proposals\/[0-9a-f-]+\/edit\?step=measurements/);
    const proposalUrl = page.url().replace(/\/edit\?step=measurements$/, "");

    await page.goto(proposalUrl);
    await expect(page.getByText("Mark this proposal ready to create a client portal link.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Create client portal link" })).toHaveCount(0);
  });
});

test.describe("Client portal — visitor side", () => {
  test("full happy path: request code, verify, view proposal, and the contractor sees Last viewed update", async ({ page, browser }) => {
    test.setTimeout(60_000);
    const suffix = uniqueSuffix();
    const { proposalUrl, clientEmail } = await createReadyProposal(page, suffix);
    const portalUrl = await createPortalLink(page, proposalUrl);

    const visitorContext = await browser.newContext();
    const visitorPage = await visitorContext.newPage();

    await visitorPage.goto(portalUrl);
    await expect(visitorPage.getByRole("heading", { name: "Secure client portal" })).toBeVisible();
    await expect(visitorPage.getByText("This proposal is private and can only be viewed by authorized recipients.")).toBeVisible();
    // The dev-mode notice is contractor-only -- never shown on the public portal.
    await expect(visitorPage.getByText("Email provider is in development mode")).toHaveCount(0);
    await visitorPage.getByLabel("Email").fill(clientEmail);
    await visitorPage.getByRole("button", { name: "Send access code" }).click();
    await visitorPage.waitForURL(/\/verify\?email=/);

    const code = await getCapturedPortalOtpCode(clientEmail);
    await visitorPage.getByLabel("Access code").fill(code);
    await visitorPage.getByRole("button", { name: "View proposal" }).click();
    await visitorPage.waitForURL(/\/view$/);

    await expect(visitorPage.getByText(`E2E Portal Proposal ${suffix}`)).toBeVisible();
    await expect(visitorPage.getByText("Prepared for")).toBeVisible();
    await expect(visitorPage.locator(".pricing-summary")).toBeVisible();
    await visitorContext.close();

    // Contractor side: "Last viewed" should now show a real timestamp.
    await page.goto(proposalUrl);
    await expect(page.getByText("Not yet viewed")).toHaveCount(0);
  });

  test("an invalid token shows a friendly 'not available' message", async ({ page }) => {
    await page.goto("/p/this-token-does-not-exist-at-all-0000000000000");
    await expect(page.getByRole("heading", { name: "Link not available" })).toBeVisible();
    await expect(page.getByText("We couldn't find that link.")).toBeVisible();
  });

  test("a revoked link blocks portal access", async ({ page, browser }) => {
    const suffix = uniqueSuffix();
    const { proposalUrl } = await createReadyProposal(page, suffix);
    const portalUrl = await createPortalLink(page, proposalUrl);

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Revoke" }).click();
    await expect(page.locator(".badge").filter({ hasText: "revoked" })).toBeVisible({ timeout: 15_000 });

    const visitorContext = await browser.newContext();
    const visitorPage = await visitorContext.newPage();
    await visitorPage.goto(portalUrl);
    await expect(visitorPage.getByRole("heading", { name: "Link not available" })).toBeVisible();
    await expect(visitorPage.getByText("This link has been revoked.")).toBeVisible();
    await visitorContext.close();
  });

  test("an archived proposal's link blocks portal access", async ({ page, browser }) => {
    const suffix = uniqueSuffix();
    const { proposalUrl } = await createReadyProposal(page, suffix);
    const portalUrl = await createPortalLink(page, proposalUrl);

    await page.goto(proposalUrl);
    await page.getByText("Danger zone").click();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Delete proposal" }).click();
    await expect
      .poll(
        async () => {
          await page.reload();
          return page.locator(".badge").filter({ hasText: "archived" }).count();
        },
        { timeout: 30_000 }
      )
      .toBeGreaterThan(0);

    const visitorContext = await browser.newContext();
    const visitorPage = await visitorContext.newPage();
    await visitorPage.goto(portalUrl);
    await expect(visitorPage.getByRole("heading", { name: "Link not available" })).toBeVisible();
    await expect(visitorPage.getByText("This proposal is no longer available to view.")).toBeVisible();
    await visitorContext.close();
  });

  test("a wrong code shows an error and does not grant access", async ({ page, browser }) => {
    const suffix = uniqueSuffix();
    const { proposalUrl, clientEmail } = await createReadyProposal(page, suffix);
    const portalUrl = await createPortalLink(page, proposalUrl);

    const visitorContext = await browser.newContext();
    const visitorPage = await visitorContext.newPage();
    await visitorPage.goto(portalUrl);
    await visitorPage.getByLabel("Email").fill(clientEmail);
    await visitorPage.getByRole("button", { name: "Send access code" }).click();
    await visitorPage.waitForURL(/\/verify\?email=/);

    await visitorPage.getByLabel("Access code").fill("000000");
    await visitorPage.getByRole("button", { name: "View proposal" }).click();
    await expect(visitorPage.getByText("That code is incorrect. Please try again.")).toBeVisible();
    await expect(visitorPage).toHaveURL(/\/verify/);
    await visitorContext.close();
  });

  test("too many wrong attempts locks out the code", async ({ page, browser }) => {
    test.setTimeout(60_000);
    const suffix = uniqueSuffix();
    const { proposalUrl, clientEmail } = await createReadyProposal(page, suffix);
    const portalUrl = await createPortalLink(page, proposalUrl);

    const visitorContext = await browser.newContext();
    const visitorPage = await visitorContext.newPage();
    await visitorPage.goto(portalUrl);
    await visitorPage.getByLabel("Email").fill(clientEmail);
    await visitorPage.getByRole("button", { name: "Send access code" }).click();
    await visitorPage.waitForURL(/\/verify\?email=/);

    // max_attempts is 5 -- exhaust them, then confirm the 6th is locked out.
    // Each submission must wait for the actual Server Action round trip (a
    // POST response), not just for matching text to be visible -- the error
    // text is IDENTICAL between attempts, so a broad text-visibility check
    // can be satisfied by the PREVIOUS render and race ahead of the button
    // re-enabling, silently dropping alternating clicks.
    for (let i = 0; i < 5; i++) {
      await visitorPage.getByLabel("Access code").fill("000000");
      await Promise.all([
        visitorPage.waitForResponse((resp) => resp.request().method() === "POST"),
        visitorPage.getByRole("button", { name: "View proposal" }).click(),
      ]);
      await expect(visitorPage.getByText(/That code is incorrect|Too many incorrect attempts/)).toBeVisible();
    }
    await visitorPage.getByLabel("Access code").fill("000000");
    await Promise.all([
      visitorPage.waitForResponse((resp) => resp.request().method() === "POST"),
      visitorPage.getByRole("button", { name: "View proposal" }).click(),
    ]);
    await expect(visitorPage.getByText("Too many incorrect attempts. Request a new code.")).toBeVisible();
    await visitorContext.close();
  });

  test("an email that doesn't match the proposal's client shows the same generic message and never captures a code", async ({ page, browser }) => {
    const suffix = uniqueSuffix();
    const { proposalUrl } = await createReadyProposal(page, suffix);
    const portalUrl = await createPortalLink(page, proposalUrl);
    const unrelatedEmail = `not-authorized-${suffix}@example.com`;

    const visitorContext = await browser.newContext();
    const visitorPage = await visitorContext.newPage();
    await visitorPage.goto(portalUrl);
    await visitorPage.getByLabel("Email").fill(unrelatedEmail);
    await visitorPage.getByRole("button", { name: "Send access code" }).click();

    // Redirects to /verify exactly the same as a real match -- no leak.
    await visitorPage.waitForURL(/\/verify\?email=/);
    await expect(visitorPage.getByText(new RegExp(unrelatedEmail))).toBeVisible();

    expect(await hasNoCapturedPortalOtpCode(unrelatedEmail)).toBe(true);
    await visitorContext.close();
  });
});
