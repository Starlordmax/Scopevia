# 38 — Navigation Simplification: Pipeline and Projects Removed from the UI

Status: **Implemented and verified.** Pipeline and Projects are no longer
visible modules anywhere in the application. Their underlying database
tables, RPCs, RLS policies, and RLS test coverage are completely
untouched — this is a UI-only change.

## What changed

The Phase 2A pivot (docs/29) made Proposal the primary artifact between
Opportunity and Project, but left Pipeline (the Opportunity kanban board)
and Projects as full, separately-navigable modules alongside it. This
follow-up removes both from the primary experience entirely, so the app's
navigation matches the pivot's own stated model: Client → Opportunity
(internal) → Proposal → *(future)* → Project (internal, future).

## Navigation, before and after

**Before:** Dashboard, Proposals, Clients, Pipeline, Projects, Portfolio
(main sidebar) + Members, Proposal Settings, Profile (admin).

**After:**

| Area | Items |
|---|---|
| Main sidebar | Dashboard, Proposals, Clients, Portfolio |
| Administration (sidebar, visually separate) | Members, Proposal Settings, Profile |
| Mobile bottom nav (max 5 slots) | Home, Proposals, New *(proposal)*, Clients, More |
| "More" panel (mobile only, in-page disclosure — not a route) | Portfolio, Members, Proposal Settings, Profile, Sign out |

The primary CTA across the app is **New proposal** (dashboard header,
Client detail).

`src/app/(protected)/nav-items.ts`'s `buildNavItems()` no longer accepts
`canViewOpportunities`/`canViewProjects` flags at all — Pipeline and
Projects are gone from `main` unconditionally, not merely permission-gated
into invisibility. `layout.tsx` no longer fetches
`PERMISSIONS.OPPORTUNITIES_VIEW`/`PERMISSIONS.PROJECTS_VIEW` for
navigation purposes (those permission keys, and everything they gate at
the RLS/RPC layer, are untouched).

### The "More" panel, not a new route

The brief's recommended mobile IA (Home/Proposals/New/Clients/More, with
Portfolio + the admin group inside More) needs a fifth slot's worth of
destinations without exceeding 5 visible items and without adding a route
that doesn't already exist. `BottomNav` (`src/app/(protected)/bottom-nav.tsx`)
implements this as a client-side toggle: tapping "More" opens an in-page
panel (with a tap-outside-to-dismiss backdrop) listing links to routes
that were already reachable from the desktop sidebar, plus the existing
`signOutAction` form. No new page, no new route — every link in the panel
already existed.

This also fixes a real pre-existing gap, not introduced by this change:
before this panel existed, Members and Proposal Settings had **no mobile
entry point at all** (the sidebar containing them is `display: none`
below 900px, and the bottom nav never included the admin group). The
"More" panel is the first way to reach them from a phone-width viewport.

## Pipeline: removed everywhere

- `src/app/(protected)/pipeline/page.tsx` no longer renders the kanban
  board — it is now `redirect("/proposals")`. `quick-advance.tsx` (the
  kanban's status-change control, used nowhere else) was deleted as
  orphaned code.
- Removed from: the sidebar/bottom-nav (via `nav-items.ts`), the
  Dashboard's "View pipeline" secondary CTA and its Kanban-icon metric
  tile (`src/app/(protected)/page.tsx`), and the Opportunities list page's
  "Pipeline view" link and pipeline-referencing empty-state copy
  (`src/app/(protected)/opportunities/page.tsx`).
- `/pipeline` redirects to `/proposals` rather than 404ing, since it may
  be bookmarked or linked from outside the app (the brief's explicitly
  preferred strategy).

## Projects: removed everywhere

- `src/app/(protected)/projects/page.tsx`,
  `projects/new/page.tsx`, `projects/[projectId]/page.tsx`, and
  `projects/[projectId]/edit/page.tsx` are all now unconditional
  `redirect("/proposals")` stubs — reachable by nobody, regardless of
  permission, rather than showing a permission-denied page to some users
  and real project data to others. `project-form.tsx`,
  `[projectId]/status-actions.tsx`, and `[projectId]/addresses-section.tsx`
  (the UI components those pages rendered, used nowhere else) were
  deleted as orphaned code.
- Removed from: the sidebar/bottom-nav, the Dashboard, and — going further
  than a simple nav-item removal —:
  - **Client detail** (`clients/[clientId]/page.tsx`): the standalone
    "Projects" section is gone entirely (no historical-data carve-out was
    judged necessary — a client with an existing project can still be
    found via that project's own record if Projects UI is ever
    reintroduced; nothing is deleted from the database). The standalone
    "Opportunities" section is *also* removed, per the brief's explicit
    instruction that Opportunity "doesn't need to appear as a prominent
    module" on Client detail — it remains reachable as internal context
    from within a Proposal (`proposal.opportunity_id`), just not as its
    own section here. Client detail's primary action is now **Create
    proposal**, and a new **Proposals** section (number, title, status,
    total, and a "+ New proposal for this client" link) replaces both
    removed sections.
  - **Opportunity detail** (`opportunities/[opportunityId]/page.tsx`):
    the "Converted to project: [link]" info block and the entire "Legacy
    flow: convert directly to a project" section (including the
    `ConvertToProjectForm` component, now deleted as orphaned) are
    removed, per the brief's explicit instruction to remove Projects
    from Opportunity detail. **This is a deliberate reversal of the
    Phase 2A decision** (docs/29) to keep "Convert to project" as a
    demoted secondary action here — this brief supersedes that choice.
    The Proposal section (create/open proposal) remains, unchanged, as
    the page's primary action.
