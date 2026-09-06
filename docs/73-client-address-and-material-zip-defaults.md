# 73 — Client Address + Material ZIP Defaults

Status: **Implemented.** The New Client form (and the Quick Create
Client modal) now capture a real street address instead of a free-text
`Website` field, and a client's saved ZIP code automatically becomes the
default pricing ZIP for any new proposal built for that client —
pre-filled in Materials & Costs, with the catalog search using it
immediately. A manual ZIP change in Materials & Costs is never
overwritten again.

> **Doc numbering note:** the originating brief suggested `docs/69` for
> this write-up. By the time this phase started, `docs/69`–`72` were
> already taken by three prior items completed earlier in this same
> session (logo upload crash fix, logo 10 MB limit fix, Quick Create
> Client). This is `docs/73`, the actual next free number — the same
> stale-suggestion pattern already noted in this project's history.

## Root implementation

### Data model: Option A (plain columns), not a new table

Six nullable columns added directly to `clients`: `address_line_1`,
`address_line_2`, `city`, `state`, `postal_code`, `country_code`
(`supabase/migrations/20260730100000_client_address_columns.sql`),
naming and CHECK conventions mirrored from the existing
`project_addresses` table (Phase 1) — the established precedent for
address storage in this codebase:

- `clients_state_check`: `char_length(btrim(state)) between 2 and 40`
  (when present).
- `clients_postal_code_check`: `postal_code ~ '^[A-Za-z0-9 -]{3,12}$'`
  (when present) — deliberately lenient/international at the SQL layer;
  the stricter US-specific `12345`/`12345-6789` format is enforced one
  layer up, only when `country_code` is US (see "Validation" below).
- `clients_country_code_check`: `char_length(country_code) = 2` (when
  present).

**Option B (a new `client_addresses` child table, mirroring
`project_addresses`) was explicitly available per the brief and
deliberately not taken.** This phase is in scope for exactly one address
per client — the brief's own explicit restriction is "no complex
multi-address management (unless already exists)," and no multi-address
UI was requested. A new child table would add a join, a
one-address-per-client uniqueness rule to invent and maintain, and RLS
policies to duplicate — for zero behavioral benefit at this scope. If a
future phase needs multiple addresses per client (billing vs. job site,
multiple properties, etc.), that's the point at which promoting these
columns into a real `client_addresses` table (with a migration that
moves the existing single row into it) becomes justified — not before.

### `website`: column kept, hidden only from the create UI

The brief was explicit: never physically drop the `website` column,
only remove/deprecate it from the UI. Implementation:

- `clients.website` — untouched in the database.
- `createClientSchema` / `create_client()` RPC — `website` is still a
  valid, accepted field (unchanged wire format), just no longer
  collected by the New Client form or the Quick Create modal.
- `ClientForm` (`src/app/(protected)/clients/client-form.tsx`) — the
  Website field now renders only `{isEdit && client?.website ? (...) :
  null}`: **hidden entirely on create**, but still visible and editable
  in **edit** mode for any client that already has a legacy value. This
  is deliberate asymmetry, not an inconsistency — the goal is "don't
  silently null out a value a user already has" balanced against
  "don't offer a field the product no longer wants people filling in."

### A real bug found during E2E testing (and fixed)

The client detail page (`src/app/(protected)/clients/[clientId]/page.tsx`)
originally called `formatClientAddress(client)` — passing the **raw
Supabase row**, whose columns are snake_case (`address_line_1`,
`postal_code`, …) — directly into a function typed to expect **camelCase**
fields (`addressLine1`, `postalCode`, …). TypeScript's excess-property
check only fires on object literals, not on a variable being passed
where a structurally-compatible (looser) type is expected, so this
compiled cleanly. `city` and `state` happen to be spelled identically in
both naming schemes, so those two fields displayed correctly — masking
the bug — while `address_line_1`/`postal_code` silently read as
`undefined` inside the formatter and never appeared. The Postgres/RPC
layer was correct the entire time (proven independently by
`tests/rls/client-address-and-zip.test.ts`'s first test, which calls
`create_client()` directly and asserts both fields are persisted).
Fixed by mapping the DB row's snake_case fields to
`formatClientAddress()`'s camelCase input shape at the one call site,
computed once as `clientAddress` before the JSX return. Caught by the
project's own end-to-end test, not by code review — a good example of
why this codebase insists on real E2E coverage for anything
display-related, not just schema/RPC-level RLS tests.

