"use client";

import { ArrowDown, ArrowUp, Braces, ListOrdered, Plus, Save, Trash2 } from "lucide-react";
import { ToggleGroup } from "radix-ui";
import { useActionState, useMemo, useState } from "react";
import { LOCATOR_ROLES, STEP_TYPE_LABELS, type JourneyDefinition, type JourneyStepType } from "@faultline/shared";
import { saveJourneyAction, type JourneyFormState } from "@/app/actions/journeys";
import { Button } from "@/components/ui/button";
import { inputClasses } from "@/components/ui/field";
import { cn } from "@/lib/cn";

/**
 * Structured editor for a declarative journey. The draft is plain data; the
 * server validates it against the journey schema before saving a version.
 */

type LocatorBy = "role" | "text" | "label" | "placeholder" | "testId" | "css";
interface DraftLocator {
  by: LocatorBy;
  value: string;
  role: string;
  exact: boolean;
}
interface DraftStep {
  uid: number;
  type: JourneyStepType;
  path: string;
  target: DraftLocator;
  value: string;
  text: string;
  match: "contains" | "equals";
  label: string;
  timeoutMs: string;
  maxDurationMs: string;
}
interface DraftMutation {
  uid: number;
  method: "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
}

const TARGETED: JourneyStepType[] = ["click", "fill", "waitForVisible", "assertVisible", "assertHidden", "assertEnabled", "assertDisabled", "assertText"];
const TIMED: JourneyStepType[] = ["waitForVisible", "assertVisible", "assertHidden", "assertEnabled", "assertDisabled", "assertText"];
const OFFLINE_TYPES: JourneyStepType[] = ["assertVisible", "assertHidden", "assertText"];
const LOCATOR_LABELS: Record<LocatorBy, string> = {
  role: "Role and accessible name",
  text: "Visible text",
  label: "Form label",
  placeholder: "Placeholder",
  testId: "Test id (data-testid)",
  css: "CSS selector",
};

let nextUid = 1;
const uid = () => nextUid++;

function emptyStep(type: JourneyStepType): DraftStep {
  return {
    uid: uid(),
    type,
    path: "/",
    target: { by: type === "click" ? "role" : type === "fill" ? "label" : "text", value: "", role: "button", exact: false },
    value: "",
    text: "",
    match: "contains",
    label: "",
    timeoutMs: "",
    maxDurationMs: "",
  };
}

type AnyStep = JourneyDefinition["steps"][number];

function toDraft(step: AnyStep): DraftStep {
  const draft = emptyStep(step.type);
  draft.label = step.label ?? "";
  if ("path" in step) draft.path = step.path;
  if ("target" in step) {
    const t = step.target;
    draft.target = {
      by: t.by,
      value: t.by === "role" ? t.name : t.by === "text" ? t.text : t.by === "label" ? t.label : t.by === "placeholder" ? t.placeholder : t.by === "testId" ? t.testId : t.selector,
      role: t.by === "role" ? t.role : "button",
      exact: "exact" in t ? Boolean(t.exact) : false,
    };
  }
  if (step.type === "fill") draft.value = step.value;
  if (step.type === "assertText") {
    draft.text = step.text;
    draft.match = step.match;
  }
  // Imported JSON may omit defaults; only carry explicit, non-default numbers into the form.
  if (step.type !== "navigate" && step.type !== "reload" && typeof step.timeoutMs === "number" && step.timeoutMs !== 5000) draft.timeoutMs = String(step.timeoutMs);
  if ("maxDurationMs" in step && typeof step.maxDurationMs === "number") draft.maxDurationMs = String(step.maxDurationMs);
  return draft;
}

