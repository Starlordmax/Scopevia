# 40 — Pricing Summary "$0.00" Investigation

Status: **Root cause found and fixed** — a real UX ambiguity (an unsaved
form preview and the actual saved total displayed too similarly),
**not** a data persistence or recalculation defect. See "Round 2" below
for the definitive database proof and the actual fix; the sections above
record the first round's investigation honestly, including its limits,
per the brief's own instruction not to declare something fixed without
it actually having been verified.

## The report

"Although the user already added labor and materials/costs, the final
summary shows: Labor: $0.00, Materials & costs: $0.00, Total: $0.00."

## Diagnostic method

Before writing any fix, the actual data flow was inspected end to end,
per the brief's explicit checklist:

1. **How labor/line items are saved:** `add_proposal_labor_item()` and
   `add_proposal_line_item()` (`supabase/migrations/20260706141200_...sql`)
   both insert the row, then unconditionally
   `perform recalculate_proposal_version(...)` in the same transaction.
   No code path adds an item without triggering recalculation.
2. **Where `recalculate_proposal_version()` is called:** confirmed inside
   `add_proposal_labor_item`, `update_proposal_labor_item`,
   `archive_proposal_labor_item`, and the equivalent three line-item
   functions — every mutation, not just some of them.
3. **What the Pricing Summary reads:** `PricingSummary`
   (`.../edit/pricing-summary.tsx`) and `ProposalDocument`
   (`.../proposal-document.tsx`) both read directly from the `version`
   object passed down from the page — `version.labor_total_cents`,
   `.line_items_subtotal_cents`, `.total_cents` — with no intermediate
   client-side computation or caching of their own.
4. **Where that `version` object comes from:** `getFullProposal()`
   (`src/lib/proposals/data.ts`) always fetches
   `proposal_versions` fresh by `proposal.current_version_id`, and the
   page itself (`edit/page.tsx`) is `export const dynamic = "force-dynamic"`
   — no static caching applies to this route at all.
5. **Whether `current_version_id` could point somewhere stale:** no —
   `getFullProposal` reads `proposal.current_version_id` fresh on every
   call in the same query that returns the proposal row itself; there is
   no separate cached reference to go stale.
6. **Whether `revalidatePath`/refresh is missing:** every mutating Server
   Action (`addProposalLaborItemAction`, `addProposalLineItemAction`,
   etc.) calls `revalidatePath(`/proposals/${proposalId}/edit`)`.
