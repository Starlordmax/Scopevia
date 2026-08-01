# 72 — Quick Create Client (from the Proposal form)

Status: **Implemented.** A user building a proposal no longer has to
abandon the form to go create a missing client first — a **"+ New
client"** action next to the Client selector on `/proposals/new` opens a
modal, creates the client, and returns straight to the in-progress
proposal with that client selected.

## Root implementation

`src/app/(protected)/proposals/new/quick-create-client-modal.tsx` — a
native `<dialog>` (`showModal()`/`close()`: built-in focus trap,
Escape-to-close, `::backdrop` dimming, no extra dependency), portalled to
`document.body` via `createPortal`. The portal is necessary, not
cosmetic: the modal's trigger button lives inside the New Proposal page's
own `<form>`, and the modal's own internal `<form>` (its Client type/
First name/Last name/Email/Phone fields) would otherwise be a DOM
descendant of that outer form — a `<form>` nested inside another `<form>`
is invalid HTML, and React warns/misbehaves on it. Portalling the dialog
out to `document.body` keeps only a plain `<button type="button">` inside
the outer form (no nesting problem) while the dialog's own form lives
entirely outside it.

The modal calls `createQuickClientAction()` (`src/actions/clients.ts`)
directly as an async function — not bound to a `<form action>` — so it
can return the created client's `{id, displayName}` to the caller instead
of redirecting away from the proposal form (the general `/clients/new`
flow's `createClientAction()` redirects to `/clients/[id]`, which would
throw away everything already typed into the proposal).

On success, the browser navigates to
`/proposals/new?clientId=<new>&created=1` — the *same* mechanism
`ClientSelect`'s own `onChange` already used for ordinary client
switching (see `client-select.tsx`). This was a deliberate choice over
inventing new client-side state to splice the new client into the options
list: reusing the existing, already-shipped, already-tested mechanism
means the new client is guaranteed to be a real server-refetched option
(`getClientOptions()` re-runs), not an optimistic guess that could drift
from what the database actually has.

### A real bug found and fixed during implementation

`ClientSelect`'s `<select>` used `defaultValue={defaultClientId}` — an
**uncontrolled** element. `defaultValue` is only applied once, at mount.
When a user manually picks a different client from the dropdown, the
browser's own native interaction updates the DOM immediately, so this was
never noticed. But Quick Create Client's `router.push()` changes
`defaultClientId` via a **prop update on an already-mounted component
instance** — no direct user interaction with the `<select>` itself — so
the DOM's selection never actually changed; the dropdown silently
reverted to its placeholder even though the URL and the rest of the page
correctly reflected the new client. Caught by the permanent E2E test
(not by manual testing, which was misled by loose text-matching — the new
client's name appears in the page's `innerText` regardless of whether its
`<option>` is actually selected). Fixed with `key={defaultClientId}` on
the `<select>`, which forces a remount (and therefore a fresh application
of `defaultValue`) whenever the selected client changes from outside a
direct interaction with the control.

## Data model behavior

No schema changes. Reuses `public.clients` / `public.client_contacts`
and the existing `create_client()` / `create_client_contact()` RPCs
exactly as the general `/clients/new` form does.

- **Individual**: `create_client()` with `client_type='individual'`,
  `display_name = "<First> <Last>"`, `first_name`/`last_name`/`email`/
  `phone` saved directly on the `clients` row — matches the existing
  model's own convention (individual clients typically have zero
  `client_contacts` rows; their own fields suffice, per that table's own
  schema comment).
- **Business**: the `clients` table has no dedicated "company name"
  field — the general `/clients/new` form already handles this by simply
  using `display_name` freeform (e.g. "Acme Property Management") when
  `client_type='business'`, with First/Last name fields hidden entirely
  in that case. The Quick Create modal's fixed field set (Client type,
  First name, Last name, Email, Phone — no separate company-name field)
  doesn't have a company name to use, so — a deliberate, documented
  choice, not an oversight — `display_name` falls back to `"<First>
  <Last>"`, the same formula as Individual. To still capture that this
  is a named PERSON at the business, that same First/Last name is
  **additionally** registered as the client's primary `client_contacts`
  row (`is_primary=true`), best-effort: if that second RPC call fails for
  any reason, the client itself is already valid and selectable, so the
  action still reports success.

