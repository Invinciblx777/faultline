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
  type ScenarioKind,
} from "@faultline/shared";
import { launchScanAction, type ScanFormState } from "@/app/actions/scans";
import { Button } from "@/components/ui/button";
import { Field, inputClasses, TextInput } from "@/components/ui/field";
import { cn } from "@/lib/cn";

const SCENARIO_ICONS = { "resource-block": FileX2, "offline-reload": CloudOff } as const;

export function ScanForm({ projectId, origin }: { projectId: string; origin: string }) {
  const [state, action, pending] = useActionState<ScanFormState, FormData>(launchScanAction, {});
  const [kind, setKind] = useState<ScenarioKind>("resource-block");
  const [types, setTypes] = useState<string[]>(["stylesheet"]);
  const [viewport, setViewport] = useState("desktop");

  return (
    <form action={action} className="flex max-w-3xl flex-col gap-8" noValidate>
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="viewport" value={viewport} />

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

      <fieldset className="flex flex-col gap-3">
        <legend className="type-label mb-3">Fault scenario</legend>
        <RadioGroup.Root name="scenarioKind" value={kind} onValueChange={(v) => setKind(v as ScenarioKind)} className="grid gap-3 sm:grid-cols-2">
          {(Object.keys(SCENARIO_LABELS) as ScenarioKind[]).map((value) => {
            const Icon = SCENARIO_ICONS[value];
            return (
              <RadioGroup.Item
                key={value}
                value={value}
                className={cn(
                  "flex flex-col items-start gap-2 rounded-lg border p-4 text-left transition-[background-color,border-color,border-radius] duration-300 ease-emphasized",
                  "border-outline-variant hover:bg-surface-low data-[state=checked]:rounded-xl data-[state=checked]:border-fault data-[state=checked]:bg-fault-container/40",
                )}
              >
                <span className="flex w-full items-center gap-2">
                  <Icon aria-hidden className="size-5 text-fault" />
                  <span className="type-title">{SCENARIO_LABELS[value]}</span>
                  <RadioGroup.Indicator className="ml-auto grid size-6 place-items-center rounded-full bg-fault text-on-fault">
                    <Check aria-hidden className="size-4" />
                  </RadioGroup.Indicator>
                </span>
                <span className="text-sm text-on-surface-variant">{SCENARIO_DESCRIPTIONS[value]}</span>
              </RadioGroup.Item>
            );
          })}
        </RadioGroup.Root>
      </fieldset>

      {kind === "resource-block" ? (
        <div className="flex flex-col gap-6 rounded-xl bg-surface-low p-5 sm:p-6">
          <fieldset>
            <legend className="type-label mb-1">Resources to abort</legend>
            <p className="mb-4 text-sm text-on-surface-variant">Matching requests fail inside the browser. Servers are never contacted for them, and no response is faked.</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {BLOCKABLE_RESOURCE_TYPES.map((type) => {
                const checked = types.includes(type);
                return (
                  <label
                    key={type}
                    className={cn(
                      "flex min-h-12 cursor-pointer items-center gap-3 rounded-md border px-3 transition-colors",
                      checked ? "border-fault bg-fault-container/30" : "border-outline-variant hover:bg-surface-container",
                    )}
                  >
                    <Checkbox.Root
                      name="resourceTypes"
                      value={type}
                      checked={checked}
                      onCheckedChange={(next) => setTypes((prev) => (next ? [...prev, type] : prev.filter((t) => t !== type)))}
                      className="grid size-5 shrink-0 place-items-center rounded-xs border-2 border-outline data-[state=checked]:border-fault data-[state=checked]:bg-fault"
                    >
                      <Checkbox.Indicator>
                        <Check aria-hidden className="size-3.5 text-on-fault" strokeWidth={3} />
                      </Checkbox.Indicator>
                    </Checkbox.Root>
                    <span className="text-sm">{RESOURCE_TYPE_LABELS[type]}</span>
                  </label>
                );
              })}
            </div>
            {state.fieldErrors?.["scenario.resourceTypes"] ? (
              <p role="alert" className="mt-2 text-sm text-failure">
                {state.fieldErrors["scenario.resourceTypes"]}
              </p>
            ) : null}
          </fieldset>
          <label className="flex max-w-xs flex-col gap-1.5">
            <span className="type-label">Apply to</span>
            <select name="scope" defaultValue="all" className={cn(inputClasses, "h-12 bg-surface")}>
              {BLOCK_SCOPES.map((scope) => (
                <option key={scope} value={scope}>
                  {BLOCK_SCOPE_LABELS[scope]}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : (
        <p className="rounded-xl bg-surface-low p-5 text-sm text-on-surface-variant sm:p-6">
          Offline is emulated by the browser context. It does not reproduce physical network loss. Service workers are allowed in this scenario so the
          site&apos;s own offline support, if any, can be observed.
        </p>
      )}

      <div className="flex flex-col gap-3">
        <span className="type-label" id="viewport-label">
          Viewport
        </span>
        <ToggleGroup.Root
          type="single"
          value={viewport}
          onValueChange={(v) => v && setViewport(v)}
          aria-labelledby="viewport-label"
          className="inline-flex w-fit rounded-full border border-outline p-1"
        >
          {[
            { value: "desktop", label: "Desktop", icon: Monitor },
            { value: "mobile", label: "Mobile emulation", icon: Smartphone },
          ].map(({ value, label, icon: Icon }) => (
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
        <p className="text-sm text-on-surface-variant">Mobile uses Chromium with a 430×932 touch viewport. It is not Safari.</p>
      </div>

      {state.error ? (
        <p role="alert" className="rounded-md bg-failure-container px-4 py-3 text-sm text-on-failure-container">
          {state.error}
        </p>
      ) : null}
      <div>
        <Button type="submit" size="lg" disabled={pending || (kind === "resource-block" && types.length === 0)} icon={<Radar aria-hidden />}>
          {pending ? "Queuing…" : "Run scan"}
        </Button>
      </div>
    </form>
  );
}