- `/projects` and every child route redirect to `/proposals` rather than
  404ing, for the same bookmarked-link reasoning as Pipeline.

## What was deliberately kept

Per the brief's explicit restrictions, none of the following changed:

- The `projects` and `opportunities` tables, their columns, their RLS
  policies, or their foreign keys.
- Every project/opportunity `SECURITY DEFINER` function —
  `create_project`, `update_project`, `archive_project`,
  `restore_project`, the address functions, `convert_opportunity_to_project`,
  `create_project_from_accepted_proposal`, the full Opportunity status
  machine — all unchanged and still fully callable.
- `tests/rls/phase1-crm.test.ts` and `tests/rls/phase1-restore.test.ts` —
  the ~19 test cases that call these RPCs directly (bypassing the UI
  entirely) are untouched and still pass, and remain the authoritative
  backend coverage for this functionality now that no UI exercises it.
- `src/actions/projects.ts` and `convertOpportunityAction`
  (`src/actions/opportunities.ts`) — the Server Action wrappers around
  these RPCs are left in place, unreferenced by any current UI, as the
  legacy/internal-only surface the brief describes ("Projects quedará
  como infraestructura interna/futura").
- `Opportunity` remains a first-class entity related to both Client and
  Proposal (every proposal still has an `opportunity_id`, auto-created
  when a proposal is created directly) — only its *own* dedicated list
  and detail-page prominence changed.

## Legacy routes: exact behavior

| Route | Behavior |
|---|---|
| `/pipeline` | `redirect("/proposals")`, unconditional |
| `/projects` | `redirect("/proposals")`, unconditional |
| `/projects/new` | `redirect("/proposals")`, unconditional |
| `/projects/[id]` | `redirect("/proposals")`, unconditional (works for any id, including one that doesn't exist — no information about a project's existence leaks through the redirect) |
| `/projects/[id]/edit` | `redirect("/proposals")`, unconditional |

None of these check any permission before redirecting — the module is
gone for every role, not permission-gated into invisibility for some
roles and still-visible for others.

## Tests updated

Per the brief's explicit instruction to adapt (not simply delete) any
Phase 1 E2E test that assumed Pipeline/Projects UI visibility, while
preserving all backend/RLS coverage:

- `tests/e2e/pipeline.spec.ts` and `tests/e2e/pipeline.mobile.spec.ts` —
  fully rewritten from kanban-UI tests into: `/pipeline` redirects
  correctly (desktop and mobile viewport), Pipeline is absent from the
  sidebar/bottom-nav/More panel, and the Opportunities list page no
  longer links to it.
- `tests/e2e/projects.spec.ts` — fully rewritten from Projects-CRUD-UI
  tests into: all four legacy routes (including a stale `/projects/[id]`
  and `/projects/[id]/edit` with a nonexistent UUID) redirect correctly,
  Projects is absent from the sidebar, Client detail has no Projects
  section and shows "Create proposal" as its primary action, and
  Opportunity detail has no "Convert to project" CTA.
- `tests/e2e/permissions.spec.ts`:
  - "can view clients/opportunities/projects" → renamed and adapted to
    check Proposals instead of Projects.
  - "direct URL access to creation routes redirects away" → the
    `/projects/new` assertion now expects a redirect to `/proposals`
    instead of a permission-denied `/projects` page.
  - Sales' "can create a project but has no update controls" test is
    **removed, not adapted** — its UI is gone for everyone regardless of
    permission, so there is nothing left to differentiate by role at the
    UI layer. The equivalent permission differentiation for the new
    primary workflow already exists in `tests/e2e/proposals.spec.ts`
    ("Proposals — Sales permissions"); the backend-only check
    (`tests/rls/phase1-crm.test.ts`, "Sales can create a project but
    cannot update it") is untouched.
  - Field Worker's tenant-wide-visibility test is **adapted, not
    dropped**: it now demonstrates the same underlying claim (Field
    Worker sees a resource tenant-wide, not assignment-scoped) using a
    Proposal instead of a Project, since Field Worker has `proposals.view`
    under the new permission matrix. See "Known limitations" below for
    what this adaptation could *not* preserve.
- `tests/e2e/proposals.spec.ts` — new `describe("Job summary
  (update_proposal_scope)")` (see docs/37) with 2 cases, and the existing
  "full builder flow" test is otherwise unchanged.

## Known limitations

**A real, honestly-reported regression, not a fixed one:** Field Worker's
Phase 1 role description ("Views assigned projects in the field") and its
`notes.create`/`projects.view` permission grants are unchanged at the
database level, but Field Worker now has **no UI surface at all** to
exercise `notes.create` — their only Phase 1 entry point for it was the
Project detail page (the only resource type they could view), and that
page no longer renders for anyone. Adding a Notes section to Proposal
detail (which has none today) to compensate would be new functionality
outside this fix's explicit scope, so it was not done. This is flagged
here rather than silently absorbed, and the adapted E2E test for Field
Worker (above) intentionally does not assert an "add a note" capability
that no longer exists in the UI.

The pre-existing "no per-assignment RLS" limitation (docs/20, carried
through every phase since) is unchanged by this work.
