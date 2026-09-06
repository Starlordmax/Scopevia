# 79 — OpenRouter Security

Status: **Implemented.** Security model for the [AI-assisted proposal
text](77-ai-proposal-text-generation.md) feature's OpenRouter
integration.

## API key handling

- Read from `process.env.OPENROUTER_API_KEY` — **server-only**, never
  `NEXT_PUBLIC_`. Read only inside `generateProposalTextDraft()`'s
  function body at call time, never at module load, so a missing key
  never crashes an unrelated page.
- `src/lib/ai/openrouter.ts` is the **only** file that ever reads this
  variable and the only file that ever calls OpenRouter. It carries an
  `import "server-only"` guard, enforced by Next.js's build — importing
  it from a Client Component fails the build outright, not just at
  runtime. (The three modules it depends on — `prompt.ts`,
  `fallback-templates.ts`, `proposal-context.ts` — are pure functions
  with no secret access and deliberately do **not** carry the guard, so
  they stay independently unit-testable; see "Testing" below for why
  the guard itself needs a vitest alias to be testable at all.)
- Never called from a Client Component, ever. The only caller is
  `generateProposalTextAction` (`src/actions/ai-proposal-text.ts`), a
  `"use server"` Server Action.
- Never persisted to the database, never logged (`console.error` calls
  in this feature log generic messages/error codes, never the key or a
  raw provider response), never included in a test file, screenshot, or
  this documentation.
- **The API key shared earlier in this project's chat history must be
  treated as compromised and rotated** at
  [openrouter.ai/keys](https://openrouter.ai/keys) before this feature
  is used with a real key in any environment. The value actually set in
  Render's dashboard must be a freshly generated key, never that one.

## What never reaches the model

Per [docs/77](77-ai-proposal-text-generation.md)'s "Prompt design"
section: no client phone/email/address, no exact dollar amounts, no
photo files, no internal ids, no prompt-injection surface from user
data beyond plain proposal-content strings (title, section titles,
measurement/labor/material names) that were already visible to every
tenant member with `proposals.view` anyway.

## What never reaches the browser

- The raw OpenRouter response body is never sent to the client — the
  Server Action returns only the validated, typed `AiProposalTextDraft`
  (`{ terms, exclusions, clientNotes, warnings }`) or a short, generic
  friendly message (`GenerateProposalTextResult`'s `error` field).
- Every failure path (`missing_api_key`, `invalid_json`,
  `request_failed`, `timeout`) maps to one of four fixed, sanitized
  messages — the actual provider error text/status/body is **never**
  forwarded, matching this app's existing `friendlyRpcErrorMessage()`
  discipline for Postgres errors.
- `ai_generation_events` (the telemetry table) stores only: tenant/user/
  proposal ids, `feature`, `model`, `status`, a short `error_code`
  (never a raw message), and token counts. **Never the prompt. Never the
  AI's response text.** Anyone with SELECT on that table (same
  `ai.generate_proposal_text` permission) sees usage/cost data, never
  content.

## Tenant isolation & permission enforcement

Same discipline as every other RPC in this app (see
`docs/35-phase-2a-rls-verification.md`): every check happens in
Postgres, not just in TypeScript.

- `get_business_profile`/`update_business_profile`: `security definer`,
  check `user_has_permission(p_tenant_id, 'tenant.view'|'tenant.update')`
  before touching any row.
- `count_recent_ai_generations`/`record_ai_generation_event`: `security
  definer`, check `user_has_permission(p_tenant_id, 'ai.generate_proposal_text')`.
  A cross-tenant caller (not a member of the target tenant) gets a
  permission error, not silently-empty data.
- `ai_generation_events`/`business_profiles` RLS: SELECT-only policies,
  `to authenticated` only, no direct INSERT/UPDATE/DELETE grant at all —
  every write goes through the `security definer` functions above.
  `ai_generation_events` additionally has an append-only trigger
  (mirroring `audit_logs`'s own) blocking UPDATE/DELETE even for a role
  that bypasses RLS.
- `generateProposalTextAction` additionally re-derives `isDraft` from
  the loaded proposal/version (`version_status === "draft" &&
  proposal.status === "draft"`) before generating anything — no
  generation for an archived proposal or a version that's no longer
  editable, the same gate the rest of the builder already uses.

## Rate limiting & cost control

`count_recent_ai_generations()` is called **before** any OpenRouter
request — a rate-limited user (>10 generations/hour, per-user-per-tenant)
never triggers a provider call, so rate limiting is also a cost control,
not just an abuse guard. `max_tokens: 2000` and a 30s timeout bound the
cost and latency of any single call regardless of what a malicious or
malformed prompt might otherwise induce.

## Testing

- **Unit** (`tests/unit/ai-proposal-text.test.ts`): the prompt builder
  is asserted to never contain anything matching `/sk-|api[_-]?key|OPENROUTER/i`;
  the OpenRouter module's request/response handling (missing key →
  no network call at all, malformed JSON → one retry then a friendly
  error, non-2xx → a friendly error that never contains the raw provider
  body, valid response → correctly parsed draft + token counts) is
  exercised with a mocked `global.fetch`, never a real network call.
- **RLS** (`tests/rls/phase-ai-proposal-text.test.ts`): real Postgres,
  asserting Owner/Admin can update the business profile and Estimator
  cannot; every role but Viewer/Field Worker can call the AI-generation
  RPCs; a user from Tenant B gets a permission error against Tenant A's
  tenant id; `ai_generation_events` truly has no direct write grant and
  is truly append-only (checked via the `service_role` client — RLS
  doesn't apply to it, only the trigger does — since checking via an
  ordinary member's client can't distinguish "blocked by RLS" from "0
  rows silently matched," see that test file's own comment on this).
- **E2E** (`tests/e2e/ai-proposal-text.spec.ts`): runs against a real,
  live server with the fallback-template path (since `OPENROUTER_API_KEY`
  is deliberately never set in any test environment) — genuinely
  end-to-end, not mocked, for everything except the actual third-party
  API call itself. Covers: business profile save/reload, Generate → 
  review → Apply → Save and continue → value survives a reload; the
  Replace/Append/Cancel confirmation when text already exists; Cancel
  discarding a draft without touching the real form; a saved business
  profile field appearing verbatim in a later generated draft.
- **No test, anywhere, calls the real OpenRouter API** — this is by
  design (the brief's own instruction), not an oversight.
