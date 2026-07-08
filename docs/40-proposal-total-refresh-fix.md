# 40 — Pricing Summary "$0.00" Investigation

Status: **Investigated rigorously; not reproduced as a code defect.** This
document records the investigation honestly, including its limits — per
the brief's own instruction not to assume the problem is visual and not
to declare something fixed without it actually having been verified.

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
