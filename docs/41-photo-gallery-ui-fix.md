# 41 — Photo Upload Button & Thumbnail Gallery UI Fix

Status: **Implemented and verified.**

## Problems

1. The "Upload photo" button used the same gray `.button-secondary`
   style as every other secondary control on the page — nothing visually
   marked it as the action for adding an image.
2. An uploaded photo rendered at `width: 100%` inside a
   `.metrics-grid` cell (a grid built for a handful of wide dashboard
   metric tiles, `minmax(180px, 1fr)`, no height cap) — with more than
   one or two photos, or a portrait-oriented one, this could occupy most
   of the visible page.

## Fix — upload button

A new `.button-success` class (`src/app/globals.css`): `background:
#16a34a`, `color: white`, `border-color: #16a34a`, `background:
#15803d` on hover. Added to the same shared box-model selector list as
`.button-primary`/`.button-secondary`/`.button-danger` (a real prior bug
in this codebase — documented in `globals.css` itself — was a button
class rendering unstyled because it was left out of exactly this
selector list; not repeated here).

Green is reserved for this one purpose (photo upload) and is not reused
for any destructive action, per the brief.

Focus visibility does not depend on the color change alone: the existing
global `button:focus-visible { outline: 2px solid var(--color-primary);
}` rule already applies to every button regardless of class, so
`.button-success` gets a visible (blue) focus outline the same as every
other button — a shape-based indicator, not a color-only one.

Button text is now specific to context, per the brief: **"Upload job
photo"** (current-job photos, Proposal Builder) and **"Upload portfolio
photo"** (Portfolio project detail page) — previously both said the
generic "Upload photo."

## Fix — thumbnail gallery

New CSS (`src/app/globals.css`): `.photo-grid` (`display: grid;
grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap:
12px;`, collapsing to 2 columns under 480px and 1 column under 340px),
`.photo-card` (bordered, rounded container), `.photo-thumb` (`height:
150px; object-fit: cover;` — never distorted, never unbounded), and
`.photo-thumb-lg` (`height: 220px`, used only in the full proposal
document per the brief's "puede mostrar imágenes más grandes, pero
igualmente con tamaño controlado" — larger, still capped).

Applied everywhere a photo renders outside the full document view:

- Proposal Builder → Photos step: current-job photos and previous-work
  photos (`step-photos.tsx`).
- Proposal Builder → Photos step: the "Select from Portfolio" picker,
  which previously showed **no image at all**, just a text row — now
  shows an actual thumbnail per option, so a contractor can recognize
  the photo before adding it. This required extending
  `getPortfolioMediaOptions()` (`src/lib/proposals/portfolio-options.ts`)
  to also fetch and sign each option's `storage_path` (batched via the
  existing `getSignedMediaUrls()`, one round trip, not one per photo).
- Portfolio project detail page (`portfolio/[portfolioId]/page.tsx`).

Applied with the larger `.photo-thumb-lg` variant in:

- `proposal-document.tsx` (the Review step and the standalone `/preview`
  route share this component) — current-job and previous-work sections.

The Portfolio **list** page's project cards (`portfolio/page.tsx`) were
deliberately left on `.metrics-grid` — they show a title and a photo
*count* badge, not an actual image, so they aren't part of this problem.

## Tests

- **E2E** (`tests/e2e/proposals.spec.ts`, extended "Portfolio" test):
  asserts the upload button has the `button-success` class; uploads 3
  photos and asserts all 3 render as `.photo-card`/`.photo-thumb`
  elements in the grid; asserts a thumbnail's bounding box is well under
  half the viewport width and capped at the 150px thumbnail height —
  i.e., actually measures the rendered size, not just the presence of a
  CSS class.
- **E2E mobile** (`tests/e2e/proposals.mobile.spec.ts`, extended
  "stepper, forms, and pricing summary" test): asserts the job-photo
  upload button is green, fits within the 390px viewport, and meets a
  minimum touch-target height; uploads a photo and asserts the resulting
  thumbnail is under 70% of the (390px) viewport width, confirming the
  2-column mobile layout is actually in effect, not just declared in
  CSS.
- Storage/tenant-isolation/signed-URL behavior is unchanged and
  continues to be covered by `tests/rls/phase2a-storage.test.ts` — this
  fix touches only display markup and CSS, never the upload/signing
  path itself.

## Known limitations

No lazy-loading or pagination for large photo grids (a Portfolio project
or a proposal with dozens of photos renders all of them at once) — not
addressed here, as it wasn't part of the reported problem and would be
new functionality beyond this fix's scope.
