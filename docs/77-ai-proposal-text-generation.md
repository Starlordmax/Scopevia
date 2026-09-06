# 77 — AI-Assisted Proposal Text (Terms, Exclusions, Notes for Client)

Status: **Implemented.** An "AI writing assistant" on the Terms & Pricing
step drafts Terms, Exclusions, and Notes for client from the proposal's
own data and a tenant-level [Business profile](78-business-profile-ai-context.md),
via [OpenRouter](https://openrouter.ai) — server-only, with a local
fallback template when OpenRouter isn't configured. See
[docs/79](79-openrouter-security.md) for the security model and
[docs/10](10-ai-boundaries.md) for this project's general AI principles,
which this feature was built to honor: assistance, never authority;
minimal data in prompts; graceful degradation; nothing essential depends
on AI being available.

**Note on doc numbering:** the brief suggested `docs/76`, `77`, `78` for
this feature's three docs. `docs/76` was already taken (Measurements
validation fix, from the same day) by the time this was written — this
doc is `77`, the business profile doc is `78`, and the security doc is
`79`, the next free numbers.

## Architecture

```
Terms & Pricing step (Client Component)
  └─ AiWritingAssistant (ai-writing-assistant.tsx)
       └─ generateProposalTextAction (Server Action, src/actions/ai-proposal-text.ts)
            ├─ requirePermission(tenantId, "ai.generate_proposal_text")
            ├─ count_recent_ai_generations RPC (rate limit, BEFORE any provider call)
            ├─ getFullProposal (existing loader, src/lib/proposals/data.ts)
            ├─ getBusinessProfile (src/lib/business/data.ts)
            ├─ buildProposalContextSummary (src/lib/ai/proposal-context.ts — data minimization)
            ├─ buildProposalTextPrompt (src/lib/ai/prompt.ts — safety rules + context)
            ├─ generateProposalTextDraft (src/lib/ai/openrouter.ts)
            │    ├─ no OPENROUTER_API_KEY → buildFallbackProposalTextDraft (src/lib/ai/fallback-templates.ts)
            │    └─ else → real OpenRouter chat completion, JSON-validated, one retry on malformed JSON
            └─ record_ai_generation_event RPC (telemetry — never the prompt or raw response)
```

Nothing here writes to the proposal directly. The Server Action returns a
structured draft; the UI shows it for review; only an explicit "Apply to
proposal" click fills the real form's fields (client-side state only);
the user still has to click "Save and continue" to actually persist it —
identical to every other edit on that step. See [docs/10](10-ai-boundaries.md):
"la IA nunca... altera estimados enviados... sin confirmación."

## Data model

- `business_profiles` — one row per tenant, tenant-level context (see
  [docs/78](78-business-profile-ai-context.md)). No new permission —
  reuses `tenant.view`/`tenant.update`, same as business branding.
- `ai_generation_events` — append-only telemetry (model, status, token
  counts, sanitized error code). Never stores the prompt or the raw AI
  response. Used for (a) per-user-per-tenant rate limiting via
  `count_recent_ai_generations()` and (b) usage/cost observability. Also
  mirrored into `audit_logs` via `log_audit_event()` for the tenant-wide
  audit trail.
- New permission `ai.generate_proposal_text` — Owner/Admin/Estimator/Sales
  can generate; Viewer/Field Worker cannot. See "Permissions" below for
  a deliberate nuance around Sales.

Migrations: `20260819100000` through `20260819100600` (6 files: business
profile schema/functions/RLS, generation events schema/functions/RLS,
permission seed).

## Prompt design — what's included, what's deliberately excluded

`src/lib/ai/proposal-context.ts` builds a **minimal, structured summary**
from the proposal — not a dump of the full `FullProposal` object. Per
[docs/10](10-ai-boundaries.md)'s data minimization principle:

**Included:** proposal title, service type, custom service name, the
client's *display name only* (for a personalized greeting — nothing else
about them), scope summary/intro, section titles, measurement *names*
(not raw dimensions), labor item *labels* (not rates), material
*categories* (not costs or exact line items), a job-photo count (never
photo files).

**Deliberately excluded:** the client's phone, email, or address; any
exact dollar amount, rate, or cost; the file contents of any photo;
proposal/tenant ids (used to look up what to summarize, never placed
into the prompt text itself); anything from `ai_generation_events` or
`audit_logs`.

The system prompt (`src/lib/ai/prompt.ts`) restates safety rules on
every call (see [docs/79](79-openrouter-security.md), "Prompt safety") —
never invent a license/insurance/warranty/payment claim that wasn't
provided, never claim legal compliance, never mention AI or this app's
internals, always respond with the exact JSON shape requested.

