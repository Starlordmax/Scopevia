import { test, expect } from "@playwright/test";
import { authFile, uniqueSuffix } from "./fixtures/session";

test.use({ storageState: authFile("owner-a") });

test.describe("Pipeline (desktop)", () => {
  test("shows the expected columns and a newly created opportunity as a card", async ({ page }) => {
    const suffix = uniqueSuffix();
    const clientName = `E2E Pipeline Client ${suffix}`;
    const title = `E2E Pipeline Opp ${suffix}`;

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
    for (const label of ["new", "contacted", "qualified", "inspection scheduled", "ready for estimate", "won", "lost"]) {
      await expect(page.locator(".kanban-column-header").filter({ hasText: label })).toBeVisible();
    }

    const newColumn = page.locator(".kanban-column").filter({ has: page.locator(".kanban-column-header", { hasText: "new" }) });
    const card = newColumn.locator(".kanban-card").filter({ hasText: title });
    await expect(card).toBeVisible();
    await expect(card.getByText(clientName)).toBeVisible();
  });

  test("quick-advance select moves a card to the next column without drag-and-drop, and persists", async ({ page }) => {
    const suffix = uniqueSuffix();
    const clientName = `E2E Quick Advance ${suffix}`;
    const title = `E2E Advance ${suffix}`;

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
    const card = page.locator(".kanban-card").filter({ hasText: title });
    await card.getByRole("combobox", { name: "Move to stage" }).selectOption("contacted");
    await page.waitForLoadState("networkidle");

    const contactedColumn = page
      .locator(".kanban-column")
      .filter({ has: page.locator(".kanban-column-header", { hasText: "contacted" }) });
    await expect(contactedColumn.locator(".kanban-card").filter({ hasText: title })).toBeVisible();

    await page.reload();
    await expect(contactedColumn.locator(".kanban-card").filter({ hasText: title })).toBeVisible();
  });
});
