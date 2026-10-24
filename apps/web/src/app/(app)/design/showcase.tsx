"use client";

import { Bell, Pencil, PhoneOff, ShieldCheck, Wrench } from "lucide-react";
import { useState } from "react";
import {
  BottomSheet,
  Card,
  Chip,
  DialogPanel,
  DisplayNumeral,
  ExpressiveShape,
  FilledButton,
  IconButton,
  ListGroup,
  ListItem,
  NotificationCard,
  OutlinedButton,
  SegmentedControl,
  SegmentedProgress,
  TextButton,
  ThickSlider,
  TonalButton,
} from "@/design/components";

export function Showcase({ theme }: { theme: string }) {
  const [segment, setSegment] = useState<"baseline" | "fault">("baseline");
  const [value, setValue] = useState(60);
  const [sheet, setSheet] = useState(false);
  return (
    <div className="flex flex-col gap-5">
      <h2 className="md-title-large">{theme}</h2>

      <Card tier="container" className="relative flex items-center gap-6 overflow-hidden">
        <span className="relative grid size-32 shrink-0 place-items-center">
          <ExpressiveShape shape="scallop" className="absolute inset-0 fill-error-container" />
          <DisplayNumeral value="3" tone="relative text-on-error-container" />
        </span>
        <p className="md-title-medium">Display numeral on a scallop shape</p>
      </Card>

      <div className="flex flex-wrap gap-2">
        {(["broken", "degraded", "resilient", "inconclusive", "failed", "neutral"] as const).map((s) => (
          <Chip key={s} status={s}>
            {s}
          </Chip>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <FilledButton>Filled</FilledButton>
        <TonalButton>Tonal</TonalButton>
        <OutlinedButton>Outlined</OutlinedButton>
        <TextButton>Text</TextButton>
        <IconButton label="Edit">
          <Pencil aria-hidden />
        </IconButton>
        <IconButton label="Notify" variant="filled">
          <Bell aria-hidden />
        </IconButton>
        <IconButton label="Stop" variant="destructive">
          <PhoneOff aria-hidden />
        </IconButton>
      </div>

      <SegmentedControl label={`${theme} run`} value={segment} onChange={setSegment} segments={[{ value: "baseline", label: "Baseline" }, { value: "fault", label: "Fault" }]} />
      <ThickSlider label={`${theme} sample slider`} value={value} onChange={setValue} valueText={`${value}%`} />
      <SegmentedProgress label="Sample phases" segments={[{ label: "Queued", state: "done" }, { label: "Running", state: "active" }, { label: "Completed", state: "pending" }]} />

      <ListGroup>
        <ListItem headline="List row" supporting="Gap separated, no dividers" trailing={<Chip status="resilient">On</Chip>} />
        <ListItem headline="Second row" supporting="Inner corners are small" />
        <ListItem headline="Last row" supporting="Outer corners are large" />
      </ListGroup>

      <ListGroup>
        <li>
          <NotificationCard icon={<Wrench aria-hidden />} source="Sample source" time="now" title="Notification card" body="Icon, source, time, title, body, chevron." href="/design" />
        </li>
      </ListGroup>

      <DialogPanel
        titleId={`dialog-${theme}`}
        icon={<ShieldCheck aria-hidden />}
        title="Dialog title?"
        body="Supporting text explains the decision."
        keepInMind={["First consideration", "Second consideration"]}
        actions={
          <>
            <FilledButton fullWidth>Confirm</FilledButton>
            <OutlinedButton fullWidth>Cancel</OutlinedButton>
          </>
        }
      />

      <div>
        <TonalButton onClick={() => setSheet(true)}>Open bottom sheet</TonalButton>
      </div>
      <BottomSheet open={sheet} onClose={() => setSheet(false)} label={`${theme} sample sheet`}>
        <h3 className="md-title-large pr-12">Bottom sheet</h3>
        <p className="md-body-medium mt-2 text-on-surface-variant">Escape or the scrim closes it.</p>
      </BottomSheet>
    </div>
  );
}
