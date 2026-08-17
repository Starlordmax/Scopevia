import { test, expect } from "@playwright/test";
import { authFile, getManifest, uniqueSuffix } from "./fixtures/session";
import { getCapturedPortalOtpCode } from "./fixtures/portal";
import { getCapturedNotification } from "./fixtures/notifications";

/**
 * Runs only under the "mobile" Playwright project (390x844 — see
 * playwright.config.ts).
 */
const MOBILE_VIEWPORT = { width: 390, height: 844 };

test.use({ storageState: authFile("owner-a") });

test.describe("Proposal notifications (mobile, 390x844)", () => {
  test("accepting on mobile still notifies the contractor team, with no horizontal overflow", async ({ page, browser }) => {
    test.setTimeout(60_000);
    const suffix = uniqueSuffix();
    const clientName = `E2E Mobile Notify Client ${suffix}`;
    const clientEmail = `mobile-notify-client-${suffix}@example.com`;
    const ownerEmail = getManifest().users.ownerA.email;

    await page.goto("/clients/new");
    await page.getByLabel("Client type").selectOption("individual");
    await page.getByLabel("Display name").fill(clientName);
    await page.getByLabel("Email").fill(clientEmail);
    await page.getByRole("button", { name: "Create client" }).click();
    await page.waitForURL(/\/clients\/[0-9a-f-]+$/);

    await page.goto("/proposals/new");
    await page.getByLabel("Client").selectOption({ label: clientName });
    await page.waitForURL(/clientId=/);
    await page.getByLabel("Proposal title").fill(`E2E Mobile Notify Proposal ${suffix}`);
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

    await visitorPage.getByRole("button", { name: "Accept proposal" }).first().click();
    await assertNoHorizontalOverflow();
    await visitorPage.getByLabel("Your name").fill("Jane Mobile Client");
    await visitorPage.getByRole("checkbox").check();
    visitorPage.once("dialog", (dialog) => dialog.accept());
    await visitorPage.getByRole("button", { name: "Accept proposal" }).last().click();

    await expect(visitorPage.getByRole("heading", { name: "Proposal accepted" })).toBeVisible({ timeout: 15_000 });
    await assertNoHorizontalOverflow();
    await visitorContext.close();

    // ownerA's email is shared across every notification test (desktop and
    // mobile) -- matching on the full subject, which embeds this test's
    // own unique proposal title, avoids picking up a different,
    // concurrently-running test's notification to the same recipient.
    const notification = await getCapturedNotification(ownerEmail, `Proposal accepted: E2E Mobile Notify Proposal ${suffix}`);
    expect(notification.text).toContain("Jane Mobile Client");
  });
});
