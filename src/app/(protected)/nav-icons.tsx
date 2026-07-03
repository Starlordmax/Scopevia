"use client";

import type { LucideIcon } from "lucide-react";
import { LayoutDashboard, Users, Kanban, Briefcase, UserCog } from "lucide-react";

const ICONS_BY_HREF: Record<string, LucideIcon> = {
  "/": LayoutDashboard,
  "/clients": Users,
  "/pipeline": Kanban,
  "/projects": Briefcase,
  "/members": UserCog,
};

export function iconForHref(href: string): LucideIcon {
  return ICONS_BY_HREF[href] ?? LayoutDashboard;
}
