# 75 — Global Required-Field Validation with Red Highlighting

Status: **Implemented.** Extends the field-level red-state validation
pattern introduced for Measurements/address forms in
[docs/74](74-custom-service-name-and-multistroke-drawing.md) to
**every** form in the app that has a required or validatable field —
Sign in/up, Forgot/Reset password, Profile, Members/invitations,
Clients, Quick Create Client, Opportunities, Proposal creation, every
step of the Proposal Builder (Measurements, Scope, Materials & Costs,
Labor, Photos, Settings), the Client Portal (request code, verify,
accept/decline), business logo upload, Portfolio, and Notes.

## The problem

Before this pass, most forms fell into one of two buckets:

1. **Native `required`** — the browser's own unstyled popup blocked
   submission before the Server Action ever ran. Consistent across
   browsers only in the loosest sense (no shared visual language with
   the rest of the app), never reachable by keyboard-only flows in a
   predictable way, and — critically — it meant an empty/invalid field
   never even reached the server-side validation and error-message
   logic that already existed for many of these same fields.
2. **A single generic `.error-banner`** — informative, but the user
   still has to hunt for which field it's actually about, especially
   on a long form (Proposal Settings, Labor, Materials & Costs).

Neither ever highlighted the offending field itself, and neither was
consistent across the app: Measurements had already been fixed
(docs/74); nearly everything else hadn't.

## The pattern (unchanged from docs/74, now applied everywhere)

- **`src/components/form-field-error.tsx`** — the single shared
  primitive set:
  - `fieldErrorProps(fieldErrors, id)` — spreads `className`,
    `aria-invalid`, `aria-describedby` onto an input/select/textarea
    when `fieldErrors[id]` exists; returns `{}` otherwise (never marks
    a field invalid for a different field's error).
  - `<FieldError fieldErrors id />` — renders the red message
    (`role="alert"`, `id="{id}-error"`) directly under the field, or
    nothing if there's no error for that id.
  - `useFocusFirstFieldError(fieldErrors)` — moves focus to the first
    invalid field whenever a *new* `fieldErrors` object arrives from a
    Server Action round-trip, so the user's cursor lands on what needs
    fixing without depending on a toast. Looks up by `id` first,
    falling back to `[name="..."]` for the rare field whose form `name`
    differs from its `id` (documented per-callsite where used).
- **`src/lib/validation/field-errors.ts`**:
  - `zodIssuesToFieldErrors(zodError)` — maps every Zod issue to
    `{ fieldName: message }` (first issue per field wins).
  - `attributeRpcErrorToField(message, mapping)` — an ordered
    substring→field-name mapping for the handful of validation rules
    that only the SQL layer can know (e.g. "Close the shape before
    saving an area measurement").
- **Convention**: a field's key in `fieldErrors` matches its input's
  `id` (and usually its `name`). Where a schema's field name differs
  from an existing DOM id/name (e.g. Labor's `rate` input maps to the
  schema's `rateCents`), the **id** was renamed to match the schema
  field, not the other way around — `fieldErrorProps`/`FieldError`
  both key off that id, and renaming it (rather than inventing a
  parallel lookup mechanism) keeps the convention exception-free.
- **`required` is removed** wherever a field is wired this way — the
  two mechanisms are mutually exclusive: a `required` attribute blocks
  the native `<form>` submission (and therefore the Server Action)
  entirely, so an empty field can never reach the styled UI it's
  supposed to trigger.
- **General vs. field error**: a Server Action's `error` message (top
  banner) and its `fieldErrors` (inline, red) are complementary, not
  alternatives — both can and often do render at once for the exact
  same failed submit (the banner says something went wrong, the field
  says specifically what). Neither ever contains a raw SQL/RPC
  message, a Postgres function name, or a permission key —
  `friendlyRpcErrorMessage()` (pre-existing) still sanitizes every
  RPC-layer error before it reaches either surface.

## Result-type widening

Most forms already used `ActionResult` (`{ error?; message?;
fieldErrors? }`, `src/actions/auth.ts`) — already `fieldErrors`-shaped
from earlier work. Two additional shapes needed widening, additively
(no existing `.error`-only caller broke):

- `PortalActionResult` (`src/actions/portal-visitor.ts`) — was
  `{ error? }`; now `{ error?; fieldErrors? }`.
- `QuickCreateClientResult` (`src/actions/clients.ts`) — a
  discriminated union called directly (not via `useActionState`,
  since Quick Create Client is a `<dialog>` with a manual
  `onSubmit`/async call); the `{ ok: false }` branch gained an
  optional `fieldErrors`.

## Two real bugs found and fixed along the way

1. **Opportunity status transitions were stricter in the UI than in
   the schema.** `changeOpportunityStatusSchema` allowed `lostReason`/
   `inspectionScheduledAt` to be omitted even though the *form* marked
   them `required` — meaning the only thing enforcing them was the
   browser popup this pass removes. Fixed with a `.superRefine()`
   requiring `lostReason` when `newStatus === "lost"` and
   `inspectionScheduledAt` when `newStatus === "inspection_scheduled"`,
   with friendly messages ("Tell us why this opportunity was lost.",
   "Choose an inspection date and time.") — the schema is now the
   actual source of truth, not the HTML attribute.
2. **A `<select>` submitted with nothing selected at all** (e.g. a
   client selector forced back to its disabled placeholder, or any
   non-browser POST) sends **no key at all** for that field, not an
   empty string — `formData.get(...)` returns `null`. A bare
   `z.string().uuid("Please select a client.")` only customizes the
   *format* failure; the *missing-value* failure fell through to Zod's
   own `"Invalid input: expected string, received null"` — exactly
   the kind of technical message this brief explicitly rules out.
   Fixed by also supplying the friendly text on the base type check:
   `z.string({ message: "Please select a client." }).uuid("Please
   select a client.")`, applied everywhere a client (or similar
   required relation) is selected via a `<select>`
   (`createOpportunitySchema`, `createProposalDirectSchema`).

## Known limitations

- **Projects module**: confirmed fully deprecated (`/projects*` routes
  all `redirect("/proposals")`) — no live forms exist there, so
  nothing was wired.
- **`convertOpportunityAction`** (opportunity → project conversion)
  was left untouched — it targets the deprecated Projects module and
  has no required fields blocking it today.
- A handful of **pre-existing, unrelated** E2E assertions were found
  broken incidentally while verifying this change (not caused by it):
  a `getByLabel("Client")` ambiguity against the Quick Create Client
  modal's own "Client type" label, present on any page that mounts
  both selectors (`business-branding.spec.ts`,
  `material-catalog.spec.ts` — fixed with `{ exact: true }`, matching
  what `quick-create-client.spec.ts` already did correctly). A wider
  sweep of the rest of the E2E suite for the same latent ambiguity was
  out of scope for this pass.
- `clients.spec.ts`'s "editing a client persists after reload" test
  intermittently times out waiting for `update_client()`'s redirect —
  reproduced identically on the pristine pre-session baseline (stashed
  this session's entire diff and re-ran it to confirm), so it predates
  this work. Consistent with this environment's already-documented
  Supabase-latency-under-concurrency flakiness (see docs/25, docs/73's
  own changelog note).
