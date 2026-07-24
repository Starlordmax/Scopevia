# 60 — Proposal PDF / Print Export (Phase 3C)

Status: **Implemented and verified** — 11 new unit tests
(`export-copy.test.ts` plus additions), 11 new RLS/integration tests
(`phase3c-proposal-export.test.ts`), 6 new E2E tests
(`proposal-export.spec.ts` + `proposal-export.mobile.spec.ts`).

> **Phase 3D adds email notifications, never a PDF attachment** — a
> notification links back into Scopevia; exporting the proposal itself is
> still always a separate, manual "Print / Save as PDF" action — see
> [docs/62-proposal-email-notifications.md](62-proposal-email-notifications.md).
>
> **Phase 3D.2 adds an optional business logo** to the printed document's
> header, next to the business name — see
> [docs/69-business-branding-logo-upload.md](69-business-branding-logo-upload.md).
> Everything below about the export routes, document layout, and print
> stylesheet is otherwise unchanged.
>
> No PDF is generated on a server. This phase implements **print-to-PDF**:
> a clean, control-free HTML document plus a print stylesheet, exported via
> the browser's own "Print → Save as PDF." See "Export approach" below for
> why, and [docs/61](61-export-version-safety.md) for the security/
> version-safety half of this phase.

## The flow

```text
Contractor app:
  /proposals/[id] → "Print / Save as PDF" → /proposals/[id]/print
  /proposals/[id] → Version History → "Print" on any row →
    /proposals/[id]/print?version=<historical version id>

Client Portal:
  /p/[token]/view → "Print / Save as PDF" → /p/[token]/print

Either route → browser's native print dialog → "Save as PDF"
```

## Export approach: print-to-PDF, not server-generated PDF

The brief allows either approach and explicitly recommends print-to-PDF
"if it avoids server-side Chromium complexity." That recommendation is
followed here, for reasons specific to this codebase, not just the general
preference:

1. **`ProposalDocument` was already exactly what a PDF needs.** Diagnostic
   pass on `src/app/(protected)/proposals/[proposalId]/proposal-document.tsx`
   confirmed it renders zero edit controls, zero internal IDs, and already
   resolves every photo through a signed URL before render — see "Diagnosis
   findings" below. A server-PDF pipeline would still need to render this
   exact component (or reimplement its layout in a PDF-drawing API) — the
   hard part was already solved by Phase 2A/3A, not by this phase.
2. **No new deployment dependency.** A real server-side PDF (Puppeteer/
   headless Chromium, or a hosted rendering API) means either bundling a
   ~100+ MB Chromium binary into a serverless function (risking cold-start
   timeouts and bundle-size limits on typical Next.js hosting) or adding an
   external network dependency and its own failure mode, cost, and
   security surface (rendering arbitrary HTML server-side). Print-to-PDF
   needs zero new npm packages and zero new infrastructure.
3. **Every modern browser already does this well**, desktop and mobile,
   with zero extra code: "Print → Save as PDF" is a standard, familiar
   action for anyone who has ever saved a boarding pass or a receipt.
4. **Photos work identically either way.** The signed URLs
   `getFullProposal()`/`getFullProposalForPortal()` already generate are
   plain `<img src>` values — a browser's print renderer loads them exactly
   like any other page image, no special "how do I get a private image into
   a server-rendered PDF" problem to solve.

**Deferred, not rejected**: a true server-generated PDF (e.g. for a future
"email the client a PDF attachment" flow, which this phase explicitly does
not implement) is a reasonable future enhancement — see "Known
limitations."

## Diagnosis findings (before writing any code)

1. **Can `ProposalDocument` be reused as the exportable document?** Yes,
   almost as-is. It already has no controls and no internal IDs; only
   additions were a "Prepared" date line, an optional Client Response
   section, and a photo-unavailable fallback (all three benefit every
   existing caller — builder Review step, `/preview`, the portal view —
   not just the new export routes).
2. **What internal controls need hiding?** None were ever inside
   `ProposalDocument` itself. The controls that needed hiding live in the
   PAGES around it: the app shell (sidebar/topbar), the "Back"/edit links,
   and (portal side) the Accept/Decline section. Solved by giving both
   export routes their own bare layout (see "Routes" below) rather than
   patching print CSS onto the shared app shell.
3. **Do images load in print?** Yes, unchanged — the existing signed-URL
   plumbing (`getSignedMediaUrls`/`getSignedMediaUrlsForPortal`) already
   resolves every photo server-side before the page ever renders.
4. **Can the portal export only the linked version?** Yes, already
   guaranteed structurally by `portal_get_session_context()` (Phase 3B.1
   hardened this exact path for historical/superseded versions — see
   [docs/61](61-export-version-safety.md)).
5. **Can the contractor export current AND historical versions?** Needed a
   small addition: `getFullProposal()` gained an optional `versionId`
   parameter (defaults to current). See [docs/61](61-export-version-safety.md).
6. **Was a dedicated print route needed?** Yes — see "Routes" below for why
   a shared-layout + print-CSS-only approach was rejected in favor of a
   genuinely bare route.
7. **Server PDF needed, or is print-to-PDF sufficient?** Print-to-PDF —
   see "Export approach" above.

## Routes