## Data model

```text
clients
  ├─ address_line_1 / address_line_2   (nullable, free text)
  ├─ city / state                       (nullable, free text)
  ├─ postal_code                        (nullable; US format enforced
  │                                       only when country_code is US
  │                                       or absent)
  └─ country_code                       (nullable, 2-letter; defaults to
                                          "US" in the UI, not the DB)

proposal_versions
  └─ pricing_zip_code / pricing_state_code / pricing_city   (pre-existing,
     Phase 2B — unchanged; still the sole source of truth for Materials
     & Costs pricing, still only ever written by
     update_proposal_pricing_zip())
```

No new tables. No changes to `project_addresses`, `client_contacts`, or
any Client Portal table.

## Autocomplete strategy

Per the brief's explicit permission to defer the provider if it adds too
much complexity: **no autocomplete provider is wired up in this phase.**
The UI is structurally ready for one without requiring any markup
changes later:

- `src/lib/address/autocomplete-provider.ts` —
  `resolveAddressAutocompleteProvider(rawProvider, hasApiKey)` is a
  pure function: returns `"google_places"` only when
  `NEXT_PUBLIC_ADDRESS_AUTOCOMPLETE_PROVIDER=google_places` **and** a
  key is present; `"none"` in every other case (unset, unrecognized
  provider name, or provider set but no key — never crashes, never
  blocks the form).
- `src/components/address-fields.tsx` — the shared `<AddressFields>`
  component (used by both the New Client form and the Quick Create
  modal) calls this resolver and stamps the result onto the street
  address input as `data-address-autocomplete="none"` /
  `"google_places"` — a stable hook point a future integration can
  query for (`document.querySelector('[data-address-autocomplete]')`)
  without touching this component's structure again.
- No client-side script, no Google Maps/Places SDK load, no network
  call to any autocomplete provider exists anywhere in this phase — the
  street address input is a completely ordinary text input today.
- **No `place_id` or any provider-specific identifier is stored
  anywhere** — there is no column for one. Only the normalized address
  fields themselves (`address_line_1`, `city`, `state`, `postal_code`,
  `country_code`) would ever be written, whether typed manually (today)
  or filled by a future autocomplete selection.
- **No secret key is ever read client-side.** Only
  `NEXT_PUBLIC_ADDRESS_AUTOCOMPLETE_PROVIDER` and
  `NEXT_PUBLIC_GOOGLE_PLACES_API_KEY` exist as env vars for this
  feature — both `NEXT_PUBLIC_*` by necessity (an actual autocomplete
  widget runs in the browser), both optional, both unset in this
  phase's `.env.local`/Render config. A real Google Places API key, if
  ever configured, must be restricted by HTTP referrer in the Google
  Cloud Console — documented as a requirement in
  [docs/65](65-render-environment-variables.md), not enforced by this
  codebase (it can't be — that restriction lives entirely on Google's
  side).
- **Render never breaks if these vars are absent.** Both are read only
  through `resolveAddressAutocompleteProvider()`, which treats "unset"
  as its default, safe `"none"` case — no boot-time validation, no
  `instrumentation.ts` check, nothing that could fail a health check
  over a missing optional var.

## Proposal ZIP behavior

`create_proposal_direct()` already fetched the full client row
(`v_client`) for validation before this phase — the only change needed
was passing `v_client.postal_code` through to its existing internal
helper:

```text
create_proposal_direct()
  → create_initial_proposal_version(tenant, proposal, actor, v_client.postal_code)
      → normalizes: substring(p_pricing_zip_code from 1 for 5) ~ '^\d{5}$'
        ? that 5-digit substring : null
      → inserts proposal_versions.pricing_zip_code
```

`create_proposal_from_opportunity()` needed no separate change — it's a
thin wrapper that delegates entirely to `create_proposal_direct()`.

- **A client with a valid 5-digit (or ZIP+4) US postal code**: the
  first 5 digits become the proposal's `pricing_zip_code` immediately at
  creation. `"33101"` → `33101`; `"33101-4521"` → `33101`.
- **A client with a non-US-shaped postal code** (e.g. `"SW1A 2AA"`) or
  no postal code at all: `pricing_zip_code` stays `null` — normalization
  never raises an exception, so a legacy/foreign client address can
  never block proposal creation.
