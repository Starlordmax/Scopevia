import { test, expect } from "@playwright/test";
import { authFile, uniqueSuffix } from "./fixtures/session";

// Projects is no longer a visible module — see
// docs/38-navigation-simplification.md. The old version of this file
// exercised the Projects UI directly (create, addresses, status
// transitions, archive/restore); that UI is gone. The underlying projects
// table, its addresses, its status machine, and
// create_project_from_accepted_proposal() are untouched and remain fully
// covered by tests/rls/phase1-crm.test.ts and
// tests/rls/phase1-restore.test.ts, which never depended on this UI.
test.use({ storageState: authFile("owner-a") });

test.describe("Projects (legacy routes)", () => {
  test("/projects redirects to /proposals instead of rendering a list", async ({ page }) => {
    await page.goto("/projects");
    await page.waitForURL(/\/proposals$/);
    await expect(page.getByRole("heading", { name: "Projects" })).toHaveCount(0);
  });

  test("/projects/new redirects to /proposals", async ({ page }) => {
    await page.goto("/projects/new");
    await page.waitForURL(/\/proposals$/);
  });

  test("a stale /projects/[id] link redirects safely rather than rendering project detail", async ({ page }) => {
    await page.goto("/projects/00000000-0000-0000-0000-000000000000");
    await page.waitForURL(/\/proposals$/);
  });

  test("a stale /projects/[id]/edit link redirects safely", async ({ page }) => {
    await page.goto("/projects/00000000-0000-0000-0000-000000000000/edit");
    await page.waitForURL(/\/proposals$/);
  });

  test("does not appear anywhere in the desktop sidebar", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".sidebar").getByRole("link", { name: "Projects", exact: true })).toHaveCount(0);
  });

  test("Client detail no longer shows a Projects section", async ({ page }) => {
    const suffix = uniqueSuffix();
    await page.goto("/clients/new");
    await page.getByLabel("Display name").fill(`E2E No Projects Section ${suffix}`);
    await page.getByRole("button", { name: "Create client" }).click();
    await page.waitForURL(/\/clients\/[0-9a-f-]+$/);
    await expect(page.getByRole("heading", { name: "Projects", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Create proposal" })).toBeVisible();
  });

  test("Opportunity detail no longer shows a Convert to project CTA", async ({ page }) => {
    const suffix = uniqueSuffix();
    const clientName = `E2E No Convert CTA ${suffix}`;
    await page.goto("/clients/new");
    await page.getByLabel("Display name").fill(clientName);
    await page.getByRole("button", { name: "Create client" }).click();
    await page.waitForURL(/\/clients\/[0-9a-f-]+$/);

    await page.goto("/opportunities/new");
    await page.getByLabel("Client", { exact: true }).selectOption({ label: clientName });
    await page.getByLabel("Title").fill(`E2E No Convert Opp ${suffix}`);
    await page.getByRole("button", { name: "Create opportunity" }).click();
    await page.waitForURL(/\/opportunities\/[0-9a-f-]+$/);

    await expect(page.getByRole("button", { name: "Convert to project" })).toHaveCount(0);
    await expect(page.getByText(/legacy flow/i)).toHaveCount(0);
  });
});
