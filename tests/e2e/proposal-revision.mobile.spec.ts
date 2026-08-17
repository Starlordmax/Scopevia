import { test, expect } from "@playwright/test";
import { authFile, uniqueSuffix } from "./fixtures/session";
import { getCapturedPortalOtpCode } from "./fixtures/portal";

/**
 * Runs only under the "mobile" Playwright project (390x844 — see
 * playwright.config.ts). The contractor's own page is already mobile
 * viewport under this project; the portal visitor gets an explicit mobile
 * context too, matching client-portal-response.mobile.spec.ts's convention.
 */
const MOBILE_VIEWPORT = { width: 390, height: 844 };

test.use({ storageState: authFile("owner-a") });

test.describe("Proposal revision flow (mobile, 390x844)", () => {
  test("contractor views a declined proposal, creates a revision, and the builder + version history render without horizontal overflow", async ({
    page,
    browser,
  }) => {
    test.setTimeout(90_000);
    const suffix = uniqueSuffix();
    const clientName = `E2E Mobile Revision Client ${suffix}`;
    const clientEmail = `mobile-revision-client-${suffix}@example.com`;

    async function assertNoHorizontalOverflow() {
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth).toBeLessThanOrEqual(MOBILE_VIEWPORT.width + 1);
    }

    await page.goto("/clients/new");
    await page.getByLabel("Client type").selectOption("individual");
    await page.getByLabel("Display name").fill(clientName);
    await page.getByLabel("Email").fill(clientEmail);
    await page.getByRole("button", { name: "Create client" }).click();
    await page.waitForURL(/\/clients\/[0-9a-f-]+$/);

    await page.goto("/proposals/new");
    await page.getByLabel("Client").selectOption({ label: clientName });
    await page.waitForURL(/clientId=/);
    await page.getByLabel("Proposal title").fill(`E2E Mobile Revision Proposal ${suffix}`);
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

    await visitorPage.getByRole("button", { name: "Decline" }).click();
    await visitorPage.getByLabel("Reason (optional)").fill("Need another quote");
    visitorPage.once("dialog", (dialog) => dialog.accept());
    await visitorPage.getByRole("button", { name: "Decline proposal" }).click();
    await expect(visitorPage.getByRole("heading", { name: "Proposal declined" })).toBeVisible({ timeout: 15_000 });
    await visitorContext.close();

    // Contractor views the declined proposal on mobile.
    await page.goto(proposalUrl);
    await assertNoHorizontalOverflow();
    await expect(page.getByText(/This proposal was declined\. Reason: Need another quote\./)).toBeVisible();

    await page.getByRole("button", { name: "Create revised version" }).click();
    await page.waitForURL(/\/edit\?step=scope$/);
    await assertNoHorizontalOverflow();

    await page.goto(proposalUrl);
    await assertNoHorizontalOverflow();
    await expect(page.getByText("Version history")).toBeVisible();
    await expect(page.getByText("Version 2 (current)")).toBeVisible();
  });
});
