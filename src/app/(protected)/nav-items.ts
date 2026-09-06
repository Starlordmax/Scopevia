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
 * Phase 2A.1 (docs/38-navigation-simplification.md): Pipeline and Projects
 * are no longer visible modules — the underlying opportunities/projects
 * tables and RPCs are untouched, only these two nav entries are gone.
 * `main` is the full desktop sidebar list; `admin` is a visually separate,
 * lower-priority group (Members/Proposal Settings/Profile). `bottomNav` is
 * the mobile bar's primary 4 slots (Home/Proposals/New/Clients); `more`
 * holds the remaining destinations (Portfolio + the admin group) rendered
 * behind a 5th "More" toggle in BottomNav — never a new route, since the
 * brief explicitly forbids adding routes that don't already exist.
 */
export function buildNavItems(flags: {
  canViewProposals: boolean;
  canCreateProposal: boolean;
  canViewClients: boolean;
  canViewPortfolio: boolean;
  canViewMembers: boolean;
  canViewProposalSettings: boolean;
}): { main: NavItem[]; admin: NavItem[]; bottomNav: NavItem[]; more: NavItem[] } {
  const main: NavItem[] = [{ href: "/", label: "Dashboard" }];
  if (flags.canViewProposals) main.push({ href: "/proposals", label: "Proposals" });
  if (flags.canViewClients) main.push({ href: "/clients", label: "Clients" });
  if (flags.canViewPortfolio) main.push({ href: "/portfolio", label: "Portfolio" });

  const admin: NavItem[] = [];
  if (flags.canViewMembers) admin.push({ href: "/members", label: "Members" });
  if (flags.canViewProposalSettings) admin.push({ href: "/settings/proposals", label: "Proposal Settings" });
  admin.push({ href: "/profile", label: "Profile" });

  const bottomNav: NavItem[] = [{ href: "/", label: "Home" }];
  if (flags.canViewProposals) bottomNav.push({ href: "/proposals", label: "Proposals" });
  if (flags.canCreateProposal) bottomNav.push({ href: "/proposals/new", label: "New" });
  if (flags.canViewClients) bottomNav.push({ href: "/clients", label: "Clients" });

  const more: NavItem[] = [];
  if (flags.canViewPortfolio) more.push({ href: "/portfolio", label: "Portfolio" });
  more.push(...admin);

  return { main, admin, bottomNav, more };
}
