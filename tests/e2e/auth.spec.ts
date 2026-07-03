import { test, expect } from "@playwright/test";
import { E2E_PASSWORD } from "./fixtures/provision";
import { getManifest } from "./fixtures/session";

// Fresh, non-reused browser context for every test in this file — proves
// the sign-in flow itself works, independent of auth.setup.ts's storageState
// reuse (which exists purely for the other spec files' convenience).
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("Sign in", () => {
  test("valid credentials redirect to the protected shell with an active tenant shown", async ({ page }) => {
    const manifest = getManifest();
    await page.goto("/sign-in");
    await page.getByLabel("Email").fill(manifest.users.ownerA.email);
    await page.getByLabel("Password").fill(E2E_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();

    await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"));
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
    // Owner A belongs to two tenants; get_user_tenants() orders by name, so
    // "E2E Tenant A ..." sorts before "E2E Tenant B ..." and is the default.
    // (Not getByText: the tenant switcher's <option> has the same text.)
    await expect(page.getByRole("heading", { name: manifest.tenantAName })).toBeVisible();
    await expect(page.locator(".error-banner")).toHaveCount(0);
  });

  test("invalid credentials show a generic, friendly error and keep the form usable", async ({ page }) => {
    const manifest = getManifest();
    await page.goto("/sign-in");
    await page.getByLabel("Email").fill(manifest.users.ownerA.email);
    await page.getByLabel("Password").fill("definitely-the-wrong-password");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByText("Invalid email or password")).toBeVisible();
    // No technical leakage: no stack trace, no SQL, no mention of the
    // underlying provider/library, and deliberately no confirmation of
    // whether the email exists (see src/actions/auth.ts, signInAction).
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toMatch(/postgres|supabase|stack trace|at Object\.|SQLSTATE/i);
    // Still on /sign-in, form still there and fillable.
    await expect(page).toHaveURL(/\/sign-in/);
    await expect(page.getByLabel("Email")).toBeEditable();
    await expect(page.getByLabel("Password")).toBeEditable();
  });
});

test.describe("Protected routes redirect when signed out", () => {
  for (const route of ["/clients", "/opportunities", "/pipeline", "/projects"]) {
    test(`${route} redirects to /sign-in`, async ({ page }) => {
      await page.goto(route);
      await page.waitForURL(/\/sign-in/);
      await expect(page.getByRole("heading", { name: "Scopevia" })).toBeVisible();
    });
  }
});
