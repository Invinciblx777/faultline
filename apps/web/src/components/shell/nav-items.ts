import { FolderGit2, History, Settings2, Zap, type LucideIcon } from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  match: (pathname: string) => boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/projects", label: "Projects", icon: FolderGit2, match: (p) => p.startsWith("/projects") },
  { href: "/scans", label: "Scans", icon: History, match: (p) => p.startsWith("/scans") },
  { href: "/experiments", label: "Findings", icon: Zap, match: (p) => p.startsWith("/experiments") },
  { href: "/settings", label: "Settings", icon: Settings2, match: (p) => p.startsWith("/settings") },
];
