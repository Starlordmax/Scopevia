"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { LogOut } from "lucide-react";
import type { NavItem } from "./nav-items";
import { iconForHref, MoreIcon } from "./nav-icons";
import { signOutAction } from "../../actions/auth";

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Mobile bottom nav: 4 primary destinations plus a "More" toggle for the
 * remaining ones (Portfolio + the admin group), capped at 5 visible slots
 * total per docs/38-navigation-simplification.md. "More" is an in-page
 * disclosure, not a route — the brief explicitly forbids adding routes
 * that don't already exist, and every link inside it points to a page
 * that's already reachable from the desktop sidebar.
 */
export function BottomNav({ items, more }: { items: NavItem[]; more: NavItem[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <>
      {open && more.length > 0 ? (
        <>
          <button type="button" aria-label="Close menu" className="bottom-nav-more-backdrop" onClick={() => setOpen(false)} />
          <div className="bottom-nav-more-panel" role="menu">
            {more.map((item) => {
              const Icon = iconForHref(item.href);
              return (
                <Link key={item.href} href={item.href} className="bottom-nav-more-link" onClick={() => setOpen(false)}>
                  <Icon size={18} aria-hidden="true" />
                  {item.label}
                </Link>
              );
            })}
            <form action={signOutAction}>
              <button type="submit" className="bottom-nav-more-link bottom-nav-more-signout">
                <LogOut size={18} aria-hidden="true" />
                Sign out
              </button>
            </form>
          </div>
        </>
      ) : null}

      <nav className="bottom-nav" aria-label="Primary">
        {items.map((item) => {
          const Icon = iconForHref(item.href);
          const active = isActive(pathname, item.href);
          return (
            <Link key={item.href} href={item.href} className="bottom-nav-link" data-active={active} onClick={() => setOpen(false)}>
              <Icon size={20} aria-hidden="true" />
              {item.label}
            </Link>
          );
        })}
        {more.length > 0 ? (
          <button
            type="button"
            className="bottom-nav-link bottom-nav-more-toggle"
            data-active={open}
            aria-expanded={open}
            aria-haspopup="menu"
            onClick={() => setOpen((v) => !v)}
          >
            <MoreIcon size={20} aria-hidden="true" />
            More
          </button>
        ) : null}
      </nav>
    </>
  );
}
