import { test, expect } from "@playwright/test";
import { authFile, uniqueSuffix } from "./fixtures/session";
import { getCapturedPortalOtpCode } from "./fixtures/portal";

/**
 * Runs only under the "mobile" Playwright project (390x844 — see
 * playwright.config.ts).
 */
const MOBILE_VIEWPORT = { width: 390, height: 844 };

test.use({ storageState: authFile("owner-a") });

test.describe("Proposal export (mobile, 390x844)", () => {
  test("the portal export button is visible and the export view has no horizontal overflow", async ({ page, browser }) => {
    test.setTimeout(60_000);
    const suffix = uniqueSuffix();
    const clientName = `E2E Mobile Export Client ${suffix}`;
    const clientEmail = `mobile-export-client-${suffix}@example.com`;

    await page.goto("/clients/new");
    await page.getByLabel("Client type").selectOption("individual");
    await page.getByLabel("Display name").fill(clientName);
    await page.getByLabel("Email").fill(clientEmail);
    await page.getByRole("button", { name: "Create client" }).click();
    await page.waitForURL(/\/clients\/[0-9a-f-]+$/);

    await page.goto("/proposals/new");
    await page.getByLabel("Client").selectOption({ label: clientName });
    await page.waitForURL(/clientId=/);
    await page.getByLabel("Proposal title").fill(`E2E Mobile Export Proposal ${suffix}`);
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

    async function assertNoHorizontalOverflow() {
      const scrollWidth = await visitorPage.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth).toBeLessThanOrEqual(MOBILE_VIEWPORT.width + 1);
    }

    await visitorPage.goto(portalUrl);
    await visitorPage.getByLabel("Email").fill(clientEmail);
    await visitorPage.getByRole("button", { name: "Send access code" }).click();
    await visitorPage.waitForURL(/\/verify\?email=/);

    const code = await getCapturedPortalOtpCode(clientEmail);
    await visitorPage.getByLabel("Access code").fill(code);
    await visitorPage.getByRole("button", { name: "View proposal" }).click();
    await visitorPage.waitForURL(/\/view$/);
    await assertNoHorizontalOverflow();

    const printLink = visitorPage.getByRole("link", { name: "Print / Save as PDF" });
    await expect(printLink).toBeVisible();
    await printLink.click();
    await visitorPage.waitForURL(/\/print$/);
    await assertNoHorizontalOverflow();

    await expect(visitorPage.getByText(`E2E Mobile Export Proposal ${suffix}`)).toBeVisible();

    await visitorContext.close();
  });

  test("contractor export view has no horizontal overflow on mobile", async ({ page }) => {
    test.setTimeout(60_000);
    const suffix = uniqueSuffix();
    const clientName = `E2E Mobile Contractor Export ${suffix}`;
    const clientEmail = `mobile-contractor-export-${suffix}@example.com`;

    await page.goto("/clients/new");
    await page.getByLabel("Client type").selectOption("individual");
    await page.getByLabel("Display name").fill(clientName);
    await page.getByLabel("Email").fill(clientEmail);
    await page.getByRole("button", { name: "Create client" }).click();
    await page.waitForURL(/\/clients\/[0-9a-f-]+$/);

    await page.goto("/proposals/new");
    await page.getByLabel("Client").selectOption({ label: clientName });
    await page.waitForURL(/clientId=/);
    await page.getByLabel("Proposal title").fill(`E2E Mobile Contractor Export Proposal ${suffix}`);
    await page.getByLabel("Service type").selectOption("custom");
    await page.getByLabel("Custom service name").fill("Custom test service");
    await page.getByRole("button", { name: "Save and continue" }).click();
    await page.waitForURL(/\/proposals\/[0-9a-f-]+\/edit\?step=measurements/);
    const proposalUrl = page.url().replace(/\/edit\?step=measurements$/, "");

    async function assertNoHorizontalOverflow() {
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth).toBeLessThanOrEqual(MOBILE_VIEWPORT.width + 1);
    }

    await page.goto(`${proposalUrl}/print`);
    await assertNoHorizontalOverflow();
    await expect(page.getByRole("button", { name: "Print / Save as PDF" })).toBeVisible();
  });
});
