import { test, expect } from "@playwright/test";
import { authFile, uniqueSuffix } from "./fixtures/session";
import { getCapturedPortalOtpCode } from "./fixtures/portal";

/**
 * Runs only under the "mobile" Playwright project (390x844 — see
 * playwright.config.ts).
 */
const MOBILE_VIEWPORT = { width: 390, height: 844 };
const LOGO_FILE = require.resolve("./fixtures/one-pixel.png");

test.use({ storageState: authFile("owner-a") });

test.describe("Business branding (mobile, 390x844)", () => {
  test("Profile upload UI is usable and the portal view shows the logo with no horizontal overflow", async ({ page, browser }) => {
    test.setTimeout(60_000);
    const suffix = uniqueSuffix();

    await page.goto("/profile");
    await expect(page.getByText("Business branding")).toBeVisible();

    await page.getByLabel(/Upload logo|Replace logo/).setInputFiles(LOGO_FILE);
    // A file input's implicit ARIA role is also "button" in Chromium, so
    // .and(locator("button")) narrows to the real <button type=submit>.
    const uploadButton = page.getByRole("button", { name: /Upload logo|Replace logo/ }).and(page.locator("button"));
    await expect(uploadButton).toBeVisible();
    await uploadButton.click();
    await expect(page.locator(".form-card").filter({ hasText: "Business branding" }).locator("img.photo-thumb")).toBeVisible({
      timeout: 15_000,
    });

    let scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(MOBILE_VIEWPORT.width + 1);

    const clientName = `E2E Mobile Branding Client ${suffix}`;
    const clientEmail = `mobile-branding-client-${suffix}@example.com`;
    await page.goto("/clients/new");
    await page.getByLabel("Client type").selectOption("individual");
    await page.getByLabel("Display name").fill(clientName);
    await page.getByLabel("Email").fill(clientEmail);
    await page.getByRole("button", { name: "Create client" }).click();
    await page.waitForURL(/\/clients\/[0-9a-f-]+$/);

    await page.goto("/proposals/new");
    await page.getByLabel("Client", { exact: true }).selectOption({ label: clientName });
    await page.waitForURL(/clientId=/);
    await page.getByLabel("Proposal title").fill(`E2E Mobile Branding Proposal ${suffix}`);
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

    const visitorContext = await browser.newContext({ viewport: MOBILE_VIEWPORT });
    const visitorPage = await visitorContext.newPage();
    await visitorPage.goto(portalUrl);
    await visitorPage.getByLabel("Email").fill(clientEmail);
    await visitorPage.getByRole("button", { name: "Send access code" }).click();
    await visitorPage.waitForURL(/\/verify\?email=/);
    const code = await getCapturedPortalOtpCode(clientEmail);
    await visitorPage.getByLabel("Access code").fill(code);
    await visitorPage.getByRole("button", { name: "View proposal" }).click();
    await visitorPage.waitForURL(/\/view$/);

    await expect(visitorPage.locator(".proposal-document-logo")).toBeVisible();
    scrollWidth = await visitorPage.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(MOBILE_VIEWPORT.width + 1);

    await visitorContext.close();
  });
});
