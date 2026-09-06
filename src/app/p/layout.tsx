/**
 * Client Portal (Phase 3A) — deliberately its own layout, not the
 * contractor app shell. No sidebar, no topbar, no tenant switcher, and no
 * auth check here: proxy.ts allows every /p/* path through unauthenticated
 * (a portal visitor never has a Supabase Auth session), and every page
 * under this tree does its own link/session validation directly against
 * the database — see docs/53-client-portal-security.md.
 */
export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return <div className="portal-page">{children}</div>;
}
