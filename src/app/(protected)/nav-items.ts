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
 */
export function buildNavItems(flags: {
  canViewClients: boolean;
  canViewOpportunities: boolean;
  canViewProjects: boolean;
  canViewMembers: boolean;
}): NavItem[] {
  const items: NavItem[] = [{ href: "/", label: "Dashboard" }];
  if (flags.canViewClients) items.push({ href: "/clients", label: "Clients" });
  if (flags.canViewOpportunities) items.push({ href: "/pipeline", label: "Pipeline" });
  if (flags.canViewProjects) items.push({ href: "/projects", label: "Projects" });
  if (flags.canViewMembers) items.push({ href: "/members", label: "Members" });
  return items;
}
