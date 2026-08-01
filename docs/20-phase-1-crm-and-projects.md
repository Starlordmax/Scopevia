# 20 — Phase 1: CRM & Projects

Status: **Implemented, unit- and integration-tested against a real Postgres instance. Not yet advanced to Phase 2 — see docs/24-phase-1-manual-testing.md and the final report for why.**

This document describes what Phase 1 builds on top of Phase 0
([14-phase-0-foundations.md](14-phase-0-foundations.md)), the decisions
made while implementing it (including deviations from the original
brief, evaluated rather than accepted uncritically), and what is
deliberately out of scope. For the schema itself, see
[21-phase-1-data-model.md](21-phase-1-data-model.md). For the two state
machines, see [22-phase-1-state-machines.md](22-phase-1-state-machines.md).
For RLS/security test evidence, see
[23-phase-1-rls-verification.md](23-phase-1-rls-verification.md).

> **Later addition**: a second, stricter-validation entry point into
> `create_client()` — Quick Create Client, a modal reachable from the
> proposal-creation flow — was added afterward; see
> [72-quick-create-client.md](72-quick-create-client.md). It reuses this
> phase's `clients.create` permission and `create_client()` RPC unchanged.

## What Phase 1 includes

A five-stage CRM/pipeline flow: **Clients → Contacts → Opportunities →
Projects → Project Addresses**, plus a **Notes** system and a
system-generated **Activity** timeline, all tenant-isolated and
permission-gated on top of the Phase 0 foundation. Concretely:

- 7 new tables: `clients`, `client_contacts`, `opportunities`, `projects`,
  `project_addresses`, `crm_notes`, `crm_activities`.
- 27 new permission keys and an extended per-role grant matrix (below).
- Two state machines (opportunity pipeline, project pipeline) enforced
  exclusively in `SECURITY DEFINER` SQL functions.
- An idempotent, concurrency-safe opportunity → project conversion.
- Full RLS coverage (SELECT-only policies; every mutation goes through a
  function, exactly like Phase 0).
- Mobile-first UI: client/opportunity/project list+detail pages, a Kanban
  pipeline board with a vertical-stack fallback below 640px, notes and
  activity feed components.
- A dashboard on the protected home page showing live counts (clients,
  open opportunities, projects, upcoming inspections) and recent activity.

## Out of scope (explicitly, per the brief)

Estimates, Proposals, PDFs, Stripe/payments, Storage/photo uploads, maps
or geocoding (`project_addresses.latitude`/`longitude` exist as columns
but are always `null`), Realtime, AI/scraping, a native mobile app,
custom fields, calendar/email sync, and per-assignment (as opposed to
per-role) row-level security. None of these were built "just in case."

## Permission matrix

27 new keys, seeded in
`supabase/migrations/20260702131100_seed_crm_permissions.sql`:

| Permission | Owner | Admin | Estimator | Sales | Field Worker | Viewer |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| `clients.view` | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ |
| `clients.create` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| `clients.update` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| `clients.archive` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `clients.restore` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `contacts.view` | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ |
| `contacts.create` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| `contacts.update` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| `contacts.archive` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `contacts.restore` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `opportunities.view` | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ |
| `opportunities.create` | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |
| `opportunities.update` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| `opportunities.change_status` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| `opportunities.archive` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `opportunities.restore` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `opportunities.convert_to_project` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| `projects.view` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `projects.create` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| `projects.update` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| `projects.archive` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `projects.restore` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `notes.view` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `notes.create` | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| `notes.update` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| `notes.archive` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `activities.view` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

Deliberate asymmetries, and why:

- **Estimator has no `opportunities.create`.** They work leads already
  qualified and handed to them; they don't originate new opportunities.
  They do get `opportunities.convert_to_project` — converting a
  ready-for-estimate opportunity into a project they'll then work is
  exactly their job.
- **Sales has no `projects.update`.** Sales creates the project (via
  conversion or directly) and then hands it off to
  estimating/operations; editing project details afterward isn't their
  role. They keep `projects.create`/`projects.view`.
- **Field Worker gets a *broad* `projects.view`**, across the whole
  tenant, not scoped to "their assigned projects." Phase 1 has no
  per-assignment RLS (see "Known limitation" below) — this is documented
  as a real, deliberate limitation, not faked as if assignment-scoping
  existed. Field Worker also gets `notes.create` (they can log what they
  found on site) but not `notes.update`/`notes.archive`, and no
  visibility into `clients`/`opportunities` at all — their job is the
  physical work, not the sales relationship.
- **Viewer is read-only across the entire module**, including `notes.view`
  and `activities.view`, but cannot create anything, matching Phase 0's
  Viewer role exactly.

### Known limitation: no per-assignment security

Field Worker's `projects.view` is a **tenant-wide** grant, not scoped to
"projects assigned to me." Building real assignment-scoped RLS would
require either a `USING` clause that checks `assigned_to` against the
caller's own membership id (workable, but narrows visibility in a way
that hasn't been validated against how field crews actually use the
product — e.g. can they see projects assigned to a *teammate* to cover a
shift?) or a join table for multi-person crews (not designed yet). Rather
than build a half-considered scoping rule now, Phase 1 grants the
permission broadly and documents the gap explicitly, per the brief's
instruction: "while no assignment-specific security exists, don't
pretend a Field Worker can only access their own projects — implement a
clear, documented rule instead."

