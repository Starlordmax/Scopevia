# 69 — Business Branding: Logo Upload (Phase 3D.2)

Status: **Shipped**, not yet deployed to staging.

> **Doc numbering note:** the original brief for this phase asked for
> `docs/67` and `docs/68`. Those numbers were already taken by
> [docs/67](67-auth-confirmation-url-fix.md) and
> [docs/68](68-auth-callback-localhost-redirect-fix.md) — two unrelated
> Render/auth bug fixes completed earlier in the same work session. This
> phase uses the next actually-available numbers, **69 and 70**, instead of
> overwriting those docs.

## What this phase adds

The business owner (or an Admin) can upload a company logo from **Profile →
Business branding**. Once uploaded, it appears in:

1. The internal proposal preview and the Review step of the builder.
2. The client portal (`/p/[token]/view` and `/p/[token]/print`).
3. The contractor's own print/export route (`/proposals/[id]/print`).

If no logo exists, every one of those surfaces falls back to the business
name as plain text — exactly what they showed before this phase.

## Branding architecture

**The logo belongs to the tenant, not the user.** This was the single
non-negotiable constraint in the brief: a business can have several users
(Owner, Admin, Estimator, ...), and every proposal from that business must
render the same logo regardless of who's viewing it. Concretely:

- The logo columns live on `public.tenants` — the same row that already
  holds `tenants.name`, the existing business-name source used everywhere
  in the app.
- The Profile page hosts the upload UI (that's where the brief wants it
  presented), but the card is explicitly labeled **"Business branding"**
  with a **"Company logo"** section — never "your avatar," never mixed
  visually with the personal email/name form above it (see
  `src/app/(protected)/profile/business-branding-card.tsx`).
- Permission checks are tenant-scoped (`tenant.update`), not user-scoped —
  see "Permissions" below.

### Why `tenants` directly, and not a new settings table

The repo already has one close analog: `tenant_proposal_settings`, a 1:1
tenant-scoped table with a lazy `ensure_tenant_proposal_settings()`
get-or-create function (`supabase/migrations/20260706140100_tenant_proposal_settings.sql`).
That table exists
because proposal *defaults* (hourly rate, tax rate, terms, ...) are a
distinct, growable settings surface.

Branding isn't that: it's five nullable columns that describe a single
optional file, always either fully present or fully absent, with no
get-or-create semantics needed (there's nothing to "ensure exists" — a
tenant row already always exists). Extending `tenants` directly avoids
inventing a settings table for something that isn't really a "settings"
concept, and satisfies the brief's own instruction not to invent new
structure where a correct one already exists.

## Data / storage model

### New columns on `public.tenants`

(migration `20260723100000_tenant_branding_columns.sql`)

| Column | Type | Notes |
|---|---|---|
| `logo_storage_path` | `text` | Private Storage path, e.g. `<tenant_id>/logo-<uuid>.png`. **Never** a public or signed URL. |
| `logo_original_filename` | `text` | For display only (e.g. "Replace logo" hint text) — never used to build a path. |
| `logo_content_type` | `text` | Constrained by CHECK to `image/png`, `image/jpeg`, or `image/webp`. |
| `logo_size_bytes` | `bigint` | Constrained by CHECK to `1..10485760` (10 MB — see [docs/71](71-logo-upload-crash-fix.md), raised from an initial 2 MB). |
| `logo_updated_at` | `timestamptz` | Set on upload/replace, cleared (null) on remove. |

All five are null together (no logo) or set together (has a logo) — that
invariant is enforced by `update_tenant_branding()` and
`remove_tenant_branding()` always writing/clearing the whole group, not by
a database constraint across all five columns.

**Never stored:** base64 image bytes, or a signed/public URL. Only the
private path — a signed URL is generated on demand, server-side, with a
5-minute expiry, every time a page needs to display the logo.

### Storage bucket: `tenant-branding`

(migration `20260723100100_tenant_branding_storage.sql`) — see
[docs/70](70-logo-storage-security.md) for the full security review.

### Database functions

(migration `20260723100200_tenant_branding_functions.sql`)

- `get_tenant_branding(p_tenant_id)` — returns the full `tenants` row,
  gated on `tenant.view`. Only `hasLogo`/`logoUrl`/filename/timestamp are
  ever surfaced to callers (see `src/lib/branding/data.ts`) — the raw path
  is read internally by Server Actions only.
- `update_tenant_branding(p_tenant_id, path, filename, content_type,
  size_bytes)` — gated on `tenant.update`. Validates the path actually
  starts with `<tenant_id>/`, the content type is one of the three allowed
  values, and the size is within `(0, 10485760]`. Sets `logo_updated_at =
  now()`. Logs `tenant.logo_updated` via the existing `log_audit_event()`.
- `remove_tenant_branding(p_tenant_id)` — gated on `tenant.update`. Nulls
  all five columns. Logs `tenant.logo_removed`.

## Permissions

**No new permission keys.** The brief suggested
`business_branding.view`/`business_branding.update`, but the Phase 0 seed
already has `tenant.view` / `tenant.update` with exactly the role matrix
this phase needs:

| Role | `tenant.view` | `tenant.update` | Can change logo? |
|---|---|---|---|
| Owner | ✅ | ✅ | Yes |
| Admin | ✅ | ✅ | Yes |
| Estimator | ✅ | ❌ | View only |
| Sales | ✅ | ❌ | View only |
| Field Worker | ✅ | ❌ | View only |
| Viewer | ✅ | ❌ | View only |

