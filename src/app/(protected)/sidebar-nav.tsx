"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2 } from "lucide-react";
import type { NavItem } from "./nav-items";
import { iconForHref } from "./nav-icons";

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SidebarNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();

  return (
    <aside className="sidebar" aria-label="Primary">
      <div className="sidebar-brand">
        <Building2 className="icon" size={22} aria-hidden="true" />
        Scopevia
      </div>
      <nav className="sidebar-nav">
        {items.map((item) => {
          const Icon = iconForHref(item.href);
          const active = isActive(pathname, item.href);
          return (
            <Link key={item.href} href={item.href} className="sidebar-link" data-active={active}>
              <Icon className="icon" size={18} aria-hidden="true" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
