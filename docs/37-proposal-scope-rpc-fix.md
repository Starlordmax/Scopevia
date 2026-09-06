# 37 — `update_proposal_scope` RPC Fix (Job Summary)

Status: **Fixed, migrated to `scopevia-test`, and verified** — 14 new
RLS-layer tests + 11 new unit tests + 2 new E2E tests, all passing against
real Postgres/PostgREST.

## Root cause

`update_proposal_scope`'s SQL signature had **no `DEFAULT` on any of its
four optional parameters**:

```sql
create or replace function public.update_proposal_scope(
  p_proposal_version_id uuid,
  p_summary text,
  p_scope_intro text,
  p_estimated_start_date date,
  p_estimated_duration_days int
)
```

On the application side, `updateProposalScopeAction` (`src/actions/proposals.ts`)
converted an empty/absent form field to JavaScript `undefined` before
calling the RPC. Supabase-js's `.rpc()` call JSON-encodes its args object
via `JSON.stringify`, and **`JSON.stringify` silently omits any key whose
value is `undefined`** — it does not serialize it as `null`, it removes
the key entirely.

So when a user filled in only *Short summary* and *Estimated start date*,
leaving *Scope introduction* and *Estimated duration* blank, the actual
HTTP request body PostgREST received contained only three of the five
parameter names: `p_proposal_version_id`, `p_summary`,
`p_estimated_start_date`. PostgREST resolves an RPC call to a specific
function overload by matching the parameter names present in the request
against a function's declared signature (with any `DEFAULT`-covered
parameters treated as optional). Since none of the four optional
parameters had a `DEFAULT`, PostgREST could not find *any* function named
`update_proposal_scope` that accepted exactly those three arguments and
failed with:

```
Could not find the function public.update_proposal_scope(
  p_estimated_start_date, p_proposal_version_id, p_summary
) in the schema cache
```

The function was never missing — the request simply didn't match its
signature. The error's phrasing ("in the schema cache") is easy to
misread as a stale-cache or deployment problem; it is actually PostgREST
correctly reporting an overload-resolution failure.

**A prior gap that let this ship unnoticed:** the Phase 2A E2E suite's
"full builder flow" test never actually filled in the Job Summary form —
it clicked past the Scope step using only the section-add form, and the
Scope step's own "Save and continue" button (which triggers
`update_proposal_scope`) was never exercised. `docs/36`'s "55/55 passing"
was accurate for everything it tested, but it never tested this. This is
now fixed — see "Tests" below.

## Signature

**Before** (no defaults; every optional field had to be supplied for
PostgREST to find a matching overload):

```sql
update_proposal_scope(
  p_proposal_version_id uuid,
  p_summary text,
  p_scope_intro text,
  p_estimated_start_date date,
  p_estimated_duration_days int
)
```

**After** (`supabase/migrations/20260707150000_fix_update_proposal_scope_optional_args.sql`
— parameter names, order, and types unchanged; only `DEFAULT NULL` added
to the four optional ones, so `CREATE OR REPLACE FUNCTION` applied
in-place without needing to drop and recreate the function or its
grants):

```sql
update_proposal_scope(
  p_proposal_version_id uuid,
  p_summary text default null,
  p_scope_intro text default null,
  p_estimated_start_date date default null,
  p_estimated_duration_days int default null
)
```

All internal logic — `auth.uid()` check, membership/permission check via
`user_has_permission(tenant_id, 'proposals.update')`, draft-only guard,
the `estimated_duration_days > 0` check, and the `log_audit_event()` call
— is byte-for-byte unchanged. `REVOKE ... FROM public`, `REVOKE ... FROM
anon`, and `GRANT ... TO authenticated` are reapplied explicitly in the
migration even though `CREATE OR REPLACE` preserves the existing OID's
grants, to leave no ambiguity about the resulting privileges. The
migration ends with `NOTIFY pgrst, 'reload schema'` as a courtesy, not a
dependency — the real fix (below) doesn't rely on cache timing at all.

## Frontend correction

Two independent, mutually-reinforcing fixes — the SQL default alone would
have been enough to stop the crash, but the brief's explicit requirement
is that the client never send `undefined` for an intentionally-omitted
field, so both were made:

1. **`src/lib/validation/proposals.ts`** — `updateProposalScopeSchema` was
   rewritten so every optional field's Zod pipeline normalizes `""` *and*
   a missing key to `null`, never `undefined`. `estimatedDurationDays` no
   longer uses `z.coerce.number()` directly on the raw string — `Number("")`
   is `0` in JavaScript, so coercing an empty field would have silently
   turned "left blank" into "a duration of zero days." Instead, emptiness
   is checked *before* any numeric coercion happens. `estimatedStartDate`
   validates against a strict `YYYY-MM-DD` regex plus a real
   calendar-validity check (rejects e.g. `2026-02-30`, a syntactically
   plausible but nonexistent date) — never trusting the browser's
   localized date presentation, since the field is a native
   `<input type="date">` whose `.value` is already ISO-formatted
   regardless of locale, but a tampered raw `FormData` value is not
   guaranteed to be.
