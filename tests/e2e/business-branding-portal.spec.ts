import { test, expect, type Page } from "@playwright/test";
import { authFile, uniqueSuffix } from "./fixtures/session";
import { getCapturedPortalOtpCode } from "./fixtures/portal";

const LOGO_FILE = require.resolve("./fixtures/one-pixel.png");

// Deliberately Tenant B (owner-b), not owner-a — the logo is a per-tenant
// SINGLETON, and business-branding.spec.ts / business-branding.mobile.spec.ts
// both mutate owner-a's tenant logo concurrently under fullyParallel
// workers. Using owner-b's own, separate tenant avoids that specific
// cross-file race entirely rather than just tolerating it.
test.use({ storageState: authFile("owner-b") });

async function createReadyProposal(page: Page, suffix: string): Promise<{ proposalUrl: string; clientEmail: string }> {
  const clientName = `E2E Branding Portal Client ${suffix}`;
  const clientEmail = `branding-portal-client-${suffix}@example.com`;

  await page.goto("/clients/new");
  await page.getByLabel("Client type").selectOption("individual");
  await page.getByLabel("Display name").fill(clientName);
  await page.getByLabel("Email").fill(clientEmail);
  await page.getByRole("button", { name: "Create client" }).click();
  await page.waitForURL(/\/clients\/[0-9a-f-]+$/);

  await page.goto("/proposals/new");
  await page.getByLabel("Client", { exact: true }).selectOption({ label: clientName });
  await page.waitForURL(/clientId=/);
  await page.getByLabel("Proposal title").fill(`E2E Branding Portal Proposal ${suffix}`);
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

test.describe("Business branding — Client Portal", () => {
  test("a logo uploaded from Profile appears on both the portal view and print routes", async ({ page, browser }) => {
    test.setTimeout(60_000);
    const suffix = uniqueSuffix();

    // Same tenant-singleton caveat as business-branding.spec.ts — this test
    // uploads its own logo rather than assuming any prior state.
    await page.goto("/profile");
    await page.getByLabel(/Upload logo|Replace logo/).setInputFiles(LOGO_FILE);
    // A file input's implicit ARIA role is also "button" in Chromium, so
    // .and(locator("button")) narrows to the real <button type=submit>.
    await page
      .getByRole("button", { name: /Upload logo|Replace logo/ })
      .and(page.locator("button"))
      .click();
    await expect(page.locator(".form-card").filter({ hasText: "Business branding" }).locator("img.photo-thumb")).toBeVisible({
      timeout: 15_000,
    });

    const { proposalUrl, clientEmail } = await createReadyProposal(page, suffix);
    const portalUrl = await createPortalLink(page, proposalUrl);

    const visitorContext = await browser.newContext();
    const visitorPage = await visitorContext.newPage();

    // The portal print route requires the same session cookie as /view — go
    // through /view first (any authenticated portal session works for both
    // routes once the visitor is verified via the OTP flow tested in
    // client-portal.spec.ts; this test focuses on branding, not re-testing
    // OTP verification).
    await visitorPage.goto(portalUrl);
    await visitorPage.getByLabel("Email").fill(clientEmail);
    await visitorPage.getByRole("button", { name: "Send access code" }).click();
    await visitorPage.waitForURL(/\/verify\?email=/);
    const code = await getCapturedPortalOtpCode(clientEmail);
    await visitorPage.getByLabel("Access code").fill(code);
    await visitorPage.getByRole("button", { name: "View proposal" }).click();
    await visitorPage.waitForURL(/\/view$/);

    await expect(visitorPage.locator(".proposal-document-logo")).toBeVisible();

    await visitorPage.goto(`${portalUrl}/print`);
    await expect(visitorPage.locator(".proposal-document-logo")).toBeVisible();

    await visitorContext.close();
  });
});