- **Materials & Costs** reads `proposal_versions.pricing_zip_code`
  first, exactly as it always has (Phase 2B, unchanged) — the "default
  from client" behavior lives entirely at proposal-creation time, not as
  a new fallback inside the Materials step itself. If a proposal's own
  `pricing_zip_code` is set, that's what's read; if `null`, the ZIP
  field is empty and the "Enter the job ZIP code…" hint shows, exactly
  as before this phase.
- **Manual override, never re-clobbered**: `update_proposal_pricing_zip()`
  (pre-existing, unchanged) is the *only* function that ever writes
  `pricing_zip_code` after creation. Because nothing else ever writes to
  that column post-creation, a manual change is automatically permanent
  with **no new tracking flag needed** — there was no risk of it being
  silently overwritten, because nothing else touches that column at all.
  Verified directly (RLS test) and end-to-end (E2E test): set a ZIP
  automatically from client 60601, manually change it to 10001, reload
  the page, confirm it's still 10001.
- **Copy shown** in Materials & Costs
  (`src/app/(protected)/proposals/[proposalId]/edit/step-materials.tsx`):
  "Using ZIP code from the client address. You can change it for this
  proposal." when `pricing_zip_code` is set; "Enter the job ZIP code to
  price materials for this area." when it's empty — verbatim per the
  brief.

### Explicitly deferred: per-proposal Job Address

Per the brief's own explicit instruction — "para materiales, el ZIP
correcto es el de la ubicación del trabajo, no siempre el del cliente…
No bloquees esta fase agregando un módulo completo de job sites" — this
phase uses the **client's** address as the default job ZIP, with a
manual override always available in Materials & Costs. **A proper
per-proposal Job Address (potentially different from the client's
billing/mailing address) is explicitly out of scope and deferred to a
future phase.** See "Known limitations" below.

## Quick create behavior

`QuickCreateClientModal` (`src/app/(protected)/proposals/new/quick-create-client-modal.tsx`)
renders the same `<AddressFields>` component as the New Client form,
positioned after the Phone field, with no Website field (matching the
general form). On submit, `createQuickClientAction()` passes the six
address fields through to `quickCreateClientSchema` and `create_client()`
exactly like `createClientAction()` does. The already-established Quick
Create flow (`docs/72`) — success → `router.push` to
`/proposals/new?clientId=<new>&created=1` → `ClientSelect`'s server
refetch picks up the real, newly-created row (including its address) →
the same `create_proposal_direct()` ZIP-defaulting path above applies
identically whether the client was created via the full `/clients/new`
form or the quick-create modal. No separate ZIP-wiring code was needed
for this path — it falls out of the existing "the proposal is created
against whichever client is currently selected" behavior.

Changing the selected client on the New Proposal form *before* clicking
"Save and continue" also changes which client's ZIP the eventual
`create_proposal_direct()` call will use — this was already true of
every other client-scoped field and required no new code.

## Validation / security

- **`src/lib/validation/crm.ts`**: shared `addressFieldsShape` (used by
  both `createClientSchema` and `quickCreateClientSchema`) —
  `addressLine1`/`addressLine2` (max 255), `city` (max 120), `state`
  (max 40), `postalCode` (max 20), `countryCode` (exactly 2 letters,
  defaults to `"US"` when omitted at the UI layer). All fields are
  **optional** — never required to create a client, per the brief
  ("never require autocomplete", "never block client creation if no
  provider configured" — extended here to "never block on address at
  all," matching the general form's existing philosophy of not gating
  client creation on complete data).
- **`refineAddressPostalCode()`** (a shared `.superRefine()` on both
  schemas): `postalCode` is checked against `US_ZIP_PATTERN =
  /^\d{5}(-\d{4})?$/` **only** when `countryCode` is `"US"` or omitted
  — any other `countryCode` accepts the postal code as free text,
  exactly per the brief ("no bloquear países no-US si country no es
  US"). Friendly message on failure: **"Please enter a valid ZIP
  code."** — verbatim per the brief, never a raw regex or SQL detail.
- **SQL-layer re-validation** (defense in depth, `create_client()` /
  `update_client()`): `p_postal_code !~ '^[A-Za-z0-9 -]{3,12}$'` raises
  `'Please enter a valid ZIP or postal code'` (errcode `22023`) — the
  same friendly-message pipeline (`friendlyRpcErrorMessage()`) surfaces
  this if it's ever reached directly (e.g. a future API caller that
  skips the Zod schema).
