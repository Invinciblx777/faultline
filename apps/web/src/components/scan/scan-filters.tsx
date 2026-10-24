import { Search } from "lucide-react";
import { SCAN_STATUS_LABELS, SCAN_STATUSES, SCENARIO_KINDS, SCENARIO_LABELS } from "@faultline/shared";
import { inputClasses, selectClasses } from "@/design/components/field";
import { cn } from "@/lib/cn";
import type { ScanListFilters } from "@/lib/data/queries";
import { LinkButton, TonalButton } from "@/design/components";

/** Plain GET form so filters are shareable URLs and work without JavaScript. */
export function ScanFilters({ filters, action }: { filters: ScanListFilters; action: string }) {
  const active = Boolean(filters.q || filters.status || filters.scenario);
  return (
    <form method="get" action={action} role="search" className="mb-5 grid gap-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end">
      <label className="flex flex-col gap-1.5">
        <span className="type-label">Search URL</span>
        <span className="relative">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-on-surface-variant" />
          <input name="q" type="search" defaultValue={filters.q} placeholder="/checkout" className={cn(inputClasses, "h-12 pl-11")} />
        </span>
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="type-label">Status</span>
        <select name="status" defaultValue={filters.status ?? ""} className={cn(selectClasses, "h-12")}>
          <option value="">Any status</option>
          {SCAN_STATUSES.map((s) => (
            <option key={s} value={s}>
              {SCAN_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="type-label">Scenario</span>
        <select name="scenario" defaultValue={filters.scenario ?? ""} className={cn(selectClasses, "h-12")}>
          <option value="">Any scenario</option>
          {SCENARIO_KINDS.map((s) => (
            <option key={s} value={s}>
              {SCENARIO_LABELS[s]}
            </option>
          ))}
        </select>
      </label>
      <div className="flex gap-2">
        <TonalButton type="submit" className="h-12">
          Filter
        </TonalButton>
        {active ? (
          <LinkButton href={action} variant="text" className="h-12">
            Clear
          </LinkButton>
        ) : null}
      </div>
    </form>
  );
}