2. **`src/actions/proposals.ts`** — `updateProposalScopeAction` now passes
   the raw `FormData` values straight into the schema (no `|| undefined`
   pre-filtering, which is exactly the pattern that produced the bug) and
   sends every one of the four optional keys to the RPC explicitly, even
   when the value is `null`:

   ```ts
   const { error } = await supabase.rpc("update_proposal_scope", {
     p_proposal_version_id: proposalVersionId.data,
     p_summary: parsed.data.summary as string,
     p_scope_intro: parsed.data.scopeIntro as string,
     p_estimated_start_date: parsed.data.estimatedStartDate as string,
     p_estimated_duration_days: parsed.data.estimatedDurationDays as number,
   });
   ```

   The `as string`/`as number` casts are required because Supabase's
   generated RPC arg types come out non-nullable even for `DEFAULT NULL`
   parameters — the same generator limitation already documented for
   `log_audit_event` in `src/lib/audit/log.ts` (there is no SQL syntax
   that marks a scalar argument as accepting `NULL`, so the generator
   can't know). Postgres itself accepts `null` for all four regardless of
   what the generated TypeScript type claims.

   `tenant_id` is never taken from the client at all — the function
   derives it server-side from the version row itself
   (`v_version.tenant_id`), matching the rest of the Phase 2A functions.

Because every optional field's form input already used `defaultValue`
(uncontrolled inputs), a failed submission keeps whatever the user typed
without any extra code — React doesn't reset an uncontrolled input's DOM
value on a re-render unless the component remounts, and nothing here
causes a remount.

## Error sanitization

`friendlyRpcErrorMessage` (`src/lib/errors/friendly-message.ts`) did not
previously catch this class of error at all — its only rule that comes
close (`raw.includes("()")`) only matches literal empty parentheses, and
the PostgREST message's parentheses are full of parameter names, so it
would have passed the raw message (fully-qualified function name, schema,
every parameter name) straight through to the user-facing error banner.
Fixed with an explicit, narrow check for both `"schema cache"` and a
leading `"Could not find the function"`, checked *before* the generic
paren-stripping rule (which would still have left `public.function_name`
exposed) — both now collapse to a single generic message:

> We couldn't complete that action. Please try again.

The technical message is never displayed; it is still returned as
`error.message` to server-side code (nothing in this codebase logs it to
an external observability system yet, matching Phase 2A's existing
scope).

## Tests

- **Unit** (`tests/unit/proposal-scope-validation.test.ts`, 11 new cases):
  empty-string and missing-key both normalize to `null`, never
  `undefined`; the exact reported bug scenario (summary + start date only);
  `estimatedDurationDays: ""` never becomes `0`; duration `0`/negative
  rejected when actually provided; non-integer duration rejected;
  calendar-invalid date (`2026-02-30`) rejected; non-ISO date formats
  rejected; trim + max-length enforcement; all-fields-empty accepted.
- **Unit** (`tests/unit/friendly-message.test.ts`, 2 new cases): the exact
  reported raw PostgREST message is sanitized to the generic message with
  no function name, schema, or parameter name surviving; a differently-worded
  "Could not find the function" message is caught the same way.
- **RLS/integration** (`tests/rls/phase2a-proposals.test.ts`, new
  `describe("update_proposal_scope (Job summary)")`, 14 cases, real
  Postgres/PostgREST against `scopevia-test`): all five parameters at
  once; only summary + start date with the rest explicitly `null` (the
  exact reported bug); only summary with the other three keys *omitted
  entirely* (proves the SQL `DEFAULT NULL` half of the fix independently);
  only start date; only scope intro; only duration; all fields explicitly
  `null` clears previously-saved values; invalid calendar date rejected;
  negative/zero duration rejected; a locked version rejected; Viewer
  rejected; cross-tenant (Tenant B) rejected with the row unchanged; a
  suspended user's existing session rejected even with an otherwise-valid
  permission; a successful call writes an `audit_logs` row.
- **E2E** (`tests/e2e/proposals.spec.ts`, new
  `describe("Job summary (update_proposal_scope)")`, 2 cases, real
  browser against a production build): the exact reported reproduction
  steps (open the builder, fill only Short summary + Estimated start
  date, leave the other two blank, click Save and continue) — asserts no
  schema-cache/"could not find the function" text ever appears, the
  builder actually advances to the Labor step, and the saved values
  (including the two genuinely-empty fields) persist correctly on
  reload; and a second case confirming every field can be left blank.

## Remote verification

Applied to `scopevia-test` (ref `msduefaopvxfjqktjymo`) via
`npx supabase db push`; confirmed via `npx supabase migration list`
that local and remote are in sync with zero drift. The fix was verified
against the live PostgREST instance, not just locally: all 14 new RLS
tests make real authenticated RPC calls over the network to the actual
project, including the two cases (all-params and summary-only-with-keys-omitted)
that would have reproduced the original "not found in schema cache" error
had the fix not worked.
