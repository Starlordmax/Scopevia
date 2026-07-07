"use client";

import type { LucideIcon } from "lucide-react";
import { LayoutDashboard, FileText, FilePlus2, Users, Images, UserCog, Settings2, CircleUserRound, MoreHorizontal } from "lucide-react";

const ICONS_BY_HREF: Record<string, LucideIcon> = {
  "/": LayoutDashboard,
  "/proposals": FileText,
  "/proposals/new": FilePlus2,
  "/clients": Users,
  "/portfolio": Images,
  "/members": UserCog,
  "/settings/proposals": Settings2,
  "/profile": CircleUserRound,
};

export const MoreIcon = MoreHorizontal;

export function iconForHref(href: string): LucideIcon {
  return ICONS_BY_HREF[href] ?? LayoutDashboard;
}
