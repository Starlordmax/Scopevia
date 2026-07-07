export type NavItem = {
  href: string;
  label: string;
};

/**
 * Plain data only (href + label) — no icon component references. Passing a
 * component TYPE as a prop from a Server Component (this file is imported by
 * layout.tsx) to a Client Component (SidebarNav/BottomNav) is not valid RSC
 * serialization ("Only plain objects can be passed..."). Icons are resolved
 * client-side instead, keyed by href — see sidebar-nav.tsx/bottom-nav.tsx.
 *
 * Phase 2A (docs/29-proposal-centric-product-pivot.md, section "Navegación"):
 * `main` is the full desktop sidebar list; `admin` is a visually separate,
 * lower-priority group (Members/Proposal Settings/Profile). `bottomNav` caps
 * at 5 items per the brief's explicit "no more than five in bottom nav" —
 * Portfolio is deliberately excluded from the mobile bottom bar (still
 * reachable via the sidebar / from within the Proposal Builder's photo
 * step) so Proposals, the new primary workflow, always has a slot.
 */
export function buildNavItems(flags: {
  canViewProposals: boolean;
  canViewClients: boolean;
  canViewOpportunities: boolean;
  canViewProjects: boolean;
  canViewPortfolio: boolean;
  canViewMembers: boolean;
  canViewProposalSettings: boolean;
}): { main: NavItem[]; admin: NavItem[]; bottomNav: NavItem[] } {
  const main: NavItem[] = [{ href: "/", label: "Dashboard" }];
  if (flags.canViewProposals) main.push({ href: "/proposals", label: "Proposals" });
  if (flags.canViewClients) main.push({ href: "/clients", label: "Clients" });
  if (flags.canViewOpportunities) main.push({ href: "/pipeline", label: "Pipeline" });
  if (flags.canViewProjects) main.push({ href: "/projects", label: "Projects" });
  if (flags.canViewPortfolio) main.push({ href: "/portfolio", label: "Portfolio" });

  const admin: NavItem[] = [];
  if (flags.canViewMembers) admin.push({ href: "/members", label: "Members" });
  if (flags.canViewProposalSettings) admin.push({ href: "/settings/proposals", label: "Proposal Settings" });
  admin.push({ href: "/profile", label: "Profile" });

  const bottomNav = main.slice(0, 5);

  return { main, admin, bottomNav };
}
