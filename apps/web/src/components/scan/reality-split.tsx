"use client";

import { ChevronsLeftRight, Columns2, Diff, ImageOff, Layers, SplitSquareHorizontal } from "lucide-react";
import { motion, useMotionValue, useSpring, useTransform } from "motion/react";
import { ToggleGroup } from "radix-ui";
import { useCallback, useRef, useState, type KeyboardEvent, type PointerEvent, type UIEvent } from "react";
import { cn } from "@/lib/cn";

export interface SplitShot {
  /** Stable key for the pane. */
  role: string;
  /** Normal conditions or fault conditions; drives color and labels. */
  tone: "normal" | "fault";
  label: string;
  outcomeLabel: string | null;
  artifactId: string | null;
  width: number | null;
  height: number | null;
  sha256: string | null;
  missingReason: string;
}

const ROLE = {
  normal: { text: "text-normal", bg: "bg-normal", ring: "ring-normal" },
  fault: { text: "text-fault", bg: "bg-fault", ring: "ring-fault" },
} as const;

/** A stored pixel-difference image between the two screenshots. */
export interface SplitDiff {
  artifactId: string;
  width: number | null;
  height: number | null;
  note: string;
}

function Missing({ shot }: { shot: SplitShot }) {
  return (
    <div className="grid min-h-64 place-items-center rounded-lg border border-dashed border-outline px-6 py-10 text-center">
      <div className="flex max-w-xs flex-col items-center gap-2 text-on-surface-variant">
        <ImageOff aria-hidden className="size-8" />
        <p className="text-sm">{shot.missingReason}</p>
      </div>
    </div>
  );
}

function Shot({ shot, className }: { shot: SplitShot; className?: string }) {
  if (!shot.artifactId) return <Missing shot={shot} />;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- authenticated, immutable artifact stream; next/image would proxy it
    <img
      src={`/api/artifacts/${shot.artifactId}`}
      width={shot.width ?? undefined}
      height={shot.height ?? undefined}
      alt={`Screenshot: ${shot.label}`}
      className={cn("block h-auto w-full select-none", className)}
      draggable={false}
    />
  );
}

/** Side-by-side panes with optional synchronized scrolling. */
function SideBySide({ shots }: { shots: [SplitShot, SplitShot] }) {
  const [sync, setSync] = useState(true);
  const panes = useRef<Array<HTMLDivElement | null>>([]);
  const lock = useRef(false);
  const onScroll = (index: number) => (event: UIEvent<HTMLDivElement>) => {
    if (!sync || lock.current) return;
    const source = event.currentTarget;
    const other = panes.current[1 - index];
    if (!other) return;
    const ratio = source.scrollTop / Math.max(1, source.scrollHeight - source.clientHeight);
    lock.current = true;
    other.scrollTop = ratio * (other.scrollHeight - other.clientHeight);
    requestAnimationFrame(() => (lock.current = false));
  };
  return (
    <div>
      <label className="mb-3 inline-flex cursor-pointer items-center gap-2 text-sm text-on-surface-variant">
        <input type="checkbox" checked={sync} onChange={(e) => setSync(e.target.checked)} className="size-4 accent-[var(--primary)]" />
        Scroll both panes together
      </label>
      <div className="grid gap-4 md:grid-cols-2">
        {shots.map((shot, i) => (
          <figure key={shot.role} className="min-w-0">
            <figcaption className="mb-2 flex items-center gap-2">
              <span className={cn("size-2.5 rounded-full", ROLE[shot.tone].bg)} aria-hidden />
              <span className={cn("type-title", ROLE[shot.tone].text)}>{shot.label}</span>
              {shot.outcomeLabel ? <span className="text-sm text-on-surface-variant">· {shot.outcomeLabel}</span> : null}
            </figcaption>
            <div
              ref={(el) => {
                panes.current[i] = el;
              }}
              onScroll={onScroll(i)}
              tabIndex={0}
              aria-label={`${shot.label} screenshot, scrollable`}
              className={cn("max-h-[72vh] overflow-y-auto overscroll-contain rounded-lg bg-surface-container ring-2", ROLE[shot.tone].ring)}
            >
              <Shot shot={shot} />
            </div>
          </figure>
        ))}
      </div>
    </div>
  );
}

