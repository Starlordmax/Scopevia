# 34 — Proposal Builder UX

Status: **Implemented**, verified by a full manual browser walkthrough
(sign-in → client → proposal → every step → mark ready → dashboard →
return to draft → archive → restore) and by the E2E suite in
[docs/36](36-phase-2a-e2e-verification.md).

> **Nota de estado (2026-07-07):** El paso Scope (Job Summary) tenía un
> bug real que impedía guardarlo si el usuario dejaba campos opcionales
> vacíos ("Could not find the function ... in the schema cache") — nunca
> cubierto por el E2E original, que no llegaba a ejercitar ese formulario.
> Corregido; ver [37-proposal-scope-rpc-fix.md](37-proposal-scope-rpc-fix.md).

> **Nota de estado (2026-07-08):** El paso Labor ahora ofrece dos modos
> de precio (Hourly estimate / Fixed price); el botón de subir foto usa
> un estilo verde distintivo; y las fotos (current job, previous work,
> Portfolio, selector de Portfolio) se muestran como una galería de
> thumbnails en lugar de imágenes a tamaño completo. Ver
> [39-fixed-labor-pricing.md](39-fixed-labor-pricing.md),
> [40-proposal-total-refresh-fix.md](40-proposal-total-refresh-fix.md), y
> [41-photo-gallery-ui-fix.md](41-photo-gallery-ui-fix.md).

