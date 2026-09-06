---
status: Accepted
date: 2026-07-06
supersedes: none
---

# ADR 0031 — Tax and discount model

## Context

A proposal needs a discount (none/fixed/percentage) and a tax rate applied
only to taxable line items, with a deterministic, server-computed total.
Two open questions the brief explicitly asked to resolve and document:
whether labor is taxable, and how a discount is split between taxable and
non-taxable amounts.

## Decision

Order of operations, implemented in `recalculate_proposal_version()`
(`supabase/migrations/20260706141000_proposal_helpers.sql`):

```
subtotal            = labor_total + line_items_subtotal
discount            = fixed value, or floor(subtotal * percent_bps / 10000)
                       — capped at subtotal, never negative
taxable_subtotal    = labor_total + line_items_taxable_subtotal
                       - floor(discount * taxable_subtotal / subtotal)   -- proration
tax                 = floor(taxable_subtotal * tax_rate_bps / 10000)
total               = subtotal - discount + tax                          -- floored at 0
```

**Labor is always taxable.** There is no per-labor-item taxable flag in
Phase 2A. This is a real, jurisdiction-dependent business rule (some US
states tax labor bundled with materials differently than materials
alone); rather than guess at a toggle with no clear default, Phase 2A
documents the simple, single behavior and defers a per-tenant override to
a future phase that can make the decision deliberately.

**Discount proration.** When a discount applies to a subtotal that mixes
taxable and non-taxable amounts, the discount is removed from the taxable
portion in proportion to that portion's share of the total subtotal —
not applied entirely to one side or the other. This avoids the discount
silently changing the *effective* tax rate in either direction depending
on which items happen to be taxable.

Money is cents (`bigint`); percentages are basis points (`int`,
0–10000). `discount_value`'s meaning depends on `discount_type` (cents
for `fixed`, basis points for `percentage`) — documented on the column
and enforced by a CHECK constraint
(`proposal_versions_discount_value_check`).

## Consequences

- A discount can never make the total negative (capped at subtotal, and
  the final total is floored at 0 as a second defense).
- Verified with the brief's required scenarios in both
  `tests/unit/proposal-calculations.test.ts` and
  `tests/rls/phase2a-proposals.test.ts`: no discount, fixed discount,
  percentage discount, discount exceeding subtotal, mixed taxable/
  non-taxable line items, labor-always-taxable, and proration math.
- If a future phase adds a per-tenant "labor is not taxable" setting,
  it's an additive column + a conditional in one function, not a
  redesign.
