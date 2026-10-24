"use client";

import { Check, CloudOff, FileX2, Monitor, Radar, Smartphone } from "lucide-react";
import { Checkbox, RadioGroup, ToggleGroup } from "radix-ui";
import { useActionState, useState } from "react";
import {
  BLOCK_SCOPE_LABELS,
  BLOCK_SCOPES,
  BLOCKABLE_RESOURCE_TYPES,
  RESOURCE_TYPE_LABELS,
  SCENARIO_DESCRIPTIONS,
  SCENARIO_LABELS,
  type PageScenarioKind,
} from "@faultline/shared";
import { launchScanAction, type ScanFormState } from "@/app/actions/scans";
import { Field, selectClasses, TextInput } from "@/design/components/field";
import { cn } from "@/lib/cn";
import { Card, CardDescription, CardTitle, FilledButton, LinkButton } from "@/design/components";

// Single-page scenarios. Blast Radius analyses have their own launch form.
const SCENARIO_ICONS = {
  "resource-block": FileX2,
  "offline-reload": CloudOff,
} as const;
const PAGE_SCENARIOS = Object.keys(SCENARIO_ICONS) as PageScenarioKind[];

export function ScanForm({ projectId, origin }: { projectId: string; origin: string }) {
  const [state, action, pending] = useActionState<ScanFormState, FormData>(launchScanAction, {});
  const [kind, setKind] = useState<PageScenarioKind>("resource-block");
  const [types, setTypes] = useState<string[]>(["stylesheet"]);
  const [viewport, setViewport] = useState("desktop");

  return (
    <form action={action} className="flex max-w-3xl flex-col gap-4" noValidate>
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="viewport" value={viewport} />

      <Card tier="low" aria-labelledby="target-title" className="flex flex-col gap-4">
        <CardTitle id="target-title">Target</CardTitle>
        <Field label="Page URL" hint={`Must be on ${origin}.`} error={state.fieldErrors?.targetUrl}>
          {({ id, describedBy, invalid }) => (
            <TextInput
              id={id}
              name="targetUrl"
              type="url"
              inputMode="url"
              autoCapitalize="none"
              spellCheck={false}
              defaultValue={`${origin}/`}
              required
              aria-describedby={describedBy}
              aria-invalid={invalid}
            />
          )}
        </Field>
      </Card>

      <Card tier="low" className="flex flex-col gap-4">
        <fieldset className="flex flex-col gap-3">
          <legend className="md-title-large mb-3 text-on-surface">Conditions</legend>
          <RadioGroup.Root name="scenarioKind" value={kind} onValueChange={(v) => setKind(v as PageScenarioKind)} className="grid gap-3 sm:grid-cols-2">
            {PAGE_SCENARIOS.map((value) => {
              const Icon = SCENARIO_ICONS[value];
              return (
                <RadioGroup.Item
                  key={value}
                  value={value}
                  className={cn(
                    "flex flex-col items-start gap-2 rounded-lg bg-surface-container p-4 text-left transition-[background-color,border-radius] duration-300 ease-emphasized",
                    "hover:bg-surface-high data-[state=checked]:rounded-xl data-[state=checked]:bg-secondary-container data-[state=checked]:text-on-secondary-container",
                  )}
                >
                  <span className="flex w-full items-center gap-2">
                    <Icon aria-hidden className="size-5 text-fault" />
                    <span className="md-title-medium">{SCENARIO_LABELS[value]}</span>
                    <RadioGroup.Indicator className="ml-auto grid size-6 place-items-center rounded-full bg-fault text-on-fault">
                      <Check aria-hidden className="size-4" />
                    </RadioGroup.Indicator>
                  </span>
                  <span className="md-body-medium opacity-80">{SCENARIO_DESCRIPTIONS[value]}</span>
                </RadioGroup.Item>
              );
            })}
          </RadioGroup.Root>
        </fieldset>

        {kind === "resource-block" ? (
          <div className="flex flex-col gap-6">
            <fieldset>
              <legend className="md-title-medium mb-1 text-on-surface">Resources to abort</legend>
              <p className="mb-4 md-body-medium text-on-surface-variant">
                Matching requests fail inside the browser. Servers are never contacted for them, and no response is faked.
              </p>
              <div className="flex flex-wrap gap-2">
                {BLOCKABLE_RESOURCE_TYPES.map((type) => {
                  const checked = types.includes(type);
                  return (
                    <label
                      key={type}
                      className={cn(
                        "md-label-medium flex h-10 cursor-pointer items-center gap-2 rounded-sm px-3 transition-colors",
                        checked ? "bg-secondary-container text-on-secondary-container" : "bg-surface-high text-on-surface-variant hover:brightness-110",
                      )}
                    >
                      <Checkbox.Root
                        name="resourceTypes"
                        value={type}
                        checked={checked}
                        onCheckedChange={(next) => setTypes((prev) => (next ? [...prev, type] : prev.filter((t) => t !== type)))}
                        className="grid size-4 shrink-0 place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-primary data-[state=unchecked]:ring-1 data-[state=unchecked]:ring-outline"
                      >
                        <Checkbox.Indicator>
                          <Check aria-hidden className="size-4" strokeWidth={3} />
                        </Checkbox.Indicator>
                      </Checkbox.Root>
                      <span>{RESOURCE_TYPE_LABELS[type]}</span>
                    </label>
                  );
                })}
              </div>
              {state.fieldErrors?.["scenario.resourceTypes"] ? (
                <p role="alert" className="mt-2 md-body-medium text-error">
                  {state.fieldErrors["scenario.resourceTypes"]}
                </p>
              ) : null}
            </fieldset>
            <label className="flex max-w-xs flex-col gap-1.5">
              <span className="md-label-medium text-on-surface-variant">Apply to</span>
              <select name="scope" defaultValue="all" className={cn(selectClasses, "h-12")}>
                {BLOCK_SCOPES.map((scope) => (
                  <option key={scope} value={scope}>
                    {BLOCK_SCOPE_LABELS[scope]}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : (
          <p className="rounded-lg bg-surface-container p-4 md-body-medium text-on-surface-variant">
            Offline is emulated by the browser context. It does not reproduce physical network loss. Service workers are allowed in this scenario so the
            site&apos;s own offline support, if any, can be observed.
          </p>
        )}
      </Card>

      <Card tier="low" className="flex flex-col gap-3">
        <CardTitle id="viewport-label">Options</CardTitle>
        <CardDescription>Viewport</CardDescription>
        <ToggleGroup.Root
          type="single"
          value={viewport}
          onValueChange={(v) => v && setViewport(v)}
          aria-labelledby="viewport-label"
          className="grid grid-cols-2 gap-2"
        >
          {[
            { value: "desktop", label: "Desktop", icon: Monitor },
            { value: "mobile", label: "Mobile emulation", icon: Smartphone },
          ].map(({ value, label, icon: Icon }) => (
            <ToggleGroup.Item
              key={value}
              value={value}
              className="md-title-medium flex min-h-16 items-center justify-center gap-2 rounded-lg bg-surface-container px-4 text-on-surface-variant transition-[border-radius,background-color] duration-200 data-[state=on]:rounded-xl data-[state=on]:bg-secondary-container data-[state=on]:text-on-secondary-container [&_svg]:size-5"
            >
              <Icon aria-hidden className="size-4" />
              {label}
            </ToggleGroup.Item>
          ))}
        </ToggleGroup.Root>
        <p className="md-body-medium text-on-surface-variant">Mobile uses Chromium with a 430×932 touch viewport. It is not Safari.</p>
      </Card>

      {state.error ? (
        <p role="alert" className="rounded-md bg-error-container px-4 py-3 md-body-medium text-on-error-container">
          {state.error}
        </p>
      ) : null}
      <div className="flex gap-3">
        <LinkButton variant="tonal" href={`/projects/${projectId}`} className="min-w-28">
          Cancel
        </LinkButton>
        <FilledButton
          type="submit"
          fullWidth
          className="flex-1"
          disabled={pending || (kind === "resource-block" && types.length === 0)}
          icon={<Radar aria-hidden />}
        >
          {pending ? "Queuing…" : "Run scan"}
        </FilledButton>
      </div>
    </form>
  );
}
