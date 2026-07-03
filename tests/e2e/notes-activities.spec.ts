import { test, expect } from "@playwright/test";
import { authFile, uniqueSuffix } from "./fixtures/session";

test.use({ storageState: authFile("owner-a") });

test.describe("Notes and activity", () => {
  test("a client note can be created, edited, and archived; activity and audit are recorded", async ({ page }) => {
    const suffix = uniqueSuffix();
    const clientName = `E2E Notes Client ${suffix}`;
    await page.goto("/clients/new");
    await page.getByLabel("Display name").fill(clientName);
    await page.getByRole("button", { name: "Create client" }).click();
    await page.waitForURL(/\/clients\/[0-9a-f-]+$/);

    await expect(page.getByRole("heading", { name: "Activity" })).toBeVisible();
    await expect(page.getByText("Client created")).toBeVisible();

    // Scoped to <p> throughout: a note's collapsed <details>/<textarea> edit
    // form carries the same text as its defaultValue, and getByText would
    // otherwise ambiguously match both it and the visible <p>.
    const noteText = `Called about the estimate ${suffix}`;
    await page.getByLabel("Add a note").fill(noteText);
    await page.getByRole("button", { name: "Add note" }).click();
    await page.waitForLoadState("networkidle");
    await expect(page.locator("p").filter({ hasText: noteText })).toBeVisible();
    await expect(page.getByText("Note added")).toBeVisible();

    // Scoped to <li> (not ".card"): the outer "Notes" section wrapper is
    // ALSO a ".card" and contains this note's text as a descendant, so a
    // ".card" filter matches both it and the note's own card — ".card" is
    // ambiguous, but only individual notes render as <li>.
    const noteCard = page.locator("li").filter({ hasText: noteText });
    // exact: true — otherwise this would ALSO match the edited note's own
    // text below ("... — edited" contains "Edit" as a substring).
    await noteCard.getByText("Edit", { exact: true }).click();
    const editedText = `${noteText} — edited`;
    await noteCard.getByRole("textbox").fill(editedText);
    await noteCard.getByRole("button", { name: "Save" }).click();
    await page.waitForLoadState("networkidle");
    await expect(page.locator("p").filter({ hasText: editedText })).toBeVisible();

    // Author and date are shown (hint text "<author> · <date>").
    await expect(page.locator(".hint").filter({ hasText: "·" }).first()).toBeVisible();

    // The <details> disclosure is native, uncontrolled HTML — it never
    // auto-closes after the Save round trip, so clicking "Edit" again here
    // (as if reopening it) would actually TOGGLE it closed. Only click it if
    // the archive control isn't already visible.
    const editedCard = page.locator("li").filter({ hasText: editedText });
    if (!(await editedCard.getByRole("button", { name: "Archive note" }).isVisible())) {
      await editedCard.getByText("Edit", { exact: true }).click();
    }
    await editedCard.getByRole("button", { name: "Archive note" }).click();
    await page.waitForLoadState("networkidle");
    // Archived notes are filtered out of the list entirely (getNotes() only
    // selects archived_at is null) — the note text disappears.
    await expect(page.getByText(editedText)).toHaveCount(0);
  });

  test("notes are scoped to exactly one resource: a note on the opportunity does not appear on the client", async ({ page }) => {
    const suffix = uniqueSuffix();
    const clientName = `E2E Note Scope Client ${suffix}`;
    await page.goto("/clients/new");
    await page.getByLabel("Display name").fill(clientName);
    await page.getByRole("button", { name: "Create client" }).click();
    await page.waitForURL(/\/clients\/[0-9a-f-]+$/);
    const clientUrl = page.url();

    await page.goto("/opportunities/new");
    await page.getByLabel("Client").selectOption({ label: clientName });
    await page.getByLabel("Title").fill(`E2E Note Scope Opp ${suffix}`);
    await page.getByRole("button", { name: "Create opportunity" }).click();
    await page.waitForURL(/\/opportunities\/[0-9a-f-]+$/);

    const opportunityNote = `Opportunity-only note ${suffix}`;
    await page.getByLabel("Add a note").fill(opportunityNote);
    await page.getByRole("button", { name: "Add note" }).click();
    await page.waitForLoadState("networkidle");
    await expect(page.locator("p").filter({ hasText: opportunityNote })).toBeVisible();

    await page.goto(clientUrl);
    await expect(page.getByText(opportunityNote)).toHaveCount(0);
  });

  test("notes are scoped to exactly one resource: a note on the project does not appear on the client", async ({ page }) => {
    const suffix = uniqueSuffix();
    const clientName = `E2E Note Scope 2 Client ${suffix}`;
    await page.goto("/clients/new");
    await page.getByLabel("Display name").fill(clientName);
    await page.getByRole("button", { name: "Create client" }).click();
    await page.waitForURL(/\/clients\/[0-9a-f-]+$/);
    const clientUrl = page.url();

    await page.goto("/projects/new");
    await page.getByLabel("Client").selectOption({ label: clientName });
    await page.getByLabel("Project name").fill(`E2E Note Scope Project ${suffix}`);
    await page.getByRole("button", { name: "Create project" }).click();
    await page.waitForURL(/\/projects\/[0-9a-f-]+$/);

    const projectNote = `Project-only note ${suffix}`;
    await page.getByLabel("Add a note").fill(projectNote);
    await page.getByRole("button", { name: "Add note" }).click();
    await page.waitForLoadState("networkidle");
    await expect(page.locator("p").filter({ hasText: projectNote })).toBeVisible();

    await page.goto(clientUrl);
    await expect(page.getByText(projectNote)).toHaveCount(0);
  });

  test("the activity feed has no edit/delete controls and shows no raw technical metadata", async ({ page }) => {
    const suffix = uniqueSuffix();
    const clientName = `E2E Activity Immutable ${suffix}`;
    await page.goto("/clients/new");
    await page.getByLabel("Display name").fill(clientName);
    await page.getByRole("button", { name: "Create client" }).click();
    await page.waitForURL(/\/clients\/[0-9a-f-]+$/);

    const activitySection = page.locator(".card").filter({ has: page.getByRole("heading", { name: "Activity" }) });
    await expect(activitySection).toBeVisible();
    // No form controls of any kind inside the activity card — it is
    // view-only, backed by an append-only, trigger-enforced table.
    await expect(activitySection.locator("button")).toHaveCount(0);
    await expect(activitySection.locator("input, textarea")).toHaveCount(0);

    const activityText = await activitySection.innerText();
    expect(activityText).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i); // no raw UUIDs
    expect(activityText).not.toMatch(/\{.*"/); // no raw JSON metadata blob
  });
});