/** The fault seam: both screenshots stacked, a draggable divider reveals one or the other. */
function Seam({ shots }: { shots: [SplitShot, SplitShot] }) {
  const [baseline, fault] = shots;
  const frame = useRef<HTMLDivElement>(null);
  const target = useMotionValue(50);
  const position = useSpring(target, { stiffness: 600, damping: 45, mass: 0.6 });
  const clip = useTransform(position, (p) => `inset(0 0 0 ${p}%)`);
  const left = useTransform(position, (p) => `${p}%`);
  const [value, setValue] = useState(50);
  const dragging = useRef(false);

  const set = useCallback(
    (next: number, immediate = false) => {
      const clamped = Math.min(100, Math.max(0, next));
      setValue(Math.round(clamped));
      if (immediate) position.jump(clamped);
      target.set(clamped);
    },
    [position, target],
  );

  const fromPointer = (event: PointerEvent) => {
    const rect = frame.current?.getBoundingClientRect();
    if (!rect) return;
    set(((event.clientX - rect.left) / rect.width) * 100, true);
  };

  const onKey = (event: KeyboardEvent) => {
    const step = event.shiftKey ? 10 : 2;
    const map: Record<string, number> = { ArrowLeft: value - step, ArrowRight: value + step, Home: 0, End: 100, PageUp: value + 10, PageDown: value - 10 };
    const next = map[event.key];
    if (next === undefined) return;
    event.preventDefault();
    set(next);
  };

  if (!baseline.artifactId || !fault.artifactId) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        {shots.map((s) => (
          <Missing key={s.role} shot={{ ...s, missingReason: s.artifactId ? "Both screenshots are needed for the seam view. Use side by side." : s.missingReason }} />
        ))}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between text-sm">
        <span className="inline-flex items-center gap-2">
          <span className="size-2.5 rounded-full bg-normal" aria-hidden />
          <span className="type-title text-normal">{baseline.label}</span>
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="type-title text-fault">{fault.label}</span>
          <span className="size-2.5 rounded-full bg-fault" aria-hidden />
        </span>
      </div>
      <div
        ref={frame}
        className="relative grid touch-pan-y items-start overflow-hidden rounded-lg bg-surface-container"
        onPointerDown={(e) => {
          dragging.current = true;
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          fromPointer(e);
        }}
        onPointerMove={(e) => dragging.current && fromPointer(e)}
        onPointerUp={() => (dragging.current = false)}
        onPointerCancel={() => (dragging.current = false)}
      >
        {/* Both layers share one grid cell, so the frame is as tall as the taller screenshot. */}
        <div className="[grid-area:1/1]">
          <Shot shot={baseline} />
        </div>
        <motion.div className="h-full bg-surface-container [grid-area:1/1]" style={{ clipPath: clip }}>
          <Shot shot={fault} />
        </motion.div>
        <motion.div className="pointer-events-none absolute inset-y-0 -translate-x-1/2" style={{ left }} aria-hidden>
          <div className="mx-auto h-full w-[3px] bg-gradient-to-b from-normal via-on-surface to-fault" />
        </motion.div>
        <motion.div
          role="slider"
          tabIndex={0}
          aria-label="Reveal normal or fault screenshot"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={value}
          aria-valuetext={`${value}% normal conditions, ${100 - value}% fault conditions`}
          onKeyDown={onKey}
          style={{ left }}
          className="absolute top-6 grid size-11 -translate-x-1/2 cursor-ew-resize place-items-center rounded-full bg-on-surface text-surface shadow-lg"
        >
          <ChevronsLeftRight aria-hidden className="size-5" />
        </motion.div>
      </div>
      <p className="mt-2 text-sm text-on-surface-variant">
        Drag the seam, or focus the handle and use the arrow keys. Screenshots are aligned at the top-left; page heights may differ.
      </p>
    </div>
  );
}

