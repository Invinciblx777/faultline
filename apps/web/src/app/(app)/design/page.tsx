import type { Metadata } from "next";
import { Showcase } from "./showcase";

export const metadata: Metadata = { title: "Design system" };

/** Component showcase: every primitive in both schemes, side by side. Static sample copy only, no product data. */
export default function DesignPage() {
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="md-headline-medium">Design system</h1>
        <p className="md-body-medium text-on-surface-variant">Material 3 Expressive primitives, generated palette. Tokens: src/design/tokens.css.</p>
      </header>
      <div className="grid gap-6 xl:grid-cols-2">
        <div data-theme="dark" className="rounded-xl bg-surface p-4 text-on-surface sm:p-6">
          <Showcase theme="Dark" />
        </div>
        <div data-theme="light" className="rounded-xl bg-surface p-4 text-on-surface sm:p-6">
          <Showcase theme="Light" />
        </div>
      </div>
    </div>
  );
}