- **Generic save failure**: any other unexpected `create_client()`/
  `update_client()` error is mapped to **"We couldn't save the client
  address. Please try again."** by `friendlyRpcErrorMessage()` — never a
  raw SQL/RPC message, never a UUID, never a stack trace.
- **Permissions**: unchanged. Whoever can already create/update a
  client (`clients.create`/`clients.update` — Owner, Admin, Estimator,
  Sales) can now also set that client's address in the same action —
  no new permission key was added, matching the brief's explicit
  instruction. Viewer cannot create or update a client, so cannot set an
  address. Field Worker's access is unchanged from the existing model
  (no `clients.create`, so it can't reach either form).
- **Tenant isolation**: address fields ride inside the exact same
  `create_client()`/`update_client()` `SECURITY DEFINER` RPCs as every
  other client field — the same `user_has_permission(tenant_id, …)`
  check inside those functions is the authoritative boundary. A
  cross-tenant read or update of another tenant's client address is
  blocked by the pre-existing RLS policy on `clients`, unchanged by this
  phase — verified directly in `tests/rls/client-address-and-zip.test.ts`.
- **No PII exposure to the Client Portal** beyond what was already
  possible — this phase doesn't touch any Client Portal
  table/query/page. A client's own address was never exposed there
  before this phase and still isn't.

## Tests

- **Unit** (3 new files, `tests/unit/`):
  `address-autocomplete-provider.test.ts` (6 tests — provider
  resolution: unset, wrong name, right name without a key, right name
  with a key, unknown provider ignored),
  `client-address.test.ts` (6 tests — `formatClientAddress()`: full
  address, partial address, no address at all → `null`, non-US country
  code shown, US country code omitted, line1+line2 comma-joined),
  `client-address-validation.test.ts` (address/ZIP validation on both
  `createClientSchema` and `quickCreateClientSchema` — valid US ZIP,
  invalid US ZIP rejected with the exact friendly message, non-US
  country code + non-US-shaped postal code accepted, fully-empty address
  accepted). 311/311 unit tests passing project-wide after this phase
  (up from 289 before it).
- **RLS/integration**: `tests/rls/client-address-and-zip.test.ts`, 9/9
  passing against real Postgres — `create_client()` persists
  `address_line_1`+`postal_code` correctly when called directly (the
  test that proved the RPC layer was never the bug), Owner/Admin can
  create a client with an address, Viewer cannot, a malformed postal
  code is rejected with the friendly message (not a raw SQL error),
  cross-tenant address read/update is blocked, a valid US ZIP defaults
  onto a new proposal, a non-US-shaped ZIP does not (and does not
  crash), a ZIP+4 is normalized to 5 digits, a manual
  `update_proposal_pricing_zip()` override is never re-clobbered, and
  `search_material_catalog()` honors the proposal's saved ZIP.
- **E2E desktop**: `tests/e2e/client-address-and-zip.spec.ts`, 4/4 —
  full flow (Website gone → address+ZIP filled on New Client → address
  shown on the client detail page → new proposal for that client →
  Materials & Costs pre-filled with that ZIP → catalog search actually
  uses it), manual ZIP override surviving a page reload, a non-US postal
  code neither blocking client creation nor forcing a proposal ZIP, and
  Quick Create Client's ZIP flowing through the same path.
- **E2E mobile**: `tests/e2e/client-address-and-zip.mobile.spec.ts`
  (390×844), 2/2 — New Client and Quick Create Client address fields are
  both usable with no horizontal overflow.
- **Full regression pass** (after the display-bug fix): `npx tsc
  --noEmit` clean, `npx eslint .` clean, all 311 unit tests passing, and
  a serial (`--fileParallelism=false`) run of the full `tests/rls/`
  suite to avoid this environment's known Supabase Auth rate-limit
  flakiness under heavy RLS test parallelism — all green, including
  `quick-create-client.test.ts` and `phase1-crm.test.ts` (both of which
  regressed earlier in this session from the `create_client()`/
  `update_client()` duplicate-overload bug, now fixed — see "Files
  created," the two overload-fix migrations).

## Files created

- `supabase/migrations/20260730100000_client_address_columns.sql`
- `supabase/migrations/20260730100100_client_address_functions.sql`
- `supabase/migrations/20260730100200_proposal_zip_defaults_from_client.sql`
- `supabase/migrations/20260730100300_fix_client_functions_duplicate_overload.sql`
  — fixes a real regression the prior migration introduced (see
  "Known limitations" / the module comment inside the migration itself).
- `supabase/migrations/20260730100400_drop_orphaned_proposal_version_overload.sql`
  — hygiene-only follow-up (no functional bug existed here, but the same
  overload-duplication pattern was left in place and is fixed
  proactively).
- `src/lib/address/autocomplete-provider.ts`
- `src/components/address-fields.tsx`
- `src/lib/crm/address.ts`
- `tests/unit/address-autocomplete-provider.test.ts`
- `tests/unit/client-address.test.ts`
- `tests/unit/client-address-validation.test.ts`
- `tests/rls/client-address-and-zip.test.ts`
- `tests/e2e/client-address-and-zip.spec.ts`
- `tests/e2e/client-address-and-zip.mobile.spec.ts`
- `docs/73-client-address-and-material-zip-defaults.md` (this file)

## Files modified

- `types/database.ts` — `clients` Row/Insert/Update gain the six address
  columns; `create_client`/`update_client` Args/Returns extended;
  `create_initial_proposal_version` Args gains `p_pricing_zip_code`.
- `src/lib/validation/crm.ts` — `addressFieldsShape`,
  `refineAddressPostalCode()`, `US_ZIP_PATTERN`; both `createClientSchema`
  and `quickCreateClientSchema` extended.
- `src/actions/clients.ts` — `readClientForm()`, `createClientAction()`,
  `updateClientAction()`, `createQuickClientAction()` all read/pass the
  six address fields.
- `src/app/(protected)/clients/client-form.tsx` — renders
  `<AddressFields>`; Website field now edit-only-and-only-if-present.
- `src/app/(protected)/proposals/new/quick-create-client-modal.tsx` —
  renders `<AddressFields>`; submits the six address fields.
- `src/app/(protected)/proposals/[proposalId]/edit/step-materials.tsx`
  — the ZIP field's hint copy (auto-filled vs. empty state).
- `src/app/(protected)/clients/[clientId]/page.tsx` — displays the
  formatted address; fixes the snake_case/camelCase display bug (see
  "A real bug found during E2E testing" above).
- `src/app/globals.css` — `.field-legend` for the `<fieldset><legend>`
  address group heading.
- `CHANGELOG.md`, `README.md`, `docs/29-proposal-centric-product-pivot.md`,
  `docs/34-proposal-builder-ux.md`, `docs/42-material-catalog-by-zip.md`,
  `docs/65-render-environment-variables.md`.

## Known limitations

- **Per-proposal Job Address is explicitly deferred to a future
  phase.** This phase uses the client's own address as the default job
  ZIP for pricing, with a manual override always available in Materials
  & Costs — exactly per the brief's own instruction not to build a full
  job-sites module now. A future phase could add a dedicated Job Address
  per proposal (distinct from the client's billing/mailing address),
  reusing the same `AddressFields` component and the same
  never-overwrite-a-manual-value discipline already established here.
- **No autocomplete provider is actually wired up.** The UI, the env
  var contract, and the `data-address-autocomplete` hook point are all
  in place; no Google Places/Mapbox/other SDK is loaded, and no
  `place_id` or provider-specific data is stored anywhere. A future
  phase can add the actual widget without touching this phase's schema,
  validation, or ZIP-defaulting behavior.
- **One address per client.** By design this phase (Option A — see
  "Data model" above) — not a limitation, a deliberate, documented scope
  boundary. Multiple addresses per client would require promoting these
  columns into a real child table.
- **No canonical ZIP validation beyond format.** A syntactically valid
  but nonexistent US ZIP (e.g. `"00000"`) is accepted — matching the
  pre-existing Materials & Costs ZIP field's own behavior (Phase 2B),
  which never validated ZIP existence, only format.
- **Duplicate-address detection does not exist** (not requested) — two
  clients can have identical addresses; nothing in this phase treats
  that as an error or a warning.