function fromDraft(d: DraftStep): Record<string, unknown> {
  const base: Record<string, unknown> = { type: d.type };
  if (d.label.trim()) base.label = d.label.trim();
  if (d.type === "navigate") return { ...base, path: d.path.trim() };
  if (d.type === "reload") return base;
  const t = d.target;
  const target =
    t.by === "role"
      ? { by: "role", role: t.role, name: t.value, exact: t.exact }
      : t.by === "text"
        ? { by: "text", text: t.value, exact: t.exact }
        : t.by === "label"
          ? { by: "label", label: t.value, exact: t.exact }
          : t.by === "placeholder"
            ? { by: "placeholder", placeholder: t.value, exact: t.exact }
            : t.by === "testId"
              ? { by: "testId", testId: t.value.trim() }
              : { by: "css", selector: t.value };
  const step: Record<string, unknown> = { ...base, target };
  if (d.timeoutMs.trim()) step.timeoutMs = Number(d.timeoutMs);
  if (TIMED.includes(d.type) && d.maxDurationMs.trim()) step.maxDurationMs = Number(d.maxDurationMs);
  if (d.type === "fill") step.value = d.value;
  if (d.type === "assertText") {
    step.text = d.text;
    step.match = d.match;
  }
  return step;
}

function Select({ className, ...rest }: React.ComponentProps<"select">) {
  return <select className={cn(inputClasses, "h-11 bg-surface-low pr-8", className)} {...rest} />;
}
function Input({ className, ...rest }: React.ComponentProps<"input">) {
  return <input className={cn(inputClasses, "h-11", className)} {...rest} />;
}
function Mini({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn("flex min-w-0 flex-col gap-1", className)}>
      <span className="text-xs text-on-surface-variant">{label}</span>
      {children}
    </label>
  );
}

