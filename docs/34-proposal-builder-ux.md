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

> **Nota de estado (2026-07-09, Phase 2B):** Materials & Costs ahora
> incluye un catálogo de materiales con precio por ZIP: un campo de ZIP
> (con la advertencia explícita de que cambiarlo solo afecta a
> materiales agregados después), búsqueda/filtro por categoría, una
> tabla de resultados con precio resuelto para ese ZIP (o "No price
> available for this ZIP" si no hay ninguno), y un formulario compacto
> por fila para agregar (cantidad, sección opcional, y — solo para
> quien tiene `proposals.manage_pricing` — un override de precio
> opcional). El formulario "Add custom cost" existente se mantiene sin
> cambios de comportamiento, solo relabeled a "Add a custom cost" para
> distinguirlo del catálogo. Ver
> [42-material-catalog-by-zip.md](42-material-catalog-by-zip.md). El
> detalle de la propuesta también ganó una sección "Danger zone"
> colapsada (Delete/Restore, con confirmación) — ver
> [43-proposal-delete-archive.md](43-proposal-delete-archive.md).

> **Nota de estado (2026-07-09, Phase 2B.1):** El campo de ZIP y el
> catálogo (búsqueda + resultados) ahora viven en un solo panel unificado
> ("Material pricing"), en vez de dos cards separados — la búsqueda de
> texto ahora también encuentra por description/brand/supplier_name (no
> solo por name), y hay tres empty states distintos (sin ZIP, sin
> coincidencias, o coincidencias sin precio para ese ZIP) en vez de un
> solo mensaje genérico. Se encontró y corrigió un bug real: un filtro de
> categoría o búsqueda vacío ("", el valor literal que envía la opción
> "All categories") llegaba a la función SQL como `''` en vez de `null`,
> y `category = ''` no coincidía con nada — la corrección normaliza esto
> dentro de la función misma, no solo en el cliente. Ver
> [42-material-catalog-by-zip.md](42-material-catalog-by-zip.md#zip--search-one-unified-panel).

> **Nota de estado (2026-07-09/10, Phase 2C):** Se agregó un nuevo step
> **Measurements** al inicio del stepper (antes de Scope of Work) —
> manual entry (rectángulo/área directa/lineal, con preview de
> área/perímetro/waste) y Draw layout (dibujar un rectángulo simple,
> calibrarlo con una medida real, guardar). Desde una medición se puede
> generar un material de catálogo (por ZIP, con snapshot) o mano de obra
> (`pricing_method` `area`/`linear`, nuevo). Ver
> [45-measurements-takeoff-builder.md](45-measurements-takeoff-builder.md).
> **(Corregido en Phase 2D — ver nota más abajo: crear una propuesta
> ahora redirige a Measurements, no a Scope.)**

> **Nota de estado (2026-07-13, Phase 2D — visual review & UX polish):**
> Pase de pulido visual/microcopy sin cambios de backend salvo un bug
> real encontrado y corregido: `createProposalDirectAction` /
> `createProposalFromOpportunityAction` redirigían a `?step=scope` tras
> crear una propuesta — un remanente de antes de que Measurements
> existiera como step — ahora redirigen a `?step=measurements`, el
> primer paso real del stepper. Además: iconos distintos por tile en el
> Dashboard (antes los 6 usaban el mismo ícono de documento); texto
> explicativo agregado en Measurements (Manual entry vs Draw layout),
> Labor (Hourly vs Fixed, y Generate labor from measurement), y Photos
> (Current job vs Previous work); ejemplos concretos en el campo de
> reference length del Draw layout; se eliminaron referencias a "Phase
> N"/"Supabase Auth" que aparecían en texto visible al usuario (Proposal
> Settings, Members, Profile); 5 páginas de listado que mostraban el
> mensaje de error crudo de Postgres ahora muestran un mensaje genérico
> amigable; los botones "Remove" en los steps del builder (antes
> `<button>` planos sin feedback) ahora usan `SubmitButton` con estado
> de carga. Ver [docs/49](49-phase-2d-ux-polish.md) y
> [docs/50](50-visual-review-notes.md) para el detalle completo y las
> capturas de pantalla generadas.

> **Nota de estado (2026-07-15, Phase 2D.1 — material catalog
> pagination):** El catálogo de materiales ahora pagina server-side (20
> resultados por página, "Load more materials" en vez de paginación
> numerada) — antes traía hasta 200 filas sin límite y las renderizaba
> todas, lo que en mobile producía más de 30,000px de scroll. La
> búsqueda y el filtro de categoría siguen funcionando igual; el precio
> por ZIP y el snapshot al agregar a la propuesta no cambiaron. Ver
> [docs/51](51-material-catalog-pagination.md) y
> [docs/42](42-material-catalog-by-zip.md#pagination-phase-2d1).

> **Nota de estado (2026-07-15, Phase 3A — Client Portal):** La página de
> detalle de la propuesta (`/proposals/[proposalId]`) ahora incluye una
> sección "Client portal" (visible con `proposal_portal_links.view`): crear
> un link seguro (solo si la propuesta está `ready`), copiar la URL (se
> muestra una sola vez), ver la lista de links con su estado/expiración/
> última vista, y revocar uno activo. El link abre un flujo público fuera
> del shell de la app (`/p/[token]` → `/p/[token]/verify` →
> `/p/[token]/view`) donde el cliente verifica su email con un código de un
> solo uso antes de ver una versión de solo lectura de la propuesta (el
> mismo `ProposalDocument` que usa Preview). Ver
> [docs/52](52-client-portal-foundation.md).

## Routes

| Route | Purpose |
|---|---|
| `/proposals` | List, search, filter, paginate |
| `/proposals/new` | Step 1 — Client & Job |
| `/proposals/[proposalId]` | Overview — status, total, primary actions |
| `/proposals/[proposalId]/edit?step=…` | The 8-step builder (steps 2–8; step 1 lives at `/new`) |
| `/proposals/[proposalId]/preview` | Read-only professional document |
| `/portfolio`, `/portfolio/new`, `/portfolio/[id]`, `/portfolio/[id]/edit` | Reusable previous-work gallery |
| `/settings/proposals` | Tenant-wide proposal defaults |

## The stepper

`src/app/(protected)/proposals/[proposalId]/edit/stepper-nav.tsx` renders
Measurements → Scope of Work → Labor → Materials & Costs → Photos →
Terms & Pricing → Review as plain links (`?step=measurements`,
`?step=scope`, `?step=labor`, …) — every step is a real URL, reachable
directly, refreshable, and shareable, not client-only routing state. On
mobile the stepper scrolls horizontally within its own container
(`.proposal-stepper`), never widening the page itself — verified in
`proposals.mobile.spec.ts`.

Client & Job (step 1) happens on `/proposals/new` before the proposal
exists at all — it can't be a step *within* the builder since the
proposal id doesn't exist yet at that point.

## Step-by-step

1. **Client & Job** (`/proposals/new`) — client, contact (optional),
   opportunity (optional — auto-created if omitted), title, service type.
   `ClientSelect` reloads the page with `?clientId=` on change (a small,
   focused Client Component, same pattern as `tenant-switcher.tsx`) so the
   server can refetch that client's contacts/open opportunities.
2. **Measurements** — record room/surface dimensions (manual entry or
   drawn — see [docs/45](45-measurements-takeoff-builder.md)) and
   optionally generate a catalog material or priced labor item directly
   from a measurement's area/perimeter/linear length.
3. **Scope of Work** — sections with a type (`scope`/`schedule`/
   `materials`/`additional_services`/`exclusions`/`custom`), basic
   templates per service type (Interior Painting, Bathroom Remodeling,
   General Remodeling — structure only, no invented prices or quantities,
   matching the brief's explicit constraint).
4. **Labor** — the calculator, with a live client-side preview
   (`src/lib/proposals/calculations.ts`, explicitly labeled orientative)
   that's replaced by the real server value the instant the item is
   saved.
5. **Materials & Costs** — a ZIP-priced material catalog (search,
   category filter, resolved price, add flow) plus the original manual
   "Add a custom cost" form (category, unit, quantity, unit price,
   taxable toggle, optional section assignment, live preview identical
   in spirit to Labor's) for anything not in the catalog. See
   [docs/42](42-material-catalog-by-zip.md).
6. **Photos** — two clearly separate areas: **Current job photos**
   (direct upload) and **Previous work** (select from the Portfolio,
   attaches the same underlying file rather than duplicating it).
7. **Terms & Pricing** — terms, exclusions, notes for client, discount
   type/value, tax rate, plus the running `PricingSummary` showing the
   server-computed breakdown.
8. **Review** — the full `ProposalDocument` (shared with the standalone
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
date, prepared for, title, summary, scope, **measurements** (Phase 2C —
name, type, dimensions, area, perimeter, waste, and any material/labor
generated from each one), schedule, labor breakdown, materials & costs,
current-job photos, previous-work gallery, terms, exclusions, pricing
summary, total, and — when the version has one — a **client response**
section (Phase 3C). No internal IDs, storage paths, `shape_data` JSON, or
technical metadata are ever rendered — photos are always shown via
already-resolved signed URLs computed server-side (`getSignedMediaUrls`),
never a raw path; a photo whose signed URL failed shows a friendly "Image
unavailable" placeholder (Phase 3C) rather than silently disappearing.

**Phase 3C** reuses this exact component for a dedicated, control-free
print/export view (`/proposals/[id]/print`, plus `/p/[token]/print` on the
Client Portal) — see [docs/60](60-proposal-pdf-print-export.md) and
[docs/61](61-export-version-safety.md).

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
