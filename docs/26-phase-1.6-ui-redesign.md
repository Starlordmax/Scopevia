# 26 — Phase 1.6 UI/UX Redesign

Status: **A pure frontend/UX redesign of the Phase 1 shell and CRM screens.**
No database schema, RLS policy, PostgreSQL function, state machine,
permission semantics, or business rule changed. No new migrations. No Phase
2 functionality (Estimates, Measurements, Photos, Catalogs, Proposals,
Stripe, AI, etc.) was touched. Full verification (typecheck, lint, 64/64
unit, 95/95 RLS, 48/48 E2E, production build) is green after this work —
see "Verification" below.

## What changed

### Visual identity

- New design-token layer in `src/app/globals.css`: a defined palette
  (background/surface/sidebar/primary/accent/success/warning/danger/text/border),
  a typography scale (page title, section title, card title, body, small,
  label, metric), consistent border-radius and shadow tokens, replacing
  ad-hoc inline values used across the Phase 0/1 screens.
- Typography: Inter via `next/font/google` (self-hosted at build time, zero
  runtime request to Google, zero new dependency beyond `next` itself) —
  chosen over adding the separate `geist` package since Inter needed no new
  dependency at all.
- Icons: `lucide-react` added as the **only** new dependency (the app had no
  icon library before). Icons are always paired with text labels — sidebar
  nav, page headers, metric tiles, empty states — never used alone where
  meaning could be ambiguous.

### Navigation

Replaced the old top-nav-only shell with a workflow-oriented layout:

- **Sidebar** (desktop, `src/app/(protected)/sidebar-nav.tsx`): persistent
  left nav — Dashboard, Clients, Pipeline, Projects, Members — permission-gated
  the same way the old nav was, just visually promoted to a permanent rail.
- **TopBar**: tenant switcher (or plain tenant name for single-tenant users),
  signed-in user email, a Profile icon-link, Sign out.
- **BottomNav** (mobile, `src/app/(protected)/bottom-nav.tsx`): the same nav
  items as fixed bottom tabs below the 900px breakpoint, so core navigation
  never depends on a hamburger menu or horizontal scroll.

### Action-oriented pages

