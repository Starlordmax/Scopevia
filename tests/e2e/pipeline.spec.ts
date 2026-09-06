import { test, expect } from "@playwright/test";
import { authFile } from "./fixtures/session";

// Pipeline (the Opportunity kanban board) is no longer a visible module —
// see docs/38-navigation-simplification.md. The old version of this file
// exercised the kanban UI itself (columns, drag-free quick-advance); that
// UI is gone. The underlying opportunities table and its status-transition
// RPCs are untouched and remain covered by tests/rls/phase1-crm.test.ts and
// tests/e2e/opportunities.spec.ts, which never depended on the Pipeline
// view.
test.use({ storageState: authFile("owner-a") });

test.describe("Pipeline (legacy route)", () => {
  test("/pipeline redirects to /proposals instead of rendering the kanban board", async ({ page }) => {
    await page.goto("/pipeline");
    await page.waitForURL(/\/proposals$/);
    await expect(page.getByRole("heading", { name: "Pipeline" })).toHaveCount(0);
  });

  test("does not appear anywhere in the desktop sidebar", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".sidebar").getByRole("link", { name: "Pipeline", exact: true })).toHaveCount(0);
  });

  test("the Opportunities list page no longer links to a Pipeline view", async ({ page }) => {
    await page.goto("/opportunities");
    await expect(page.getByRole("link", { name: /pipeline/i })).toHaveCount(0);
  });
});
