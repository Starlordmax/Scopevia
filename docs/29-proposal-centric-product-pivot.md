# 29 — Proposal-Centric Product Pivot (Phase 2A)

Status: **Implemented and verified against a real Postgres/Storage
instance.** Builds on Phase 0 ([14](14-phase-0-foundations.md)) and
Phase 1 ([20](20-phase-1-crm-and-projects.md)/[26](26-phase-1.6-ui-redesign.md))
without removing or weakening any of their guarantees.

## The pivot

**Previous primary flow:** Client → Opportunity → Project → *(future
Estimate)*.

**New primary flow:** Client → Opportunity → Proposal → *(future Sent →
Viewed → Accepted/Declined)* → Project.

The core change is what a contractor does immediately after qualifying a
lead: instead of converting to a Project and waiting for a future
Estimates module, they now build a **Proposal** — a self-contained
document with scope, a labor calculator, materials/costs, photos, terms,
and a deterministic total — directly. Project is no longer a prerequisite
for pricing a job.

## New value proposition

> Create professional proposals, showcase your work, price your time, and
> win more jobs.

Concretely, a contractor can now:

1. Register a client (unchanged from Phase 1).
2. Register an opportunity, or skip straight to a proposal — one gets
   created automatically if omitted (see
   [docs/adr/0026](adr/0026-opportunity-auto-creation.md)).
3. Build a proposal through a 7-step mobile-first flow: Client & Job,
   Scope of Work, Labor, Materials & Costs, Photos, Terms & Pricing,
   Review.
4. Calculate labor cost from workers × days × hours/day × rate.
5. Add materials/costs with quantity × unit price, taxable or not.
6. Attach current-job photos and reuse previous-work photos from a
   reusable Portfolio.
7. Apply a discount and tax, always recalculated server-side.
8. Preview the proposal as a professional document.
9. Mark it ready and track it from a Proposal-centric Dashboard.

## What changed about Projects

Projects keep working exactly as they did in Phase 1 — nothing about
`projects`, `project_addresses`, or their state machine changed. What
changed is their **role**:

- No longer required before pricing a job.
- The Opportunity detail page's primary action is now **Create
  proposal** / **Open proposal**; **Convert to project** is demoted to a
  labeled secondary "legacy flow" action (still fully functional, not
  removed — see [docs/adr/0025](adr/0025-proposal-before-project.md)).
- Project creation *after* a proposal is accepted is prepared
  architecturally (`create_project_from_accepted_proposal()`) but not yet
  exposed — see [docs/adr/0034](adr/0034-project-creation-after-acceptance.md).

## Terminology

Interface (English): **Proposal**, **Proposal Builder**, **Scope of
Work**, **Labor**, **Materials & Costs**, **Photos**, **Terms & Pricing**,
**Preview**. "Proforma" is deliberately not used as the primary interface
term for the US audience.

Database/technical: `proposal`, `proposal_version`, `proposal_section`,
`proposal_line_item`, `proposal_labor_item`, `media_asset`,
`portfolio_project`.

En documentación técnica en español: Proposal equivale a Propuesta,
Cotización, o Proforma comercial — términos intercambiables al explicar
el sistema, aunque la interfaz permanece en inglés.

## What Phase 2A does NOT include

Per the brief's explicit scope boundary: email delivery, Client Portal,
email OTP, client login, real external view tracking, external
acceptance/decline, electronic signature, PDF generation, Stripe,
deposits/payments/application fees, AI, scraping, SMS, maps/geocoding,
calendar integrations, follow-up automation, Good/Better/Best, advanced
square-footage calculations, and a full per-industry materials catalog.
None of these were started "just in case."

## Documents in this set

- [30-phase-2a-proposal-data-model.md](30-phase-2a-proposal-data-model.md) — schema
- [31-proposal-state-machines.md](31-proposal-state-machines.md) — opportunity sync + proposal lifecycle
- [32-proposal-calculation-engine.md](32-proposal-calculation-engine.md) — labor/line items/totals
- [33-media-and-storage-security.md](33-media-and-storage-security.md) — Storage bucket, policies, media model
- [34-proposal-builder-ux.md](34-proposal-builder-ux.md) — the builder, preview, dashboard, navigation
- [35-phase-2a-rls-verification.md](35-phase-2a-rls-verification.md) — security test evidence
- [36-phase-2a-e2e-verification.md](36-phase-2a-e2e-verification.md) — end-to-end test evidence