Every list page now has exactly one primary action via a shared
`PageHeader` component (`src/components/page-header.tsx`), which
deliberately only accepts one `action` slot (plus an optional lower-emphasis
`secondary` slot, e.g. Pipeline's "List view" link) — enforced by
convention/code review, not a runtime guard, since this is a two-person
internal codebase:

| Page | Primary action |
|---|---|
| Dashboard | + New opportunity |
| Clients | + New client |
| Pipeline | + New opportunity |
| Projects | + New project |
| Members | *(none — admin table, no single obvious create)* |
| Profile | *(none — a settings form)* |

### Empty states

Replaced bare "0" counters and empty tables with a shared `EmptyState`
component (`src/components/empty-state.tsx`) used across
Clients/Opportunities/Projects: an icon, what the module is for, and (where
the viewer has permission) a primary action to do something about it. Three
distinct variants per list page — "no results for this search", "no
archived records", "genuinely empty" — rather than one generic message.

### Layout width

Found and fixed a pre-existing bug (present since Phase 0, not introduced by
this redesign — confirmed against the very first baseline screenshot):
`.card` (480px max-width, correct for auth/profile-style narrow forms) was
being reused for full-width content — client/opportunity/project tables,
detail-page sections, multi-column create/edit forms — producing badly
cramped layouts. Introduced two new width tiers instead of overloading
`.card`:

- `.section-card` — no max-width; detail-page sections and table wrappers.
- `.form-card` — 640px max-width; create/edit forms with multi-column rows.
- `.card` stays unchanged and narrow for what it was always right for: auth
  pages, Profile, and item cards (`li.card`, given its own `max-width: none`
  override so it fills its list without affecting the narrow default).

### Status badges

Extracted `opportunityBadgeClass()` / `projectBadgeClass()`
(`src/lib/crm/status-badge.ts`) mapping each status to a colored modifier
class (`badge-success` / `badge-warning` / `badge-danger` / `badge-neutral`)
applied **alongside**, never instead of, the existing `.badge` class — E2E
tests locate badges via `.badge` + text content, so the base class had to
stay.

## Bugs found and fixed during this work

Per the redesign brief, bugs discovered while touching a screen were fixed
and are documented here rather than silently folded in.

1. **Serif fallback: the whole app was never actually rendering in Inter.**
   `globals.css` defined `--font-sans: var(--font-sans, ""), -apple-system, …`
   — a custom property referencing its own name inside its own declaration.
   CSS custom properties don't support this kind of self-reference; per spec
   a cyclic custom property is invalid at computed-value time, so the
   `font-family: var(--font-sans)` rule using it silently fell back to the
   browser's default serif font. This was **pre-existing**, not introduced
   by this redesign, and was only caught by comparing a real rendered
   screenshot against the intended sans-serif typography — a type checker
   or linter has no way to catch an invalid-at-runtime CSS custom property.
   Fixed by moving the fallback stack into its own
   `--font-sans-fallback` property and referencing it as `var()`'s second
   argument (`font-family: var(--font-sans, var(--font-sans-fallback))`),
   which only activates if `--font-sans` (supplied by `next/font`'s
   `inter.variable` class on `<html>`) is genuinely absent.

2. **Buttons rendered as `<Link>` never got the shared button box model.**
   The shared button rule was `button, .button { … }`, which does not match
   an element whose class is `button-primary`/`button-secondary`/`button-danger`
   (CSS class selectors require an exact class-name token match). A real
   `<button>` got the shared styles via the `button` *tag* selector, masking
   the bug for genuine buttons, but any `<Link>` (renders as `<a>`) styled
   with one of those classes only ever matched its own color/background
   rule — never the shared `display: flex; padding; min-height` etc. Result:
   undersized, overflowing, underlined link-buttons site-wide. Confirmed
   pre-existing by checking the original baseline screenshot, which shows
   the identical artifact under the pre-redesign CSS. Fixed by listing all
   four class variants explicitly in the shared selector and adding the
   missing `text-decoration: none`.

3. **`.card`'s 480px max-width was applied to full-width content everywhere**
   (see "Layout width" above) — also pre-existing, also only visible once
   real screenshots were compared against intent rather than reading the
   class name in isolation.

None of the above required a database change, a permission change, or any
change to `tests/rls/*` — they were markup/CSS-only.

## Test regression introduced and fixed during this work

Redesigning the shell changed two things the existing E2E suite asserted
on directly, both intentional UX decisions:

- The Dashboard `<h1>` no longer shows the tenant name (it now just says
  "Dashboard" — tenant identity lives in the topbar, shown on every page,
  so repeating it in the page title was redundant). `tests/e2e/auth.spec.ts`
  and the tenant-switching test in `tests/e2e/permissions.spec.ts` were
  updated to check the topbar's tenant switcher (`option:checked`) instead
  of a heading.
- The client-detail Activity section's wrapper class changed from `.card`
  to `.section-card` (see "Layout width"). `tests/e2e/notes-activities.spec.ts`
  updated its locator accordingly.

Fixing the tenant-switching assertion surfaced a **real, pre-existing race
condition in the test itself** (not a product bug): `switcher.selectOption()`
writes the `<select>`'s DOM value and fires `change` synchronously, but the
`onChange` handler's `form.requestSubmit()` — bound to a Server Action —
completes asynchronously via a client-side router update, never a hard
navigation. `page.waitForLoadState("load")` therefore never observes a new
`load` event (none fires), and checking `option:checked` right after only
proves Playwright's own DOM write is still there, not that the server
processed the switch. Both looked like valid synchronization points and
both passed instantly while the actual `switchTenantAction` round trip
(which sets the active-tenant cookie) was still in flight, letting the
test's very next `page.goto("/clients")` race ahead of the cookie — it
loaded under the *old* tenant and the assertion correctly caught the
resulting stale data. Fixed by polling the active-tenant cookie itself
(`page.context().cookies()`) until it holds the target tenant's id before
proceeding — the only signal actually tied to the server having completed
the switch. Verified stable across 15 repeated runs (`--repeat-each=5` × 3
tenant-switching tests) with zero failures, plus a full 48/48 E2E run.

## Verification

| Check | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm run lint` | clean |
| `npm run test` (unit) | 64/64 |
| `npm run test:rls` | 95/95 (one run showed an unrelated flaky concurrency test — "exactly one of two concurrent demotions… is rejected" — which passed on immediate retry; not touched by this redesign, no RLS/permission code was changed) |
| `npm run build` | succeeds, all routes compile |
| `npx playwright test` (E2E) | 48/48, including a stability run of the tenant-switching tests at `--repeat-each=5` |

## Out of scope (deliberately not done)

- No Phase 2 functionality.
- No new database migrations.
- Sub-components that render inside already-redesigned section/form cards
  (contacts/addresses/notes sections, member row, invite form, status
  actions, convert form, search form, pagination) were left as-is — they
  inherit the new tokens automatically through the shared `.button-*`,
  `.badge`, `.field`, `.hint` classes and needed no markup changes.
- Onboarding and select-tenant pages keep the narrow `.card` — their content
  (a short business-switcher list, an invitation list) is genuinely
  auth-adjacent and narrow-appropriate, not an instance of the width bug
  described above.