## Terms & Pricing UX

- **Generate all / Generate terms / Generate exclusions / Generate
  client notes** — four buttons, each calling the same action with a
  different `feature`.
- **Advanced options** (collapsible): Tone (defaults to the business
  profile's own tone preference), Length (short/standard/detailed),
  four Include toggles (warranty, payment terms, exclusions, client
  responsibilities).
- **Generated draft** renders below the buttons — Terms/Exclusions/Notes
  shown as read-only preview text, plus any `warnings` the model
  returned (e.g. "No warranty policy on file — used generic language.").
- **Apply to proposal**: if the corresponding field(s) already have text,
  asks **Replace existing text / Append below existing text / Cancel**
  first — never silently overwrites (the brief's explicit requirement).
  Applying only updates the Terms & Pricing form's own (now-controlled)
  textareas' displayed value — the user still clicks the form's own
  "Save and continue" to persist it.
- **Regenerate** re-runs the same request. **Cancel** discards the draft
  without touching the real form.
- A visible disclaimer is always shown: *"AI drafts are suggestions.
  Review before sending to a client. AI-generated text is a drafting aid
  and should be reviewed before use — it is not legal advice and creates
  no legal guarantee."*

## Fallback without AI

If `OPENROUTER_API_KEY` is unset, `generateProposalTextAction` never
calls OpenRouter at all — `src/lib/ai/fallback-templates.ts` builds a
plain, local, no-network draft from the same business profile and
proposal context, using the same "never invent what wasn't provided"
discipline. The UI shows *"AI writing is not configured yet — this is a
basic template you can still edit and apply"* rather than an error, and
every button still works. This is also why the E2E suite (which
deliberately never sets `OPENROUTER_API_KEY`) exercises a completely
real, unmocked code path end-to-end.

## Permissions

`ai.generate_proposal_text`: Owner, Admin, Estimator, Sales. Viewer and
Field Worker cannot generate.

**Deliberate nuance on Sales:** the Terms & Pricing step's textareas
themselves are gated on `proposals.manage_pricing`, which Sales does
*not* have by default (a pre-existing Phase 2A business decision — see
`20260706141600_seed_proposal_permissions.sql`'s own module comment:
"Sales gets proposals.create/update/mark_ready but NOT
proposals.manage_pricing"). Per the brief, `ai.generate_proposal_text`
is still granted to Sales at the database/permission level (parity with
their `proposals.create`/`update` access — the Server Action itself only
checks this one permission, nothing more). The **UI**, however, only
renders the assistant when the user can also edit that step
(`canGenerateAiText={canGenerateAiText && canManagePricing && isDraft}`
in `edit/page.tsx`) — showing "Generate" to someone who could never
apply-and-save the result would be a dead end. In today's default role
matrix, Sales therefore won't see the button in the normal flow, even
though the underlying permission is granted — an intentional UX choice,
not a security gate (calling the Server Action directly would still
succeed for a Sales user, it just wouldn't lead anywhere useful, since
the actual save still independently requires `manage_pricing`). Flagged
here as a documented product decision, easy to revisit if Sales is ever
given pricing authority.

## Rate limiting & cost control

10 generations per user per tenant per rolling hour
(`RATE_LIMIT_PER_HOUR` in `src/actions/ai-proposal-text.ts`,
`count_recent_ai_generations()` checked *before* any provider call, so a
rate-limited user never incurs a cost). `max_tokens: 2000` per call, a
30s timeout, a small default model
(`openai/gpt-4o-mini`, overridable via `OPENROUTER_MODEL`).

## Known limitations

- No streaming — the draft appears all at once after the full response
  (or times out at 30s).
- The "Replace vs. Append" choice is a single decision covering every
  field touched by a "Generate all" call, not a per-field choice — a
  deliberate simplification (the brief's own example shows a single
  Terms-specific confirmation; extending to independent per-field
  choices for a combined 3-field generation would meaningfully complicate
  the UI for a rare case).
- The "no generation for a locked/archived proposal" rule is enforced in
  `generateProposalTextAction` (TypeScript), not at the RPC layer — the
  RLS suite therefore can't exercise it directly (RPC calls have no
  concept of "this proposal"); covered instead by the action's own logic
  reading `version.version_status`/`proposal.status`, matching the exact
  `isDraft` gate the rest of the builder already uses.
- No dedicated automated test calls the real OpenRouter API — by design,
  per the brief ("do not call the real API in CI/E2E"). See
  [docs/79](79-openrouter-security.md), "Testing," for how the module's
  request/response handling is still verified (mocked `fetch` in unit
  tests) alongside the fallback path (real, unmocked E2E coverage).
