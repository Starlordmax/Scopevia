/**
 * Pure copy for the Phase 3C exported/printed proposal document — kept
 * separate from proposal-document.tsx so the wording itself is
 * unit-testable, same pattern as src/lib/proposals/revision-copy.ts.
 */

/**
 * Shown under an "Accepted by ..." client response in the exported
 * document. Deliberately does NOT call this a legal e-signature or promise
 * any legal validity — see docs/60-proposal-pdf-print-export.md, "Not a
 * legal e-signature," which carries forward the same caveat Phase 3B's
 * portal accept flow already made.
 */
export function acceptanceRecordFootnote(): string {
  return "This approval records that the client reviewed and accepted the proposal shown in this document.";
}

/** Shown when a photo's signed URL could not be generated, instead of silently omitting the photo. */
export function imageUnavailableLabel(): string {
  return "Image unavailable";
}
