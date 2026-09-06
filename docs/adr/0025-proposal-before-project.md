---
status: Accepted
date: 2026-07-06
supersedes: none
---

# ADR 0025 — Proposal before Project

## Context

Phase 1 built the flow Client → Opportunity → Project → *(future
Estimate)*. Phase 2A's brief changes the approved product direction to
Client → Opportunity → Proposal → *(future Sent/Viewed/Accepted)* →
Project, making Proposal — not Project — the object a contractor prepares
in order to quote a job. Project no longer needs to exist before a
contractor can price and present work.

## Decision

- `proposals` no longer references `projects` at all; it references
  `clients`, `client_contacts`, and `opportunities` only.
- `projects.create` remains available (manual/legacy flow, section 21 of
  the brief) and `convert_opportunity_to_project()` is untouched — it
  still works exactly as it did in Phase 1.
- The UI's primary CTA everywhere (Dashboard, Opportunity detail, global
  nav) becomes **New proposal** / **Create proposal**; "Convert to
  project" is demoted to a secondary, explicitly-labeled "legacy flow"
  action on the Opportunity detail page (see
  `src/app/(protected)/opportunities/[opportunityId]/page.tsx`).
- `create_project_from_accepted_proposal()` is prepared architecturally
  (section 40 of the brief) but not implemented/exposed in Phase 2A —
  Project's role as "what you get after acceptance" only matters once
  acceptance itself exists (a later phase).

## Consequences

- Existing Phase 1 projects, and the ability to create one directly or
  via conversion, are completely unaffected — this is a pure additive
  change to what happens *before* a project, not a change to Project
  itself.
- Phase 1's E2E/RLS suites for opportunity→project conversion continue to
  pass unmodified (verified: 141/141 RLS+Storage tests, 48+/48+ E2E after
  this phase's changes).
- Reporting/analytics that assumed "every job has a project early" will
  need to account for jobs that only have a Proposal until accepted —
  deferred to whichever phase adds real reporting.
