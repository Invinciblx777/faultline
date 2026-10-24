import { cn } from "@/lib/cn";

// Precomputed paths on a 100×100 box. Scallop: 12-lobed cookie; blob: soft four-lobe organic form.
function scallopPath() {
  const lobes = 12;
  const points: string[] = [];
  for (let i = 0; i <= 360; i += 3) {
    const a = (i * Math.PI) / 180;
    const r = 44 + 4 * Math.cos(lobes * a);
    points.push(`${(50 + r * Math.cos(a)).toFixed(2)},${(50 + r * Math.sin(a)).toFixed(2)}`);
  }
  return `M${points.join("L")}Z`;
}

const PATHS = {
  scallop: scallopPath(),
  blob: "M50 4C68 4 79 13 88 26C97 39 98 55 92 70C86 85 72 96 54 96C36 96 20 89 11 75C2 61 3 43 10 30C18 15 32 4 50 4Z",
} as const;

/** Decorative M3 Expressive shape placed behind hero content. Color comes from the `className` (fill-*). */
export function ExpressiveShape({ shape, className }: { shape: keyof typeof PATHS; className?: string }) {
  return (
    <svg viewBox="0 0 100 100" aria-hidden focusable="false" className={cn("pointer-events-none", className)}>
      <path d={PATHS[shape]} />
    </svg>
  );
}
