import { test, expect } from "@playwright/test";
import { authFile, uniqueSuffix } from "./fixtures/session";

/**
 * Runs only under the "mobile" Playwright project (390x844 viewport — see
 * playwright.config.ts). Verifies the Kanban board's actual rendered layout
 * on a small screen, not just that the CSS rule exists in globals.css (the
 * real gap flagged in docs/24-phase-1-manual-testing.md before this suite).
 */
test.use({ storageState: authFile("owner-a") });

test.describe("Pipeline (mobile, 390x844)", () => {
  test("collapses to a vertical stack, has no horizontal scroll, and status can change without drag-and-drop", async ({
    page,
  }) => {
    const suffix = uniqueSuffix();
    const clientName = `E2E Mobile Client ${suffix}`;
    const title = `E2E Mobile Opp ${suffix}`;

    await page.goto("/clients/new");
    await page.getByLabel("Display name").fill(clientName);
    await page.getByRole("button", { name: "Create client" }).click();
    await page.waitForURL(/\/clients\/[0-9a-f-]+$/);

    await page.goto("/opportunities/new");
    await page.getByLabel("Client").selectOption({ label: clientName });
    await page.getByLabel("Title").fill(title);
    await page.getByRole("button", { name: "Create opportunity" }).click();
    await page.waitForURL(/\/opportunities\/[0-9a-f-]+$/);

    await page.goto("/pipeline");

    // No horizontal scroll — the page itself must not be wider than the
    // viewport (this would fail if the board stayed in row layout).
    const viewportWidth = page.viewportSize()!.width;
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(viewportWidth + 1); // +1 for sub-pixel rounding

    // Real layout assertion: consecutive columns must be stacked vertically
    // (same left edge, increasing top edge), not side by side.
    const columns = page.locator(".kanban-column");
    const count = await columns.count();
    expect(count).toBeGreaterThanOrEqual(2);
    const firstBox = await columns.nth(0).boundingBox();
    const secondBox = await columns.nth(1).boundingBox();
    expect(firstBox).not.toBeNull();
    expect(secondBox).not.toBeNull();
    expect(Math.abs(firstBox!.x - secondBox!.x)).toBeLessThan(2); // same left edge
    expect(secondBox!.y).toBeGreaterThan(firstBox!.y); // stacked below, not beside

    // The card holding our opportunity must fit within the viewport width.
    const card = page.locator(".kanban-card").filter({ hasText: title });
    await expect(card).toBeVisible();
    const cardBox = await card.boundingBox();
    expect(cardBox).not.toBeNull();
    expect(cardBox!.x + cardBox!.width).toBeLessThanOrEqual(viewportWidth + 1);

    // Status change without drag-and-drop: the quick-advance <select> must be
    // visible and directly usable via a tap-equivalent (selectOption), never
    // requiring a drag gesture.
    const select = card.getByRole("combobox", { name: "Move to stage" });
    await expect(select).toBeVisible();
    const selectBox = await select.boundingBox();
    expect(selectBox).not.toBeNull();
    expect(selectBox!.x).toBeGreaterThanOrEqual(0);
    expect(selectBox!.x + selectBox!.width).toBeLessThanOrEqual(viewportWidth + 1);

    await select.selectOption("contacted");
    await page.waitForLoadState("networkidle");
    const contactedColumn = page
      .locator(".kanban-column")
      .filter({ has: page.locator(".kanban-column-header", { hasText: "contacted" }) });
    await expect(contactedColumn.locator(".kanban-card").filter({ hasText: title })).toBeVisible();
  });

  test("no essential action is hidden behind an off-screen element", async ({ page }) => {
    await page.goto("/pipeline");
    const listViewLink = page.getByRole("link", { name: "List view" });
    await expect(listViewLink).toBeVisible();
    const box = await listViewLink.boundingBox();
    const viewportWidth = page.viewportSize()!.width;
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewportWidth + 1);
  });
});
