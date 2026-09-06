import { test, expect } from "@playwright/test";
import { authFile, uniqueSuffix } from "./fixtures/session";

/**
 * AI-assisted proposal text (Terms/Exclusions/Notes) — see
 * docs/77-ai-proposal-text-generation.md. This suite never calls the real
 * OpenRouter API: OPENROUTER_API_KEY is deliberately unset in every test
 * environment (.env.local, CI), so every "Generate" click here exercises
 * the local fallback-template path (docs/77, "Fallback without AI") —
 * exactly the "mock OpenRouter, never call the real API in CI/E2E"
 * requirement, achieved by simply not configuring a key rather than
 * intercepting network calls (the OpenRouter call happens server-side,
 * where Playwright's page.route() can't reach it anyway).
 */
test.use({ storageState: authFile("owner-a") });

async function createReadyForPricingProposal(page: import("@playwright/test").Page, suffix: string): Promise<string> {
  const clientName = `E2E AI Text Client ${suffix}`;
  await page.goto("/clients/new");
  await page.getByLabel("Display name").fill(clientName);
  await page.getByRole("button", { name: "Create client" }).click();
  await page.waitForURL(/\/clients\/[0-9a-f-]+$/);

  await page.goto("/proposals/new");
  await page.getByLabel("Client", { exact: true }).selectOption({ label: clientName });
  await page.waitForURL(/clientId=/);
  await page.getByLabel("Proposal title").fill(`E2E AI Text Proposal ${suffix}`);
  await page.getByLabel("Service type").selectOption("interior_painting");
  await page.getByRole("button", { name: "Save and continue" }).click();
  await page.waitForURL(/\/proposals\/[0-9a-f-]+\/edit\?step=measurements/);
  const proposalUrl = page.url().replace(/\/edit\?step=measurements$/, "");

  await page.goto(`${proposalUrl}/edit?step=pricing`);
  return proposalUrl;
}

test.describe("AI writing assistant — Terms & Pricing", () => {
  test("Generate all (fallback template), review, apply, and save", async ({ page }) => {
    const suffix = uniqueSuffix();
    await createReadyForPricingProposal(page, suffix);

    await expect(page.getByRole("heading", { name: "AI writing assistant" })).toBeVisible();
    await expect(page.getByText("AI drafts are suggestions.")).toBeVisible();

    // Terms/Exclusions/Notes start empty -- nothing to fill in yet.
    await expect(page.getByLabel("Terms")).toHaveValue("");

    await page.getByRole("button", { name: "Generate all" }).click();
    await expect(page.getByRole("heading", { name: "Generated draft" })).toBeVisible({ timeout: 15_000 });
    // No OPENROUTER_API_KEY configured in this test environment -- the
    // fallback template path is what actually ran.
    await expect(page.getByText("AI writing is not configured yet")).toBeVisible();

    await page.screenshot({ path: "test-results/validation-review/ai-writing-assistant-draft.png", fullPage: true });

    await page.getByRole("button", { name: "Apply to proposal" }).click();

    // The real form's textareas are now filled in from the draft.
    await expect(page.getByLabel("Terms")).not.toHaveValue("");
    await expect(page.getByLabel("Exclusions")).not.toHaveValue("");
    await expect(page.getByLabel("Notes for client")).not.toHaveValue("");

    await page.getByRole("button", { name: "Save and continue" }).click();
    await page.waitForURL(/step=review/);

    await page.goBack();
    await expect(page.getByLabel("Terms")).not.toHaveValue("");
  });

  test("existing text is never silently overwritten — asks Replace/Append/Cancel first", async ({ page }) => {
    const suffix = uniqueSuffix();
    await createReadyForPricingProposal(page, suffix);

    await page.getByLabel("Terms").fill("Pre-existing terms the user already wrote.");

    await page.getByRole("button", { name: "Generate terms" }).click();
    await expect(page.getByRole("heading", { name: "Generated draft" })).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: "Apply to proposal" }).click();
    await expect(page.getByText("This will replace your current text.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Replace existing text" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Append below existing text" })).toBeVisible();

    // Terms is untouched until the user actually picks one of the options.
    await expect(page.getByLabel("Terms")).toHaveValue("Pre-existing terms the user already wrote.");

    await page.getByRole("button", { name: "Append below existing text" }).click();
    const appended = await page.getByLabel("Terms").inputValue();
    expect(appended.startsWith("Pre-existing terms the user already wrote.")).toBe(true);
    expect(appended.length).toBeGreaterThan("Pre-existing terms the user already wrote.".length);
  });

  test("Cancel discards the draft without touching the real form", async ({ page }) => {
    const suffix = uniqueSuffix();
    await createReadyForPricingProposal(page, suffix);

    await page.getByRole("button", { name: "Generate all" }).click();
    await expect(page.getByRole("heading", { name: "Generated draft" })).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("heading", { name: "Generated draft" })).toHaveCount(0);
    await expect(page.getByLabel("Terms")).toHaveValue("");
  });
});

test.describe("Business profile", () => {
  test("fill in and save the business profile, then it feeds the AI draft's client-facing note", async ({ page }) => {
    const suffix = uniqueSuffix();
    const businessName = `E2E AI Business ${suffix}`;

    await page.goto("/profile");
    await expect(page.getByText("Business profile", { exact: true })).toBeVisible();

    await page.getByLabel("Business name").fill(businessName);
    await page.getByLabel("Default warranty policy").fill("Workmanship warranty for 1 year.");
    await page.getByRole("button", { name: "Save business profile" }).click();
    await expect(page.getByText("Business profile saved.")).toBeVisible({ timeout: 10_000 });

    await page.reload();
    await expect(page.getByLabel("Business name")).toHaveValue(businessName);

    // The saved warranty policy now shows up verbatim in a generated draft.
    await createReadyForPricingProposal(page, suffix);
    await page.getByRole("button", { name: "Generate terms" }).click();
    await expect(page.getByRole("heading", { name: "Generated draft" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Workmanship warranty for 1 year.")).toBeVisible();
  });
});
