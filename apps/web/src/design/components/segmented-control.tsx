"use client";

import { ToggleGroup } from "radix-ui";
import { cn } from "@/lib/cn";

export interface Segment<T extends string> {
  value: T;
  label: string;
}

/** Single-select segmented button. Rendered as a radio group so each segment is keyboard reachable. */
export function SegmentedControl<T extends string>({ label, value, segments, onChange, className }: { label: string; value: T; segments: Segment<T>[]; onChange: (value: T) => void; className?: string }) {
  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      aria-label={label}
      onValueChange={(v) => v && onChange(v as T)}
      className={cn("inline-flex gap-1 rounded-full bg-surface-high p-1", className)}
    >
      {segments.map((s) => (
        <ToggleGroup.Item
          key={s.value}
          value={s.value}
          className="md-label-medium min-h-10 flex-1 rounded-full px-4 text-on-surface-variant transition-colors data-[state=on]:bg-secondary-container data-[state=on]:text-on-secondary-container"
        >
          {s.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}