Both are **dedicated, bare-layout routes** — not the shared app shell (or,
on the portal side, the existing `/view` page) with print CSS bolted on.
This was a deliberate choice over "just add `@media print` to the existing
pages": a dedicated route guarantees zero UI leakage even if a print-CSS
rule were ever missed, gives a genuinely clean **on-screen** preview (not
just a clean print output), and produces a stable, bookmarkable/shareable
URL for a specific version's export.

- **`/proposals/[proposalId]/print`** — a **sibling** route tree to the
  `(protected)` route group (`src/app/proposals/[proposalId]/print/`, own
  `layout.tsx`), the same pattern the Client Portal (`src/app/p/`) already
  established for "a document that must never show app chrome." Reachable
  only by an authenticated user (enforced by `proxy.ts`'s default
  authenticated-required behavior — this path isn't in its allow-list);
  the page itself re-validates tenant, `proposals.view`, and proposal
  ownership via `getFullProposal()`, exactly like every other proposal
  page. `?version=<id>` optionally selects a historical version — see
  [docs/61](61-export-version-safety.md).
- **`/p/[token]/print`** — under the Client Portal's existing bare
  `src/app/p/layout.tsx`. Revalidates the session via
  `portal_get_session_context()` on every load, identically to `/view` —
  no new trust decision, no new function.

Both pages render: a `.no-print` header (a "Back" link + the `PrintButton`
component, `src/components/print-button.tsx` — a client component that
calls `window.print()`), then `<ProposalDocument>` inside a `.section-card`.
Neither page renders Accept/Decline, edit forms, or any portal-link
management controls — those actions stay on their own existing pages.

## UI microcopy

Both routes show, above the document (hidden from print via `.no-print`):

> Create a clean printable version of this proposal. Use your browser's
> Save as PDF option to download it.

The button/link label is always **"Print / Save as PDF"** — never
"Download PDF," since no file is generated by the server; the copy is
honest about what actually happens (see the brief's own instruction on
this point).

## Client response section

Rendered by `ProposalDocument` itself when a `clientResponse` prop is
passed (omitted entirely — not even an empty section — when there is
none, matching the rest of the document's "hide sections with nothing to
show" convention):

- **Accepted**: "Accepted by {name}", email, timestamp, and a footnote
  (`acceptanceRecordFootnote()`, `src/lib/proposals/export-copy.ts`) —
  "This approval records that the client reviewed and accepted the
  proposal shown in this document." Deliberately does **not** call this a
  legal e-signature or claim legal validity, carrying forward the same
  caveat Phase 3B's portal accept flow already made.
- **Declined**: "Declined by {email}", timestamp, and the reason if one was
  given.

## Image handling

Unchanged from every prior phase's signed-URL discipline — see
[docs/33](33-media-and-storage-security.md) and
[docs/53](53-client-portal-security.md). New in this phase: if a photo's
signed URL is `null` (a real failure, not merely "no photos yet"),
`ProposalDocument` now renders a `photo-unavailable` placeholder
("Image unavailable," `imageUnavailableLabel()`) instead of silently
omitting the photo — so a single failed image can never make the rest of
the document look broken or incomplete, and the grid layout doesn't shift.

## Print stylesheet

Added to `src/app/globals.css` (`@media print`, plus supporting classes):
white background, `.no-print` hides on-screen-only controls, `break-inside:
avoid` on sections/tables/photo-cards/pricing-summary (so a card is never
split awkwardly across a page boundary), `break-after: avoid` on headings,
a tighter photo grid (3 columns) and shorter thumbnail height for print,
and a suppressed `content` for `a[href]::after` (Chromium's default
"print the URL after every link" is noise here — every link in this
document is internal navigation, not a citation).

## Accessibility / UX

- Both print/export links have clear text labels ("Print / Save as PDF") —
  no icon-only buttons.
- `PrintButton` shows no separate loading state — `window.print()` is
  synchronous from the page's perspective (the browser's own print dialog
  provides its own progress/cancel UI); there is nothing this app needs to
  await or that could silently fail without the browser itself surfacing
  it.
- No popups: `window.print()` opens the browser's native print dialog, not
  a new window/tab — nothing for a popup blocker to interfere with.
- Mobile: verified directly (`tests/e2e/proposal-export.mobile.spec.ts`) —
  the portal's "Print / Save as PDF" link is visible and the export view
  itself has no horizontal overflow at 390×844.

## Known limitations

- **No true server-generated PDF.** Deferred — see "Export approach"
  above. If a future phase needs a PDF *file* (e.g. to email as an
  attachment, which this phase explicitly does not implement), that would
  be the point to introduce a server-side renderer, informed by this
  phase's already-solved "what does the document look like" question.
- **No running page footer with page numbers.** Reliable print running-
  footers require `@page` margin-box CSS, which has inconsistent browser
  support; the browser's own print dialog already offers a "Headers and
  footers" toggle with page numbers, so this wasn't duplicated. A static
  "Proposal #N" footer element is included, but it does not repeat per
  physical page the way a true running footer would.
- **No PDF, Stripe, payments, deposits, e-signature, or email
  notifications** — unchanged, explicitly out of scope per the brief.
- **Job location / expiration date are not shown** because neither field
  exists anywhere in the current data model (`proposals`/
  `proposal_versions` have no such columns) — the brief itself only asked
  for them "si existe." Adding those fields would be new schema scope, not
  requested by this phase.
