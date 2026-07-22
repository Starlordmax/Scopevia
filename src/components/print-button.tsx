"use client";

/**
 * Triggers the browser's native print dialog, from which the user can pick
 * "Save as PDF" — see docs/60-proposal-pdf-print-export.md for why this
 * phase uses print-to-PDF rather than a server-generated PDF. Always
 * `.no-print` (hidden in the actual print/PDF output via the print media
 * query in globals.css) — it would otherwise appear as a stray button on
 * every page of the exported document.
 */
export function PrintButton({ label = "Print / Save as PDF" }: { label?: string }) {
  return (
    <button type="button" className="button-primary no-print" onClick={() => window.print()}>
      {label}
    </button>
  );
}