> **Nota de estado (2026-07-08, ronda 2):** Los pasos Labor y Materials &
> Costs se reestructuraron para que la diferencia entre "preview sin
> guardar" y "item guardado" sea imposible de confundir — el preview
> ahora dice explícitamente "Not saved yet", tiene un estilo visual
> distinto (borde punteado ámbar), y la lista de items guardados vive
> bajo un encabezado explícito "Saved labor"/"Saved costs" después del
> formulario. Ningún cálculo ni la fuente de datos del Pricing Summary
> cambiaron — ver la sección "Round 2" de
> [40-proposal-total-refresh-fix.md](40-proposal-total-refresh-fix.md#round-2-definitive-db-proof-and-the-actual-ux-fix).

## Routes

| Route | Purpose |
|---|---|
| `/proposals` | List, search, filter, paginate |
| `/proposals/new` | Step 1 — Client & Job |
| `/proposals/[proposalId]` | Overview — status, total, primary actions |
| `/proposals/[proposalId]/edit?step=…` | The 7-step builder (steps 2–7; step 1 lives at `/new`) |
| `/proposals/[proposalId]/preview` | Read-only professional document |
| `/portfolio`, `/portfolio/new`, `/portfolio/[id]`, `/portfolio/[id]/edit` | Reusable previous-work gallery |
| `/settings/proposals` | Tenant-wide proposal defaults |

## The stepper

`src/app/(protected)/proposals/[proposalId]/edit/stepper-nav.tsx` renders
Scope of Work → Labor → Materials & Costs → Photos → Terms & Pricing →
Review as plain links (`?step=scope`, `?step=labor`, …) — every step is a
real URL, reachable directly, refreshable, and shareable, not client-only
routing state. On mobile the stepper scrolls horizontally within its own
container (`.proposal-stepper`), never widening the page itself — verified
in `proposals.mobile.spec.ts`.

Client & Job (step 1) happens on `/proposals/new` before the proposal
exists at all — it can't be a step *within* the builder since the
proposal id doesn't exist yet at that point.

## Step-by-step

1. **Client & Job** (`/proposals/new`) — client, contact (optional),
   opportunity (optional — auto-created if omitted), title, service type.
   `ClientSelect` reloads the page with `?clientId=` on change (a small,
   focused Client Component, same pattern as `tenant-switcher.tsx`) so the
   server can refetch that client's contacts/open opportunities.
2. **Scope of Work** — sections with a type (`scope`/`schedule`/
   `materials`/`additional_services`/`exclusions`/`custom`), basic
   templates per service type (Interior Painting, Bathroom Remodeling,
   General Remodeling — structure only, no invented prices or quantities,
   matching the brief's explicit constraint).
3. **Labor** — the calculator, with a live client-side preview
   (`src/lib/proposals/calculations.ts`, explicitly labeled orientative)
   that's replaced by the real server value the instant the item is
   saved.
4. **Materials & Costs** — category, unit, quantity, unit price, taxable
   toggle, optional section assignment, live preview identical in spirit
   to Labor's.
5. **Photos** — two clearly separate areas: **Current job photos**
   (direct upload) and **Previous work** (select from the Portfolio,
   attaches the same underlying file rather than duplicating it).
6. **Terms & Pricing** — terms, exclusions, notes for client, discount
   type/value, tax rate, plus the running `PricingSummary` showing the
   server-computed breakdown.
7. **Review** — the full `ProposalDocument` (shared with the standalone
   Preview route so both always render identically), plus **Back to
   edit**, **Save draft**, a disabled **Send** button (tooltip: "Sending
   will be available in the Client Portal phase"), and **Mark ready**.

## Guarding a locked/non-draft version

Every step's mutation controls are conditionally rendered based on
`canEdit` (permission **and** `version_status === 'draft' && proposal.status === 'draft'`)
computed server-side in `edit/page.tsx` — hiding a control the user
couldn't use anyway is a UX nicety; the real enforcement is server-side
(see docs/31, docs/adr/0029).

## Preview

`src/app/(protected)/proposals/[proposalId]/proposal-document.tsx` renders,
in the brief's fixed order: business identity, proposal number, prepared
for, title, summary, scope, schedule, labor breakdown, materials & costs,
current-job photos, previous-work gallery, terms, exclusions, pricing
summary, total. No internal IDs, storage paths, or technical metadata are
ever rendered — photos are always shown via already-resolved signed URLs
computed server-side (`getSignedMediaUrls`), never a raw path.

## Dashboard

Rebuilt around Proposals (`src/app/(protected)/page.tsx`): **New
proposal** is the primary CTA (falls back to **New client** if the caller
lacks `proposals.create`), **View pipeline** is the secondary link.
Metrics: Draft/Ready/Sent/Accepted proposal counts (all real counts —
Sent/Accepted are correctly always 0 in Phase 2A since nothing can set
those statuses, never faked), Total quoted value (sum of the 5 most
recently updated non-archived proposals' totals), and **Needs
follow-up** — a real, computed signal (proposals `ready` for 3+ days
without moving forward), not an invented one, per the brief's explicit
"no presentar seguimiento inexistente como activo."

## Navigation

`src/app/(protected)/nav-items.ts` now builds three groups:

- **Main** (desktop sidebar, full list): Dashboard, Proposals, Clients,
  Pipeline, Projects, Portfolio.
- **Administration** (visually separated section): Members, Proposal
  Settings, Profile.
- **Bottom nav** (mobile, capped at 5 per the brief): the first 5 of
  Main — Dashboard, Proposals, Clients, Pipeline, Projects. Portfolio is
  deliberately excluded from the mobile bottom bar to keep Proposals (the
  new primary workflow) always present within the 5-item limit; Portfolio
  stays reachable via the sidebar on desktop and from within the
  Proposal Builder's Photos step on mobile.

## Opportunity integration

The Opportunity detail page (`src/app/(protected)/opportunities/[opportunityId]/page.tsx`)
now shows a **Proposal** section: **Create proposal** (primary) if none
exists, or the active proposal's status/total/last-updated plus **Open
proposal** if one does. **Convert to project** is kept, fully functional,
but relabeled as a legacy flow and visually demoted below the Proposal
section.

## Mobile-first specifics

- Every table (labor items, line items, proposals list) uses the existing
  `.table-card` → per-row `<td data-label>` card transformation below
  640px, unchanged from Phase 1.6.
- Live preview tiles (`.metric-tile`) never overflow the viewport —
  verified in `proposals.mobile.spec.ts` via explicit bounding-box checks.
- No autosave complexity: each step has an explicit "Save and continue" /
  "+ Add …" action with loading state (`SubmitButton`'s `pending` state)
  and field-level or banner errors on failure — matching section 33 of
  the brief exactly (no complex autosave, no lost input on error).
