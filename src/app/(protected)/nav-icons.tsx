"use client";

import type { LucideIcon } from "lucide-react";
import { LayoutDashboard, FileText, Users, Kanban, Briefcase, Images, UserCog, Settings2, CircleUserRound } from "lucide-react";

const ICONS_BY_HREF: Record<string, LucideIcon> = {
  "/": LayoutDashboard,
  "/proposals": FileText,
  "/clients": Users,
  "/pipeline": Kanban,
  "/projects": Briefcase,
  "/portfolio": Images,
  "/members": UserCog,
  "/settings/proposals": Settings2,
  "/profile": CircleUserRound,
};

export function iconForHref(href: string): LucideIcon {
  return ICONS_BY_HREF[href] ?? LayoutDashboard;
}
