/** FAULTLINE mark: two offset plates split by a fault seam (normal plate and fault plate). */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={className}>
      <path d="M4 6a4 4 0 0 1 4-4h9.5l-3 9 3.5 5-4 14H8a4 4 0 0 1-4-4z" fill="var(--normal)" />
      <path d="M20 4h4a4 4 0 0 1 4 4v18a4 4 0 0 1-4 4h-7.5l4-13.5-3.5-5z" fill="var(--fault)" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="inline-flex items-center gap-2.5">
      <LogoMark className="size-8" />
      <span className="type-display text-xl tracking-tight">Faultline</span>
    </span>
  );
}