## Notes vs. activities vs. audit_logs

Three genuinely different tables, deliberately not merged or made
polymorphic-by-string:

| Table | Who writes it | Mutable? | Purpose |
|---|---|---|---|
| `crm_notes` | A human, via `create_note()`/`update_note()` | Yes (edit, archive) | Free-text notes a staff member attaches to a client/opportunity/project |
| `crm_activities` | The system, via `log_crm_activity()` (called internally by every mutation function) | No (append-only, trigger-enforced) | Product-facing business timeline — "Opportunity won," "Inspection scheduled" — meant to be rendered in the UI |
| `audit_logs` (Phase 0) | The system, via `log_audit_event()` | No (append-only) | Security/compliance trail — who did what, for access review and incident response |

Every Phase 1 mutation that matters to a user writes to **both**
`audit_logs` and `crm_activities` as two independent inserts in the same
transaction — see `tests/rls/phase1-crm.test.ts`, "creating a note
produces rows in crm_notes, crm_activities, AND audit_logs." See ADR
0008 for the full schema rationale (why one shared table per concept,
not per-entity duplicates or an `entity_type`/`entity_id` polymorphic
pair).

## Cross-tenant integrity

Every parent/child relationship added in Phase 1 uses a **composite
foreign key** (`(child_id, tenant_id) references parent (id, tenant_id)`)
on top of RLS, not instead of it — see ADR 0007. This is verified
directly in `tests/rls/phase1-crm.test.ts` by attempting a cross-tenant
insert as `service_role`, bypassing every application check, and
confirming Postgres itself rejects it (`23503 foreign_key_violation`).

## Concurrency

Three operations are safe under real concurrent access, each combining a
row lock, a partial/full unique index as the declarative backstop, and
idempotent-retry behavior — see ADR 0013:

- Setting a client's primary contact (`set_primary_contact()`).
- Setting a project's primary address (`set_primary_project_address()`).
- Converting an opportunity into a project
  (`convert_opportunity_to_project()`) — retrying, or losing a race,
  always returns the *same* project rather than erroring or duplicating.

All three are exercised under genuine `Promise.all()` concurrency in
`tests/rls/phase1-crm.test.ts`, not just reasoned about in code review.

## Idempotent opportunity → project conversion

`convert_opportunity_to_project()` requires the opportunity to be
`ready_for_estimate` or `won`, copies over the client, the client's
current primary contact (if any), and the assignee, and creates the
project in `draft` status unconditionally. It deliberately does **not**
change the opportunity's own status — see ADR 0011, "Why conversion does
not change opportunity status." It is safe to call more than once (from
a UI retry, a double-click, or a network timeout) — see ADR 0013.

## Mobile-first UI decisions

- The pipeline view (`/pipeline`) is a Kanban board (`.kanban-board` /
  `.kanban-column` in `globals.css`) that becomes a vertical stack of
  full-width columns below a 640px breakpoint — there is no
  drag-and-drop dependency; status changes happen via an explicit
  "quick advance" control (`pipeline/quick-advance.tsx`) that works
  identically with touch taps or a mouse click, so mobile users are never
  required to drag.
- List pages (clients/opportunities/projects) use a simple search +
  pagination pattern (`components/search-form.tsx`,
  `components/pagination.tsx`), capped at `MAX_PAGE_SIZE = 100` server-side
  regardless of what a client requests, to avoid ever shipping an
  unbounded table to a phone.

## Search input handling

List-page search builds a PostgREST `.or()` filter from raw user input,
which has two independent injection-like risks if built naively: SQL
`ILIKE` wildcards (`%`, `_`) changing match semantics, and PostgREST's
`.or()` syntax itself treating `,`/`(`/`)` as structural. Both are
escaped, in the correct order, by `src/lib/search.ts`
(`escapeLikeWildcards` then `escapeOrFilterSyntax`) before any user input
reaches a filter string.

## Deviations from the pre-implementation design (docs/05, docs/08)

- **No `billing_address` JSONB blob on `clients`** (present in the
  original sketch) — JSONB is not used as a substitute for a real
  relation; if a client's billing address ever needs to be more than a
  couple of text fields, it gets its own properly-columned table later.
- **No `status` column on `clients`** — the commercial lifecycle lives
  entirely in `opportunities.status`; a client is simply active or
  archived.
- **Project statuses simplified**: `active`/`on_hold`/`completed` from
  the original sketch are deferred (see ADR 0012) — without an Estimates
  module there is nothing to be "in progress" against yet.
- **Opportunity `lost` is reactivable, not terminal**, and `archived` is
  reachable only through a dedicated `archive_opportunity()`/
  `archive_project()` function/permission pair, not as an ordinary
  pipeline transition — see ADR 0011/0012 for the full evaluation of the
  brief's originally proposed transition table and why it was corrected
  rather than adopted as-is.

## What's next (explicitly not started)

Estimates, Proposals, payments, and everything else in the out-of-scope
list above. See the final Phase 1 report for the numeric readiness
assessment and the explicit instruction not to advance to Phase 2 in
this response regardless of that assessment.