function StepEditor({
  step,
  index,
  count,
  types,
  error,
  onChange,
  onMove,
  onRemove,
}: {
  step: DraftStep;
  index: number;
  count: number;
  types: JourneyStepType[];
  error?: string;
  onChange: (next: DraftStep) => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
}) {
  const set = (patch: Partial<DraftStep>) => onChange({ ...step, ...patch });
  const setTarget = (patch: Partial<DraftLocator>) => onChange({ ...step, target: { ...step.target, ...patch } });
  const targeted = TARGETED.includes(step.type);
  return (
    <li className={cn("rounded-lg border bg-surface-low p-4", error ? "border-failure" : "border-outline-variant")}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="tabular grid size-8 place-items-center rounded-full bg-surface-highest text-sm font-medium" aria-hidden>
          {index + 1}
        </span>
        <Select
          aria-label={`Step ${index + 1} type`}
          value={step.type}
          onChange={(e) => onChange({ ...emptyStep(e.target.value as JourneyStepType), uid: step.uid, target: step.target, label: step.label })}
          className="w-auto min-w-44 flex-1 sm:flex-none"
        >
          {types.map((t) => (
            <option key={t} value={t}>
              {STEP_TYPE_LABELS[t]}
            </option>
          ))}
        </Select>
        <span className="ml-auto flex gap-1">
          <Button type="button" variant="text" size="sm" aria-label={`Move step ${index + 1} up`} disabled={index === 0} onClick={() => onMove(-1)} icon={<ArrowUp aria-hidden />} />
          <Button type="button" variant="text" size="sm" aria-label={`Move step ${index + 1} down`} disabled={index === count - 1} onClick={() => onMove(1)} icon={<ArrowDown aria-hidden />} />
          <Button type="button" variant="text" size="sm" aria-label={`Remove step ${index + 1}`} onClick={onRemove} icon={<Trash2 aria-hidden />} />
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {step.type === "navigate" ? (
          <Mini label="Path on the project origin" className="sm:col-span-2">
            <Input value={step.path} onChange={(e) => set({ path: e.target.value })} placeholder="/checkout" autoCapitalize="none" spellCheck={false} />
          </Mini>
        ) : null}
        {targeted ? (
          <>
            <Mini label="Find element by">
              <Select value={step.target.by} onChange={(e) => setTarget({ by: e.target.value as LocatorBy })}>
                {(Object.keys(LOCATOR_LABELS) as LocatorBy[]).map((by) => (
                  <option key={by} value={by}>
                    {LOCATOR_LABELS[by]}
                  </option>
                ))}
              </Select>
            </Mini>
            {step.target.by === "role" ? (
              <Mini label="Role">
                <Select value={step.target.role} onChange={(e) => setTarget({ role: e.target.value })}>
                  {LOCATOR_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </Select>
              </Mini>
            ) : null}
            <Mini label={step.target.by === "role" ? "Accessible name" : LOCATOR_LABELS[step.target.by]} className={step.target.by === "role" ? "sm:col-span-2" : undefined}>
              <Input value={step.target.value} onChange={(e) => setTarget({ value: e.target.value })} spellCheck={false} />
            </Mini>
            {step.target.by !== "css" && step.target.by !== "testId" ? (
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input type="checkbox" checked={step.target.exact} onChange={(e) => setTarget({ exact: e.target.checked })} className="size-4 accent-[var(--primary)]" />
                Match the whole text exactly
              </label>
            ) : null}
          </>
        ) : null}
        {step.type === "fill" ? (
          <Mini label="Value to type (up to 200 characters; password fields are refused)" className="sm:col-span-2">
            <Input value={step.value} onChange={(e) => set({ value: e.target.value })} maxLength={200} autoComplete="off" />
          </Mini>
        ) : null}
        {step.type === "assertText" ? (
          <>
            <Mini label="Expected text">
              <Input value={step.text} onChange={(e) => set({ text: e.target.value })} />
            </Mini>
            <Mini label="Comparison">
              <Select value={step.match} onChange={(e) => set({ match: e.target.value as "contains" | "equals" })}>
                <option value="contains">Contains</option>
                <option value="equals">Equals</option>
              </Select>
            </Mini>
          </>
        ) : null}
        {targeted ? (
          <Mini label="Timeout (ms, default 5000)">
            <Input inputMode="numeric" value={step.timeoutMs} onChange={(e) => set({ timeoutMs: e.target.value.replace(/\D/g, "") })} placeholder="5000" />
          </Mini>
        ) : null}
        {TIMED.includes(step.type) ? (
          <Mini label="Performance budget (ms, optional)">
            <Input inputMode="numeric" value={step.maxDurationMs} onChange={(e) => set({ maxDurationMs: e.target.value.replace(/\D/g, "") })} placeholder="none" />
          </Mini>
        ) : null}
        <Mini label="Description shown in results (optional)" className="sm:col-span-2">
          <Input value={step.label} onChange={(e) => set({ label: e.target.value })} maxLength={120} />
        </Mini>
      </div>
      {error ? (
        <p className="mt-2 text-sm text-failure" role="alert">
          {error}
        </p>
      ) : null}
    </li>
  );
}

function stepErrors(fieldErrors: Record<string, string> | undefined, prefix: string) {
  const map = new Map<number, string>();
  for (const [key, message] of Object.entries(fieldErrors ?? {})) {
    const match = key.match(new RegExp(`^${prefix}\\.(\\d+)`));
    if (match) map.set(Number(match[1]), `${message}${key.split(".").length > 2 ? ` (${key.split(".").slice(2).join(".")})` : ""}`);
  }
  return map;
}

export function JourneyBuilder({ projectId, journeyId, initial }: { projectId: string; journeyId?: string; initial?: JourneyDefinition }) {
  const [state, action, pending] = useActionState<JourneyFormState, FormData>(saveJourneyAction, {});
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [steps, setSteps] = useState<DraftStep[]>(() => (initial ? initial.steps.map(toDraft) : [emptyStep("navigate")]));
  const [offline, setOffline] = useState<DraftStep[]>(() => (initial?.offlineExpectations ?? []).map(toDraft));
  const [maxJourneyMs, setMaxJourneyMs] = useState(initial?.performance.maxJourneyMs ? String(initial.performance.maxJourneyMs) : "");
  const [masks, setMasks] = useState((initial?.maskSelectors ?? []).join("\n"));
  const [mutations, setMutations] = useState<DraftMutation[]>(() => (initial?.allowedMutations ?? []).map((m) => ({ ...m, uid: uid() })));
  const [mode, setMode] = useState("steps");
  const [json, setJson] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);

  const definition = useMemo(
    () => ({
      name: name.trim(),
      ...(description.trim() ? { description: description.trim() } : {}),
      steps: steps.map(fromDraft),
      performance: maxJourneyMs ? { maxJourneyMs: Number(maxJourneyMs) } : {},
      offlineExpectations: offline.map(fromDraft),
      maskSelectors: masks
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
      allowedMutations: mutations.map(({ method, path }) => ({ method, path: path.trim() })),
    }),
    [name, description, steps, maxJourneyMs, offline, masks, mutations],
  );

  const errors = stepErrors(state.fieldErrors, "steps");
  const offlineErrors = stepErrors(state.fieldErrors, "offlineExpectations");

  const move = (list: DraftStep[], setList: (v: DraftStep[]) => void, index: number, delta: -1 | 1) => {
    const next = [...list];
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item!);
    setList(next);
  };

  const applyJson = () => {
    try {
      const parsed = JSON.parse(json) as JourneyDefinition;
      if (!parsed || !Array.isArray(parsed.steps)) throw new Error("Expected an object with a steps array.");
      setName(parsed.name ?? "");
      setDescription(parsed.description ?? "");
      setSteps(parsed.steps.map(toDraft));
      setOffline((parsed.offlineExpectations ?? []).map(toDraft));
      setMaxJourneyMs(parsed.performance?.maxJourneyMs ? String(parsed.performance.maxJourneyMs) : "");
      setMasks((parsed.maskSelectors ?? []).join("\n"));
      setMutations((parsed.allowedMutations ?? []).map((m) => ({ ...m, uid: uid() })));
      setJsonError(null);
      setMode("steps");
    } catch (error) {
      setJsonError(error instanceof Error ? error.message : "Not valid JSON.");
    }
  };

  return (
    <form action={action} className="flex max-w-4xl flex-col gap-8" noValidate>
      <input type="hidden" name="projectId" value={projectId} />
      {journeyId ? <input type="hidden" name="journeyId" value={journeyId} /> : null}
      <input type="hidden" name="definition" value={JSON.stringify(definition)} />

      {state.error ? (
        <p role="alert" className="rounded-md bg-failure-container px-4 py-3 text-sm text-on-failure-container">
          {state.error}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Mini label="Journey name">
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required aria-invalid={Boolean(state.fieldErrors?.name)} />
        </Mini>
        <Mini label="Whole-journey budget (ms, optional)">
          <Input inputMode="numeric" value={maxJourneyMs} onChange={(e) => setMaxJourneyMs(e.target.value.replace(/\D/g, ""))} placeholder="none" />
        </Mini>
        <Mini label="Description (optional)" className="sm:col-span-2">
          <Input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} />
        </Mini>
      </div>

      <ToggleGroup.Root
        type="single"
        value={mode}
        onValueChange={(v) => {
          if (!v) return;
          if (v === "json") setJson(JSON.stringify(definition, null, 2));
          setMode(v);
        }}
        aria-label="Editor"
        className="inline-flex self-start rounded-full border border-outline p-1"
      >
        {[
          { value: "steps", label: "Steps", icon: ListOrdered },
          { value: "json", label: "JSON", icon: Braces },
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

      {mode === "json" ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-on-surface-variant">
            Journey definition in the <code className="font-mono">faultline.journey/v1</code> format. Apply to load it into the step editor; the server validates it on save.
          </p>
          <textarea value={json} onChange={(e) => setJson(e.target.value)} spellCheck={false} className={cn(inputClasses, "min-h-96 py-3 font-mono text-sm")} aria-label="Journey JSON" />
          {jsonError ? (
            <p role="alert" className="text-sm text-failure">
              {jsonError}
            </p>
          ) : null}
          <Button type="button" variant="tonal" onClick={applyJson} className="self-start">
            Apply JSON
          </Button>
        </div>
      ) : (
        <>
          <section aria-labelledby="steps-title" className="flex flex-col gap-3">
            <div>
              <h2 id="steps-title" className="type-title text-lg">
                Steps
              </h2>
              <p className="text-sm text-on-surface-variant">
                The first step opens a page on the project origin. Assertions are what verdicts are based on: an analysis can only call a condition broken if an assertion that
                passed normally fails under it.
              </p>
            </div>
            <ol className="flex flex-col gap-3">
              {steps.map((step, i) => (
                <StepEditor
                  key={step.uid}
                  step={step}
                  index={i}
                  count={steps.length}
                  types={Object.keys(STEP_TYPE_LABELS) as JourneyStepType[]}
                  error={errors.get(i)}
                  onChange={(next) => setSteps(steps.map((s, j) => (j === i ? next : s)))}
                  onMove={(delta) => move(steps, setSteps, i, delta)}
                  onRemove={() => setSteps(steps.filter((_, j) => j !== i))}
                />
              ))}
            </ol>
            <div className="flex flex-wrap gap-2">
              {(["click", "fill", "assertVisible", "assertText", "navigate"] as JourneyStepType[]).map((type) => (
                <Button key={type} type="button" variant="outlined" size="sm" disabled={steps.length >= 30} onClick={() => setSteps([...steps, emptyStep(type)])} icon={<Plus aria-hidden />}>
                  {STEP_TYPE_LABELS[type]}
                </Button>
              ))}
            </div>
          </section>

          <details className="rounded-lg border border-outline-variant p-4" open={offline.length > 0}>
            <summary className="type-title cursor-pointer">Offline expectations ({offline.length})</summary>
            <p className="mt-2 text-sm text-on-surface-variant">
              Checked only in the online → offline experiment, after the journey runs offline. Without them, offline results are recorded as observations and never as defects.
            </p>
            <ol className="mt-3 flex flex-col gap-3">
              {offline.map((step, i) => (
                <StepEditor
                  key={step.uid}
                  step={step}
                  index={i}
                  count={offline.length}
                  types={OFFLINE_TYPES}
                  error={offlineErrors.get(i)}
                  onChange={(next) => setOffline(offline.map((s, j) => (j === i ? next : s)))}
                  onMove={(delta) => move(offline, setOffline, i, delta)}
                  onRemove={() => setOffline(offline.filter((_, j) => j !== i))}
                />
              ))}
            </ol>
            <Button type="button" variant="outlined" size="sm" className="mt-3" disabled={offline.length >= 5} onClick={() => setOffline([...offline, emptyStep("assertVisible")])} icon={<Plus aria-hidden />}>
              Offline expectation
            </Button>
          </details>

          <details className="rounded-lg border border-outline-variant p-4" open={mutations.length > 0}>
            <summary className="type-title cursor-pointer">Allowed data-changing requests ({mutations.length})</summary>
            <p className="mt-2 text-sm text-on-surface-variant">
              Every POST, PUT, PATCH, and DELETE request is blocked during analyses so a journey cannot change data. List an exact method and path here only if it is safe to call
              repeatedly against this environment.
            </p>
            <ul className="mt-3 flex flex-col gap-2">
              {mutations.map((m, i) => (
                <li key={m.uid} className="flex flex-wrap items-end gap-2">
                  <Mini label="Method">
                    <Select value={m.method} onChange={(e) => setMutations(mutations.map((x, j) => (j === i ? { ...x, method: e.target.value as DraftMutation["method"] } : x)))}>
                      {["POST", "PUT", "PATCH", "DELETE"].map((v) => (
                        <option key={v}>{v}</option>
                      ))}
                    </Select>
                  </Mini>
                  <Mini label="Path" className="flex-1">
                    <Input value={m.path} onChange={(e) => setMutations(mutations.map((x, j) => (j === i ? { ...x, path: e.target.value } : x)))} placeholder="/api/cart" />
                  </Mini>
                  <Button type="button" variant="text" size="sm" aria-label="Remove allowed request" onClick={() => setMutations(mutations.filter((_, j) => j !== i))} icon={<Trash2 aria-hidden />} />
                </li>
              ))}
            </ul>
            <Button type="button" variant="outlined" size="sm" className="mt-3" disabled={mutations.length >= 10} onClick={() => setMutations([...mutations, { uid: uid(), method: "POST", path: "/" }])} icon={<Plus aria-hidden />}>
              Allowed request
            </Button>
          </details>

          <details className="rounded-lg border border-outline-variant p-4" open={masks.trim().length > 0}>
            <summary className="type-title cursor-pointer">Screenshot masks</summary>
            <p className="mt-2 text-sm text-on-surface-variant">CSS selectors for regions that change on every load (clocks, ads). One per line, up to 10. Masked regions are painted over in every screenshot, so they do not count as visual differences.</p>
            <textarea value={masks} onChange={(e) => setMasks(e.target.value)} spellCheck={false} className={cn(inputClasses, "mt-3 min-h-24 py-3 font-mono text-sm")} aria-label="Mask selectors" />
          </details>
        </>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="lg" disabled={pending || mode === "json"} icon={<Save aria-hidden />}>
          {pending ? "Saving…" : journeyId ? "Save as new version" : "Save journey"}
        </Button>
        {mode === "json" ? <span className="text-sm text-on-surface-variant">Apply the JSON before saving.</span> : null}
      </div>
    </form>
  );
}