/** Both screenshots stacked at the top-left; the fault layer's opacity is adjustable. */
function Overlay({ shots }: { shots: [SplitShot, SplitShot] }) {
  const [baseline, fault] = shots;
  const [opacity, setOpacity] = useState(50);
  if (!baseline.artifactId || !fault.artifactId) {
    return <Missing shot={{ ...(baseline.artifactId ? fault : baseline), missingReason: "Both screenshots are needed for the overlay view." }} />;
  }
  return (
    <div>
      <label className="mb-3 flex flex-wrap items-center gap-3 text-sm">
        <span className="type-title text-normal">{baseline.label}</span>
        <input
          type="range"
          min={0}
          max={100}
          value={opacity}
          onChange={(e) => setOpacity(Number(e.target.value))}
          aria-valuetext={`${opacity}% ${fault.label} over ${baseline.label}`}
          className="h-11 min-w-40 flex-1 accent-[var(--fault)]"
        />
        <span className="type-title text-fault">{fault.label}</span>
        <span className="tabular w-12 text-right text-on-surface-variant">{opacity}%</span>
      </label>
      <div className="grid items-start overflow-hidden rounded-lg bg-surface-container">
        <div className="[grid-area:1/1]">
          <Shot shot={baseline} />
        </div>
        <div className="[grid-area:1/1]" style={{ opacity: opacity / 100 }}>
          <Shot shot={fault} />
        </div>
      </div>
      <p className="mt-2 text-sm text-on-surface-variant">Shifted or missing content shows as ghosting where the two layers disagree.</p>
    </div>
  );
}

function DiffView({ diff }: { diff: SplitDiff }) {
  return (
    <figure>
      <div className="max-h-[72vh] overflow-y-auto overscroll-contain rounded-lg bg-surface-container">
        {/* eslint-disable-next-line @next/next/no-img-element -- authenticated artifact stream */}
        <img
          src={`/api/artifacts/${diff.artifactId}`}
          width={diff.width ?? undefined}
          height={diff.height ?? undefined}
          alt="Pixel difference: changed pixels are highlighted, unchanged pixels are faded"
          className="block h-auto w-full"
        />
      </div>
      <figcaption className="mt-2 text-sm text-on-surface-variant">{diff.note}</figcaption>
    </figure>
  );
}

export function RealitySplit({ shots, diff = null }: { shots: [SplitShot, SplitShot]; diff?: SplitDiff | null }) {
  const [mode, setMode] = useState("side");
  const modes = [
    { value: "side", label: "Side by side", icon: Columns2 },
    { value: "seam", label: "Seam", icon: SplitSquareHorizontal },
    { value: "overlay", label: "Overlay", icon: Layers },
    ...(diff ? [{ value: "diff", label: "Pixel diff", icon: Diff }] : []),
  ];
  return (
    <div>
      <ToggleGroup.Root
        type="single"
        value={mode}
        onValueChange={(v) => v && setMode(v)}
        aria-label="Comparison view"
        className="mb-5 inline-flex max-w-full flex-wrap rounded-3xl border border-outline p-1"
      >
        {modes.map(({ value, label, icon: Icon }) => (
          <ToggleGroup.Item
            key={value}
            value={value}
            className="type-label inline-flex h-10 items-center gap-2 rounded-full px-4 text-on-surface-variant data-[state=on]:bg-primary-container data-[state=on]:text-on-primary-container"
          >
            <Icon aria-hidden className="size-4" />
            {label}
          </ToggleGroup.Item>
        ))}
      </ToggleGroup.Root>
      {mode === "side" ? <SideBySide shots={shots} /> : null}
      {mode === "seam" ? <Seam shots={shots} /> : null}
      {mode === "overlay" ? <Overlay shots={shots} /> : null}
      {mode === "diff" && diff ? <DiffView diff={diff} /> : null}
    </div>
  );
}