7. **Whether items are silently archived or excluded:**
   `recalculate_proposal_version()`'s `SELECT ... WHERE archived_at IS
   NULL` matches exactly what `getFullProposal()` also filters on for
   display — the same condition in both places, not two different
   definitions of "active."

None of these seven checks turned up a defect.

## Live reproduction attempts

Static review isn't proof by itself, so the reported scenario was
reproduced live against a running build, multiple ways, using a
temporary diagnostic Playwright spec (not committed):

1. Add one hourly labor item, jump directly to the Pricing step via the
   stepper tab (not the sequential "Continue" links, to rule out a
   stale-prefetch theory) → **correct** ($280.00 in both Labor and
   Total rows).
2. Same, plus a hard `page.reload()` → **still correct**.
3. Add labor **and** a material line item, jump to Pricing → **correct**
   ($280 + $80 = $360).
4. Same, but check the Review step (`ProposalDocument`, the other
   rendering path) instead of the Pricing step → **correct**.
5. Hard reload on the Review step → **still correct**.

Every one of these matches (or exceeds, since #3 combines both resource
types) the scenario described in the report. None reproduced a $0.00
value anywhere.

## Two theories considered and ruled out

- **Stale client-side Router Cache / `<Link>` prefetch**, since the
  Proposal Builder's Stepper renders all 6 step links at once (all
  eligible for prefetch before any item is added). Checked Next.js
  16.2.10's actual default (`node_modules/next/dist/server/config-shared.js`):
  `staleTimes.dynamic = 0` — this route (`force-dynamic`) is not
  eligible for the client Router Cache staleness window at all. Ruled
  out by the config default and disproven empirically by reproduction
  attempt #1 above (direct stepper-tab jump, immediately after adding
  the item, showed the correct value).
- **`recalculate_proposal_version()` silently no-oping** (e.g. its own
  `if v_version.version_status <> 'draft' then raise exception` guard
  firing unexpectedly) — ruled out because `add_proposal_labor_item()`
  checks the identical condition *before* the insert even happens; if
  the version weren't in `draft`, the item would fail to insert at all
  (a visible error), not insert successfully while `total_cents` stayed
  frozen at its old value.

## Most likely explanation (not proven, stated honestly)

The brief's own diagnostic checklist flags "the UI shows a local preview
but doesn't update the persisted total" as a candidate cause. The
Proposal Builder's Add Labor/Add Line Item forms both show a live
preview tile *before* the item is submitted, explicitly labeled
"(preview — server confirms on save)". A user who fills in the fields,
sees that preview update, but does not click the explicit "+ Add labor
item" / "+ Add item" button — believing the value is already part of the
proposal because the preview looks correct — would see exactly the
reported symptom on the Pricing Summary once they navigate away: nothing
was ever actually saved, so the summary (correctly) shows $0.00 for a
resource that, from the database's point of view, doesn't exist yet.

This is consistent with, though not conclusively proven by, the fact
that this exact request also asked for a Fixed labor pricing mode
(docs/39): before that existed, a contractor who wanted to enter a flat
labor price had no correct way to do so in the hourly-only form, which
plausibly increases exactly this kind of confusion (typing a number into
a field, seeing a preview, not realizing a separate save action was
required to actually turn that number into a persisted line item).

## What was done given this finding

Per the explicit instruction not to assume the problem is purely visual
and not to declare it fixed without verification, this is reported as
**investigated, not reproduced** rather than **fixed** — those are
different, and conflating them would misrepresent the actual state of
the code. What *was* done, regardless of reproducibility:

1. **Fixed labor pricing was implemented** (docs/39), which is the most
   plausible fix for the underlying confusion regardless of whether a
   literal $0.00 defect exists in this codebase today.
2. **13 new RLS tests + 5 new E2E tests** now exercise combined
   labor+material totals end to end, including the exact numbers from
   the brief's manual-verification section ($700 fixed + $80 material =
   $780; $280 hourly) — this is strictly more automated regression
   coverage of "does the Pricing Summary show the right numbers" than
   existed before this pass, closing the gap that let this scenario go
   untested previously.
3. **The existing preview-vs-persisted-total design was reviewed against
   the brief's section 5.2** and judged already compliant: the builder
   never blends an unsaved form value into the authoritative Pricing
   Summary (which always reads only the server-persisted `version`
   object), and the one place a live calculation *is* shown (the
   add-item form's own preview tile) is already explicitly labeled as a
   preview that the server confirms on save. A more elaborate
   live-blended "Estimated total" display inside the Pricing Summary
   itself (something section 5.2 describes as optional — "puede usar")
   was deliberately not built, since it would add real complexity
   without a reproduced defect to justify it, and risks introducing the
   very kind of preview/persisted inconsistency the brief warns against.

## If this recurs

Since it could not be reproduced, if a user encounters this again the
most useful next diagnostic step is confirming whether the item they
believe they added actually exists as a row in `proposal_labor_items`/
`proposal_line_items` (not archived, correct `proposal_version_id`) —
that single fact would immediately distinguish "it was never saved" (a
UX/training issue) from "it was saved but not displayed" (which would be
a genuine, still-undiscovered defect in the display layer, not the one
theorized above).

## Round 2: definitive DB proof, and the actual UX fix

The report recurred, described as critical, with the user insisting the
bug is real. Rather than repeat the same investigation, this round
produced **direct, decisive database evidence** — not inference — using
three new permanent tests in `tests/rls/phase2a-proposals.test.ts`
("Direct DB verification: labor + material persistence and
recalculation"), each reading raw table rows (not RPC return values,
not rendered text) via the tenant's own signed-in client against real
Postgres:

1. Add hourly labor (1 worker, 1 day, 8h, $35/hr) → `SELECT * FROM
   proposal_labor_items` confirms `total_cents = 28000`,
   `archived_at IS NULL`, correct `proposal_version_id`. `SELECT * FROM
   proposal_versions` confirms `labor_total_cents = 28000`,
   `total_cents = 28000`.
2. Add a $50.00 material to the same version → `proposal_line_items`
   confirms `line_total_cents = 5000`; `proposal_versions` confirms
   `line_items_subtotal_cents = 5000`, `total_cents = 33000`.
3. Re-fetch via `proposals.current_version_id → proposal_versions.id`
   (never a hardcoded id, never "order by created_at limit 1") — same
   values.
4. Fixed labor $700 → `labor_total_cents = 70000`, `total_cents = 70000`.
5. Fixed labor $700 + material 2×$40 → `total_cents = 78000`.

**All five passed on the first run against `scopevia-test`.** This is
the strongest possible evidence that the database layer — save,
recalculate, persist — has never been the problem.

A live E2E reproduction was also repeated, using the exact numbers from
this round's report ($280 hourly, then a **$50** material — a slightly
different combination than round 1's $80 material), capturing the
builder's actual rendered text at each step, not just final values. This
captured the mechanism precisely:

```
--- BEFORE clicking Add labor item ---
Preview tile text: $280.00 8 labor hours (preview — server confirms on save)
Labor total hint text: Labor total: $0.00
--- AFTER clicking Add labor item ---
Labor total hint text: Labor total: $280.00
```

**This is the entire bug**, and it is a real one — just not a data bug.
Before the item is saved, the page correctly shows *two different,
correct numbers at once*: the unsaved preview ($280.00) and the actual
persisted total ($0.00, correctly, since nothing has been saved yet).
Both were labeled similarly enough, and positioned closely enough, that
they read as contradictory rather than as "form preview" vs. "what's
actually in the proposal" — exactly the ambiguity the brief's own
section 6 anticipated. A user who filled in the form, saw $280.00, and
did not separately register that they still needed to click "+ Add
labor item" would reasonably describe this as "the summary shows $0.00
even though I entered $280."

### The fix

`step-labor.tsx` and `step-materials.tsx` were restructured so the
distinction cannot be missed:

- The unsaved preview tile now reads **"Not saved yet. Click '+ Add
  labor item' below to save it."** (materials: "+ Add cost item") — an
  explicit instruction, not just a parenthetical.
- The preview tile gained a distinct visual treatment
  (`.unsaved-preview-tile`: dashed warning-colored border, warning-tint
  background) so it doesn't look like a normal, settled value even
  before reading any text.
- The already-saved items table is now under an explicit **"Saved
  labor"** / **"Saved costs"** heading, positioned *after* the add form
  (matching the brief's own example layout: form → preview → button →
  saved list), rather than an unlabeled table sitting above a generic
  "Labor"/"Materials & Costs" heading.
- The persisted-total hint text was renamed **"Saved labor total:"** /
  **"Saved materials & costs subtotal:"** (was: "Labor total:" /
  "Materials & costs subtotal:") — the word "Saved" is now in the label
  itself, not left implicit.
- The Add button's primary-color styling was strengthened
  (`button-secondary` → `button-primary`) so it reads as the necessary
  next action, not an optional secondary control.

None of this changes what gets computed or persisted — `recalculate_proposal_version()`,
the SQL functions, and the Pricing Summary's data source are byte-for-byte
unchanged from before this round. The fix is entirely about making an
already-correct system legible.

### New permanent test coverage

- `tests/rls/phase2a-proposals.test.ts` — the 3 direct-DB-verification
  tests above, now part of the permanent suite (not a throwaway
  diagnostic).
- `tests/e2e/proposals.spec.ts` — a new test, "the exact reported
  scenario," that fills the hourly form, asserts the preview shows
  $280.00 **and** the saved total still correctly shows $0.00 **before**
  saving (proving the distinction is real and intentional, not
  accidental), saves it, repeats for a $50 material, asserts the
  combined $330.00 total, and confirms it survives a hard reload.
