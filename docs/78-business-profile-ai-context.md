# 78 — Business Profile (AI Context)

Status: **Implemented.** A tenant-level "Business profile" card in
Profile → Business profile, feeding the [AI writing assistant](77-ai-proposal-text-generation.md).
Distinct from the personal `ProfileForm` above it on the same page (that
one is per-user; this one is per-tenant) and distinct from Business
branding (that one is the logo; this one is text/policy content).

## Why a new table, not more columns on `tenants`

Business branding (the logo) added ~5 tightly-scoped columns directly to
`tenants`. This feature has ~19 free-text fields — a materially larger,
content-shaped field set that doesn't belong mixed into the tenant
identity row. It follows `tenant_proposal_settings`'s pattern instead: a
real one-row-per-tenant child table (`business_profiles`, `tenant_id`
primary key), created lazily/idempotently the first time it's needed via
`ensure_business_profile()`.

## Permissions

No new permission key. Reuses `tenant.view` (every role — everyone can
see the configured policies) / `tenant.update` (Owner, Admin only —
matches Business branding's own precedent exactly, since this is "more
tenant settings," not a distinct capability).

## Fields

| Field | Required | Feeds |
|---|---|---|
| Business name | Yes | Every generated section |
| Industry, Main services, Service area | No | Context only |
| Business address, phone, email | No | Not sent to the AI prompt at all — display/contact info only, see [docs/79](79-openrouter-security.md) |
| License number, Insurance/bonded statement | No | Terms — **only used verbatim if present, never invented** |
| Default warranty policy | No | Terms |
| Payment terms preference | No | Terms |
| Deposit policy | No | Terms |
| Change order policy | No | Terms |
| Cancellation/rescheduling policy | No | Terms |
| Cleanup policy | No | Terms |
| Materials policy | No | Terms |
| Client responsibilities | No | Terms / Notes for client |
| Default exclusions | No | Exclusions |
| Tone preference | Yes (defaults to "professional") | The AI assistant's default tone (user can still override per-generation) |

Every field except business name and tone is optional — a contractor
filling this in for the first time isn't blocked from saving a partial
profile, and the prompt builder writes neutral, generic language for
anything left blank rather than inventing a commitment (see
[docs/77](77-ai-proposal-text-generation.md), "Prompt design").

## Validation

`src/lib/validation/business-profile.ts` — business name required
(1-160 chars); business email validated as an email if present (reuses
`optionalEmailSchema`); business phone lenient (reuses
`optionalPhoneSchema`, same "don't block over formatting" rule as
Clients — see `docs/20`); every long-text policy field capped at 4000
chars; tone preference restricted to the five declared values. Same
`fieldErrors`/red-border pattern as every other form in the app (see
[docs/75](75-global-field-validation.md)) — a validation failure never
crashes the page.

## UI

`src/app/(protected)/profile/business-profile-card.tsx` — always renders
every field (even for a non-Owner/Admin viewer, as `disabled`), matching
Business branding's read-only-fallback pattern but adapted for a
content-heavy form: seeing the configured policies is useful even if you
can't edit them (e.g. before generating an AI draft that will use them).
Helper placeholders on every policy field come directly from the brief's
own examples (e.g. "Workmanship warranty for 1 year. Materials are
covered by manufacturer warranty.").