`buildQuickClientDisplayName()` (`src/lib/crm/quick-client.ts`) is the
pure, unit-tested formula both paths share.

## UI changes

- **Trigger**: "+ New client" button next to the Client `<select>`,
  inside a `.tenant-form` (already `flex-wrap: wrap`, so it drops below
  the selector on narrow viewports without any new mobile-specific CSS).
- **Modal**: title "Create new client"; fields Client type (Individual /
  Business select), First name, Last name, Email, Phone; Cancel / Create
  client buttons. New `.modal`/`.modal-title`/`.modal::backdrop` CSS
  (`src/app/globals.css`), sized `min(480px, 100vw - 32px)` with its own
  scroll for tall content — no separate mobile stylesheet needed.
- **Success**: modal closes; a `.success-banner` ("Client created and
  selected.") appears on the proposal form itself (driven by the
  `?created=1` query param, read via `useSearchParams()` — not local
  component state, so it survives the navigation naturally); the new
  client is pre-selected; any already-typed proposal title/service type
  is untouched.
- **Errors**: rendered inside the modal (`.error-banner`), modal stays
  open so the user can correct and resubmit without re-entering already-
  typed fields.

## Validation / security

- **Permissions**: `clients.create` — reused unchanged from Phase 1.
  Owner/Admin/Estimator/Sales can quick-create a client; Viewer and Field
  Worker cannot (Field Worker doesn't have `proposals.create` either, so
  it can't reach `/proposals/new` in the first place). No new permission
  key was added.
- **Tenant isolation**: `createQuickClientAction()` validates
  `tenantId` as a UUID, then calls `requirePermission(tenantId,
  clients.create)` before ever touching the database; `create_client()`
  itself independently re-checks the same permission via
  `user_has_permission()` inside a `SECURITY DEFINER` function — the
  authoritative boundary, not just an app-layer convenience check. A
  cross-tenant insert attempt (a user who isn't a member of the target
  tenant) is rejected by `create_client()` regardless of what the client
  claims.
- **Field validation** (`quickCreateClientSchema`,
  `src/lib/validation/crm.ts`): Client type must be `individual` or
  `business`; First/Last name required (trimmed, max 80 chars); Email
  required AND must be a valid email format (stricter than the general
  `/clients/new` form, where email is optional and format is
  intentionally unenforced — see that schema's own comment,
  "CRM-006... don't block legitimate contractors over formatting"); Phone
  required (max 30 chars, no format enforcement, consistent with the rest
  of the app). This is a deliberate, scoped-to-this-modal exception: a
  client added through the fast path should always have a usable contact
  channel, without changing the general model's own leniency elsewhere.
- **Duplicate email**: best-effort, tenant-scoped lookup
  (`clients` `WHERE tenant_id = ... AND lower(email) = lower(...) AND
  archived_at IS NULL`) run via the caller's own RLS-gated session before
  calling `create_client()`. Not atomic — a genuine race between two
  simultaneous quick-creates with the same email could both pass this
  check — accepted as a known limitation (see below) rather than adding a
  new unique constraint that would also change the general form's
  already-lenient, already-shipped behavior.
- **Error messages**: never SQL, RPC names, UUIDs, stack traces, or
  permission keys — `friendlyRpcErrorMessage()` (existing helper) plus
  three purpose-written messages: "Please enter a valid email address."
  (schema-level), "This email is already associated with an existing
  client." (duplicate check), "We couldn't create the client right now.
  Please try again." (unexpected/unhandled failure — the whole body of
  `createQuickClientAction()` is wrapped in `try/catch`, matching the
  defense-in-depth pattern established in
  [docs/71](71-logo-upload-crash-fix.md): an unexpected exception must
  never propagate to Next.js's own error boundary).

## Tests

- **Unit**: `tests/unit/quick-client.test.ts` (display-name formatting),
  `tests/unit/quick-create-client-validation.test.ts` (schema: valid
  individual/business, missing/invalid fields, exact friendly email
  message, whitespace trimming). 12 new, 289/289 total passing.
- **RLS/integration**: `tests/rls/quick-create-client.test.ts`, 11/11
  passing against real Postgres — Owner/Admin/Estimator/Sales can
  create, Viewer and Field Worker cannot, a cross-tenant insert is
  blocked, a newly-created client is immediately visible to its own
  tenant, the tenant-scoped duplicate-email lookup query is verified
  directly (finds an in-tenant match, does NOT find a same-email client
  in a different tenant), and a Business client's contact registration
  is verified.
- **E2E desktop**: `tests/e2e/quick-create-client.spec.ts`, 12/12 —
  full happy path (create → auto-select → build and save the proposal →
  confirm the proposal actually belongs to that client), the Business-
  type display-name fallback, typed-data survival, Cancel, duplicate
  email, native browser email validation, and a Viewer-permission check.
  Run against BOTH `npm run dev` and a real `npm run build && npm start`
  production server (the same discipline established in
  [docs/71](71-logo-upload-crash-fix.md), after a prior feature's crash
  was only reproducible under a production build) — passing in both.
- **E2E mobile**: `tests/e2e/quick-create-client.mobile.spec.ts` (390×844)
  — modal usable, no horizontal overflow at any step, new client ends up
  selected.
- Full regression pass: `clients.spec.ts`, `proposals.spec.ts` — two
  pre-existing, unrelated failures on the first parallel run (client
  archive/restore; a "Danger zone" timeout deep in an unrelated builder
  flow) reproduced as passing when re-run in isolation, consistent with
  this project's already-documented parallel-load E2E flakiness pattern
  — not caused by this change.

## Files created

- `src/app/(protected)/proposals/new/quick-create-client-modal.tsx`
- `src/lib/crm/quick-client.ts`
- `tests/unit/quick-client.test.ts`
- `tests/unit/quick-create-client-validation.test.ts`
- `tests/rls/quick-create-client.test.ts`
- `tests/e2e/quick-create-client.spec.ts`
- `tests/e2e/quick-create-client.mobile.spec.ts`
- `docs/72-quick-create-client.md` (this file)

## Files modified

- `src/actions/clients.ts` — new `createQuickClientAction()`.
- `src/lib/validation/crm.ts` — new `quickCreateClientSchema`.
- `src/app/(protected)/proposals/new/new-proposal-form.tsx` — renders the
  modal trigger and the `?created=1` success banner.
- `src/app/(protected)/proposals/new/client-select.tsx` — `key={defaultClientId}`
  fix (see "A real bug found and fixed during implementation" above).
- `src/app/globals.css` — `.modal`/`.modal-title`/`.modal::backdrop`,
  `.success-banner` (if not already present from a prior phase).
- `CHANGELOG.md`, `README.md`, `docs/34-proposal-builder-ux.md`,
  `docs/29-proposal-centric-product-pivot.md`,
  `docs/20-phase-1-crm-and-projects.md`.

## Known limitations

- **No dedicated "company name" field.** Business clients created this
  way get `display_name = "<First> <Last>"` (the contact person's name),
  not a real business name — a known, documented gap, not an oversight.
  A future pass could add a `company_name`-style field to the modal (and,
  if desired, to the underlying `clients` model) specifically for this
  case.
- **Duplicate-email check is best-effort, not atomic.** A real race
  between two simultaneous quick-creates with the same email could both
  succeed. Low-likelihood in this fast-path modal's actual usage pattern;
  not addressed with a new database constraint in this pass, since that
  would also change the general `/clients/new` form's already-shipped,
  intentionally lenient behavior.
- **No secondary phone, website, tax-exempt, preferred-contact-method, or
  source fields** — the modal is deliberately minimal, matching the
  brief's fixed field list. All of those remain editable afterward from
  the client's own detail page.
- **No AI, no payments, no Client Portal changes** — out of scope per the
  brief, and untouched.
