"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { cn } from "@/lib/cn";
import { NAV_ITEMS } from "./nav-items";

const spring = { type: "spring", stiffness: 520, damping: 34, mass: 0.8 } as const;

/** Desktop navigation rail (M3): icon in an active indicator pill, label below. */
export function NavigationRail() {
  const pathname = usePathname();
  return (
    <nav aria-label="Primary" className="flex flex-col items-center gap-3">
      {NAV_ITEMS.map((item) => {
        const active = item.match(pathname);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className="group flex w-20 flex-col items-center gap-1 rounded-lg py-1 outline-offset-0"
          >
            <span className="relative grid h-8 w-14 place-items-center">
              {active ? (
                <motion.span layoutId="rail-indicator" transition={spring} className="absolute inset-0 rounded-full bg-primary-container" />
              ) : (
                <span className="absolute inset-0 rounded-full transition-colors group-hover:bg-surface-highest" />
              )}
              <Icon aria-hidden className={cn("relative size-5", active ? "text-on-primary-container" : "text-on-surface-variant")} />
            </span>
            <span className={cn("type-label text-xs", active ? "text-on-surface" : "text-on-surface-variant")}>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

/** Mobile bottom navigation bar, padded for the iOS home indicator. */
export function BottomNavigation() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 grid border-t border-outline-variant bg-surface-container pb-[env(safe-area-inset-bottom)] md:hidden"
      // One shrinkable column per item, so the bar never widens the page on narrow phones.
      style={{ gridTemplateColumns: `repeat(${NAV_ITEMS.length}, minmax(0, 1fr))` }}
    >
      {NAV_ITEMS.map((item) => {
        const active = item.match(pathname);
        const Icon = item.icon;
        return (
          <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} className="flex min-w-0 flex-col items-center gap-1 pt-3 pb-3">
            <span className="relative grid h-8 w-14 place-items-center">
              {active ? <motion.span layoutId="bar-indicator" transition={spring} className="absolute inset-0 rounded-full bg-primary-container" /> : null}
              <Icon aria-hidden className={cn("relative size-6", active ? "text-on-primary-container" : "text-on-surface-variant")} />
            </span>
            <span className={cn("type-label text-xs", active ? "text-on-surface" : "text-on-surface-variant")}>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
