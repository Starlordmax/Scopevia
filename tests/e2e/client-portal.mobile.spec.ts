import { test, expect } from "@playwright/test";
import { authFile, uniqueSuffix } from "./fixtures/session";
import { getCapturedPortalOtpCode } from "./fixtures/portal";

/**
 * Runs only under the "mobile" Playwright project (390x844 — see
 * playwright.config.ts). Covers the full client-facing portal flow (request
 * code, verify, view proposal) with explicit no-horizontal-overflow checks
 * at every page — the contractor-side setup (create the link) uses the
 * default mobile-viewport `page` fixture; the visitor side uses its own
 * fresh, unauthenticated context with the SAME viewport explicitly passed,
 * since a manually created browser context does not inherit the project's
 * device/viewport configuration.
 */
const MOBILE_VIEWPORT = { width: 390, height: 844 };

test.use({ storageState: authFile("owner-a") });

test.describe("Client portal (mobile, 390x844)", () => {
  test("request code, verify, view proposal, no horizontal overflow at any step", async ({ page, browser }) => {
    test.setTimeout(60_000);
    const suffix = uniqueSuffix();
    const clientName = `E2E Mobile Portal Client ${suffix}`;
    const clientEmail = `mobile-portal-client-${suffix}@example.com`;

    await page.goto("/clients/new");
    await page.getByLabel("Client type").selectOption("individual");
    await page.getByLabel("Display name").fill(clientName);
    await page.getByLabel("Email").fill(clientEmail);
    await page.getByRole("button", { name: "Create client" }).click();
    await page.waitForURL(/\/clients\/[0-9a-f-]+$/);

    await page.goto("/proposals/new");
    await page.getByLabel("Client", { exact: true }).selectOption({ label: clientName });
    await page.waitForURL(/clientId=/);
    await page.getByLabel("Proposal title").fill(`E2E Mobile Portal Proposal ${suffix}`);
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
    await expect(visitorPage.getByRole("heading", { name: "Secure client portal" })).toBeVisible();
    await assertNoHorizontalOverflow();

    await visitorPage.getByLabel("Email").fill(clientEmail);
    await visitorPage.getByRole("button", { name: "Send access code" }).click();
    await visitorPage.waitForURL(/\/verify\?email=/);
    await assertNoHorizontalOverflow();

    const code = await getCapturedPortalOtpCode(clientEmail);
    await visitorPage.getByLabel("Access code").fill(code);
    await visitorPage.getByRole("button", { name: "View proposal" }).click();
    await visitorPage.waitForURL(/\/view$/);

    await expect(visitorPage.getByText(`E2E Mobile Portal Proposal ${suffix}`)).toBeVisible();
    await assertNoHorizontalOverflow();

    await visitorContext.close();
  });
});
