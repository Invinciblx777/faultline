"use client";

import { useState, type ReactNode } from "react";
import { SegmentedControl } from "@/design/components";

const TABS = [
  { value: "overview", label: "Overview" },
  { value: "timeline", label: "Timeline" },
  { value: "network", label: "Network" },
  { value: "console", label: "Console" },
  { value: "screenshots", label: "Screenshots" },
] as const;

type Tab = (typeof TABS)[number]["value"];

/** Tabbed evidence views for a finished scan. Panels are rendered on the server and only switched here. */
export function ScanTabs({ panels }: { panels: Record<Tab, ReactNode> }) {
  const [tab, setTab] = useState<Tab>("overview");
  return (
    <div className="flex flex-col gap-6">
      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <SegmentedControl label="Scan evidence" value={tab} segments={[...TABS]} onChange={setTab} className="min-w-max sm:min-w-0" />
      </div>
      <div role="tabpanel" aria-label={TABS.find((t) => t.value === tab)?.label}>
        {panels[tab]}
      </div>
    </div>
  );
}
