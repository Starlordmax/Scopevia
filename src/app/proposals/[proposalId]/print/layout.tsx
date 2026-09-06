/**
 * Contractor proposal export/print (Phase 3C) — deliberately its own bare
 * layout, sibling to (not nested under) the (protected) route group, so it
 * never inherits the app shell (sidebar/topbar/tenant switcher). Same
 * reasoning as the Client Portal's own layout (src/app/p/layout.tsx): a
 * document meant to be printed or saved as a PDF should never risk showing
 * app chrome, even if a print-CSS rule were ever missed. Reachable only by
 * an authenticated tenant member — proxy.ts requires a session for any path
 * outside its explicit allow-list, and the page itself independently
 * re-validates tenant membership, permission, and proposal ownership (see
 * page.tsx) — see docs/60-proposal-pdf-print-export.md.
 */
export default function ProposalPrintLayout({ children }: { children: React.ReactNode }) {
  return <div className="print-page">{children}</div>;
}