This is a direct instance of "no inventes estructura nueva si ya existe una
correcta" — the permission model this phase needed already existed and
already had the right shape.

## Profile / Settings UX

`src/app/(protected)/profile/business-branding-card.tsx` — a second,
visually separate `.form-card` below the personal profile form:

- **Current logo** section: the logo thumbnail if one exists, or "No logo
  uploaded yet — proposals show '<business name>' as text instead."
- If `tenant.update`: an upload form ("Upload logo" / "Replace logo"
  depending on state) with help text ("Recommended: PNG, JPG, or WEBP. Max
  10 MB.") and, when a logo exists, a separate "Remove logo" form with a
  confirm dialog. Upload posts to `POST /api/business-branding/logo` (a
  Route Handler) via `fetch()`, not a Server Action — see
  [docs/71](71-logo-upload-crash-fix.md) for why.
- If not: "Only an Owner or Admin can change the business logo." — no
  controls rendered at all.

Loading/pending states come from React's `useFormStatus` via the existing
`<SubmitButton>` component (the same one every other upload form in this
app uses); errors render via the existing `.error-banner` class.

## Proposal / Portal / PDF rendering

`ProposalDocument` (`src/app/(protected)/proposals/[proposalId]/proposal-document.tsx`)
takes a new optional `logoUrl` prop. `resolveLogoDisplay()`
(`src/lib/branding/logo-display.ts`, pure/unit-tested) decides whether to
render an `<img>` or nothing — when nothing, the existing business-name
text is unchanged from before this phase.

```
[Logo] Business Name
Proposal #...
Prepared for...
```

CSS (`.proposal-document-logo`, `src/app/globals.css`):

```css
.proposal-document-logo {
  max-height: 64px;
  max-width: 180px;
  object-fit: contain;
}
```

`object-fit: contain` guarantees the image is never deformed regardless of
its native aspect ratio; the height/width cap keeps it visually
proportionate to the business-name text next to it, on both screen and
print, without needing image processing.

Every surface that already rendered `ProposalDocument` was updated to also
fetch and pass `logoUrl`:

| Surface | Signed URL source |
|---|---|
| Builder Review step, `/proposals/[id]/preview`, `/proposals/[id]/print` | `getBusinessBranding()` (authenticated client, RLS-gated on `tenant.view`) |
| `/p/[token]/view`, `/p/[token]/print` | `getSignedBrandingUrlForPortal()` (admin/service-role client — see [docs/70](70-logo-storage-security.md) for why this is safe) |

## Known limitations

- **No image cropping/editor.** The brief explicitly scoped this out —
  whatever aspect ratio is uploaded is what renders, capped by
  `object-fit: contain` so it's never distorted, but not auto-cropped to a
  recommended shape.
- **No custom brand theme colors.** Only the logo image itself; the rest of
  the proposal/portal/print styling is unchanged.
- **No custom sender domain / email redesign.** Branding data is available
  for a future OTP/notification email redesign, but none of the existing
  email templates were touched in this phase.
- **SVG is blocked entirely**, not sanitized — see
  [docs/70](70-logo-storage-security.md).
- **The tenant-branding logo is a per-tenant singleton** — uploading a new
  one always replaces the old one; there's no history/versioning of past
  logos.

## Files created

- `supabase/migrations/20260723100000_tenant_branding_columns.sql`
- `supabase/migrations/20260723100100_tenant_branding_storage.sql`
- `supabase/migrations/20260723100200_tenant_branding_functions.sql`
- `src/lib/branding/logo-validation.ts`
- `src/lib/branding/logo-display.ts`
- `src/lib/branding/data.ts`
- `src/lib/storage/branding.ts`
- `src/actions/branding.ts`
- `src/app/(protected)/profile/business-branding-card.tsx`
- `tests/unit/logo-validation.test.ts`
- `tests/unit/logo-display.test.ts`
- `tests/rls/phase3d2-branding.test.ts`
- `tests/e2e/business-branding.spec.ts`
- `tests/e2e/business-branding-portal.spec.ts`
- `tests/e2e/business-branding.mobile.spec.ts`
- `docs/69-business-branding-logo-upload.md` (this file)
- `docs/70-logo-storage-security.md`

## Files modified

- `types/database.ts` — `tenants` Row/Insert/Update + three new RPC
  entries (hand-edited; `db:types` requires local Docker, unavailable in
  this environment, same as every prior phase).
- `src/app/(protected)/profile/page.tsx` — renders `BusinessBrandingCard`.
- `src/app/(protected)/proposals/[proposalId]/proposal-document.tsx` —
  `logoUrl` prop + rendering.
- `src/app/(protected)/proposals/[proposalId]/edit/step-review.tsx`,
  `src/app/(protected)/proposals/[proposalId]/edit/page.tsx` — thread
  `logoUrl` into the Review step.
- `src/app/(protected)/proposals/[proposalId]/preview/page.tsx`,
  `src/app/proposals/[proposalId]/print/page.tsx` — fetch and pass
  `logoUrl`.
- `src/app/p/[token]/view/page.tsx`, `src/app/p/[token]/print/page.tsx` —
  fetch `tenants.logo_storage_path` and sign a portal-safe URL.
- `src/app/globals.css` — `.proposal-document-brand`,
  `.proposal-document-logo`.
- `CHANGELOG.md`, `README.md`,
  [docs/60](60-proposal-pdf-print-export.md),
  [docs/52](52-client-portal-foundation.md),
  [docs/53](53-client-portal-security.md) — pointers to this phase.
