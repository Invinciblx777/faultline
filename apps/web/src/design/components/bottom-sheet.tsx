"use client";

import { X } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Modal sheet: slides up from the bottom on phones (drag handle, 28px top corners) and docks to the
 * right on wide screens. Escape and the scrim close it. Landmark role is configurable for callers
 * that expose the sheet as a named region.
 */
export function BottomSheet({ open, onClose, label, children, className, role = "dialog" }: { open: boolean; onClose: () => void; label: string; children: ReactNode; className?: string; role?: "dialog" | "complementary" }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <>
      <div aria-hidden className="fixed inset-0 z-40 bg-scrim" onClick={onClose} />
      <aside
        role={role}
        aria-label={label}
        aria-modal={role === "dialog" ? true : undefined}
        className={cn(
          "md-enter fixed inset-x-0 bottom-0 z-50 flex max-h-[88dvh] flex-col overflow-y-auto rounded-t-xl bg-surface-low px-5 pt-3 pb-[calc(1.5rem+env(safe-area-inset-bottom))]",
          "lg:inset-y-3 lg:right-3 lg:left-auto lg:max-h-none lg:w-[480px] lg:rounded-xl lg:pt-5",
          className,
        )}
      >
        <span aria-hidden className="mx-auto mb-3 h-1 w-8 shrink-0 rounded-full bg-outline lg:hidden" />
        <button type="button" onClick={onClose} aria-label="Close" className="absolute top-3 right-3 grid size-12 place-items-center rounded-full text-on-surface-variant hover:bg-surface-high">
          <X aria-hidden className="size-5" />
        </button>
        {children}
      </aside>
    </>
  );
}
