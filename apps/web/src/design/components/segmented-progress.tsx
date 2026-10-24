import { cn } from "@/lib/cn";

export type SegmentState = "done" | "active" | "pending" | "failed";

const tones: Record<SegmentState, string> = {
  done: "bg-primary",
  active: "bg-secondary running-pulse",
  pending: "bg-surface-highest",
  failed: "bg-error",
};

/** Gapped segment progress (queued → running → completed). Each segment names its phase for assistive tech. */
export function SegmentedProgress({ segments, label, className }: { segments: Array<{ label: string; state: SegmentState }>; label: string; className?: string }) {
  return (
    <ol aria-label={label} className={cn("flex w-full gap-1.5", className)}>
      {segments.map((s) => (
        <li key={s.label} className={cn("h-1.5 flex-1 rounded-full", tones[s.state])} data-state={s.state}>
          <span className="sr-only">
            {s.label}: {s.state}
          </span>
        </li>
      ))}
    </ol>
  );
}
