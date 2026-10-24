"use client";

import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import { cn } from "@/lib/cn";

/**
 * Android 16 thick slider: 40px track, filled/unfilled tones, a 4px handle bar with 6px gaps on each side.
 * Arrow keys step by `step`, PageUp/PageDown by 10×, Home/End jump to the ends.
 */
export function ThickSlider({ label, value, onChange, min = 0, max = 100, step = 1, valueText, className }: { label: string; value: number; onChange: (value: number) => void; min?: number; max?: number; step?: number; valueText?: string; className?: string }) {
  const track = useRef<HTMLDivElement>(null);
  const pct = ((value - min) / (max - min)) * 100;
  const clamp = (v: number) => Math.min(max, Math.max(min, v));

  function fromPointer(e: PointerEvent<HTMLDivElement>) {
    const rect = track.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const raw = min + ((e.clientX - rect.left) / rect.width) * (max - min);
    onChange(clamp(Math.round(raw / step) * step));
  }

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    const map: Record<string, number> = { ArrowRight: step, ArrowUp: step, ArrowLeft: -step, ArrowDown: -step, PageUp: step * 10, PageDown: -step * 10 };
    if (e.key in map) onChange(clamp(value + map[e.key]));
    else if (e.key === "Home") onChange(min);
    else if (e.key === "End") onChange(max);
    else return;
    e.preventDefault();
  }

  return (
    <div
      ref={track}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={valueText}
      onKeyDown={onKey}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        fromPointer(e);
      }}
      onPointerMove={(e) => e.buttons === 1 && fromPointer(e)}
      className={cn("relative h-10 w-full cursor-pointer touch-none select-none rounded-full", className)}
    >
      {/* Filled segment ends 6px before the handle; unfilled starts 6px after it. */}
      <span className="absolute inset-y-0 left-0 rounded-l-full rounded-r-sm bg-primary" style={{ width: `max(0px, calc(${pct}% - 8px))` }} />
      <span className="absolute inset-y-0 right-0 rounded-r-full rounded-l-sm bg-secondary-container" style={{ width: `max(0px, calc(${100 - pct}% - 8px))` }} />
      <span aria-hidden className="absolute -inset-y-1.5 w-1 -translate-x-1/2 rounded-full bg-primary" style={{ left: `${pct}%` }} />
    </div>
  );
}
