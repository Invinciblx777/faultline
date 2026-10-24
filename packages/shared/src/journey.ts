import { z } from "zod";

/**
 * Versioned, declarative user journeys.
 *
 * A journey is data, never code: every step is one of a small set of
 * Playwright operations with a structured locator. Nothing in a journey is
 * evaluated as JavaScript, and nothing from the scanned website is executed
 * by FAULTLINE. Journeys must be non-destructive; requests that could mutate
 * data are blocked during executions unless the journey explicitly allows a
 * specific method and path (see `allowedMutations`).
 */

export const JOURNEY_SCHEMA = "faultline.journey/v1";

export const LOCATOR_ROLES = [
  "alert",
  "article",
  "button",
  "cell",
  "checkbox",
  "combobox",
  "dialog",
  "heading",
  "img",
  "link",
  "list",
  "listitem",
  "main",
  "navigation",
  "option",
  "radio",
  "region",
  "row",
  "searchbox",
  "spinbutton",
  "status",
  "switch",
  "tab",
  "textbox",
] as const;
export type LocatorRole = (typeof LOCATOR_ROLES)[number];

const text = (max: number) => z.string().trim().min(1, "Required").max(max);

/** CSS only. Engine prefixes (`xpath=`, `text=`, …) and `>>` chaining are refused so the selector is always plain CSS. */
const cssSelector = text(300).refine((value) => !/^\s*[a-z_-]+\s*=/i.test(value) && !value.includes(">>"), {
  message: "Use a plain CSS selector (no engine prefix or >> chaining).",
});

export const locatorSchema = z.discriminatedUnion("by", [
  z.object({ by: z.literal("role"), role: z.enum(LOCATOR_ROLES), name: text(200), exact: z.boolean().default(false) }),
  z.object({ by: z.literal("text"), text: text(200), exact: z.boolean().default(false) }),
  z.object({ by: z.literal("label"), label: text(200), exact: z.boolean().default(false) }),
  z.object({ by: z.literal("placeholder"), placeholder: text(200), exact: z.boolean().default(false) }),
  z.object({ by: z.literal("testId"), testId: z.string().regex(/^[\w.:-]{1,100}$/, "Letters, digits, and . _ : - only") }),
  z.object({ by: z.literal("css"), selector: cssSelector }),
]);
export type JourneyLocator = z.infer<typeof locatorSchema>;

export const STEP_TIMEOUT_DEFAULT_MS = 5_000;
const timeoutMs = z.number().int().min(100).max(30_000).default(STEP_TIMEOUT_DEFAULT_MS);
const label = z.string().trim().max(120).optional();
/** Performance expectation: the step must resolve within this many milliseconds. */
const maxDurationMs = z.number().int().min(50).max(60_000).optional();

/** Relative path on the project origin. Absolute URLs and protocol-relative paths are refused. */
export const journeyPathSchema = z
  .string()
  .trim()
  .min(1)
  .max(1024)
  .refine((value) => value.startsWith("/") && !value.startsWith("//") && !value.includes("\\"), {
    message: "Use a path on the project origin, starting with a single /.",
  });

const navigateStep = z.object({ type: z.literal("navigate"), path: journeyPathSchema, label, timeoutMs: z.number().int().min(1_000).max(60_000).default(30_000) });
const reloadStep = z.object({ type: z.literal("reload"), label, timeoutMs: z.number().int().min(1_000).max(60_000).default(30_000) });
const clickStep = z.object({ type: z.literal("click"), target: locatorSchema, label, timeoutMs });
const fillStep = z.object({ type: z.literal("fill"), target: locatorSchema, value: z.string().max(200), label, timeoutMs });
const waitStep = z.object({ type: z.literal("waitForVisible"), target: locatorSchema, label, timeoutMs, maxDurationMs });
const assertVisibleStep = z.object({ type: z.literal("assertVisible"), target: locatorSchema, label, timeoutMs, maxDurationMs });
const assertHiddenStep = z.object({ type: z.literal("assertHidden"), target: locatorSchema, label, timeoutMs, maxDurationMs });
const assertEnabledStep = z.object({ type: z.literal("assertEnabled"), target: locatorSchema, label, timeoutMs, maxDurationMs });
const assertDisabledStep = z.object({ type: z.literal("assertDisabled"), target: locatorSchema, label, timeoutMs, maxDurationMs });
const assertTextStep = z.object({
  type: z.literal("assertText"),
  target: locatorSchema,
  text: text(200),
  match: z.enum(["contains", "equals"]).default("contains"),
  label,
  timeoutMs,
  maxDurationMs,
});

export const journeyStepSchema = z.discriminatedUnion("type", [
  navigateStep,
  reloadStep,
  clickStep,
  fillStep,
  waitStep,
  assertVisibleStep,
  assertHiddenStep,
  assertEnabledStep,
  assertDisabledStep,
  assertTextStep,
]);
export type JourneyStep = z.infer<typeof journeyStepSchema>;
export type JourneyStepType = JourneyStep["type"];

export const ASSERTION_STEP_TYPES = ["assertVisible", "assertHidden", "assertEnabled", "assertDisabled", "assertText"] as const;
export type AssertionStep = Extract<JourneyStep, { type: (typeof ASSERTION_STEP_TYPES)[number] }>;

export function isAssertionStep(step: JourneyStep): step is AssertionStep {
  return (ASSERTION_STEP_TYPES as readonly string[]).includes(step.type);
}

export const STEP_TYPE_LABELS: Record<JourneyStepType, string> = {
  navigate: "Navigate",
  reload: "Reload",
  click: "Click",
  fill: "Fill input",
  waitForVisible: "Wait until visible",
  assertVisible: "Assert visible",
  assertHidden: "Assert not visible",
  assertEnabled: "Assert enabled",
  assertDisabled: "Assert disabled",
  assertText: "Assert text",
};

const offlineExpectation = z.discriminatedUnion("type", [assertVisibleStep, assertHiddenStep, assertTextStep]);

const mutationSchema = z.object({
  method: z.enum(["POST", "PUT", "PATCH", "DELETE"]),
  path: journeyPathSchema,
});

export const journeyDefinitionSchema = z
  .object({
    schema: z.literal(JOURNEY_SCHEMA).default(JOURNEY_SCHEMA),
    name: text(100),
    description: z.string().trim().max(500).optional(),
    steps: z.array(journeyStepSchema).min(1, "Add at least one step").max(30, "Journeys are limited to 30 steps"),
    /** Performance expectation for the whole journey, measured from the first step's start to the last step's end. */
    performance: z.object({ maxJourneyMs: z.number().int().min(200).max(300_000).optional() }).default({}),
    /**
     * Recovery expectations evaluated only in the offline experiment, after the
     * journey runs with the browser context offline. Without them, offline
     * outcomes are recorded as observations, never as defects.
     */
    offlineExpectations: z.array(offlineExpectation).max(5).default([]),
    /** CSS selectors masked in screenshots (known dynamic regions such as clocks). */
    maskSelectors: z.array(cssSelector).max(10).default([]),
    /**
     * Requests with these methods and exact paths on the project origin may be sent.
     * Every other POST/PUT/PATCH/DELETE is blocked inside the browser so scans
     * cannot mutate data. Only list endpoints that are safe to call repeatedly.
     */
    allowedMutations: z.array(mutationSchema).max(10).default([]),
  })
  .superRefine((journey, ctx) => {
    if (journey.steps[0]?.type !== "navigate") {
      ctx.addIssue({ code: "custom", path: ["steps", 0], message: "The first step must navigate to a page." });
    }
  });
export type JourneyDefinition = z.infer<typeof journeyDefinitionSchema>;

export class JourneyScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JourneyScopeError";
  }
}

/** Resolves a journey path against the project origin and proves it cannot leave it. */
export function resolveJourneyUrl(origin: string, path: string): string {
  const parsed = journeyPathSchema.safeParse(path);
  if (!parsed.success) throw new JourneyScopeError(`Invalid journey path: ${path}`);
  const url = new URL(parsed.data, origin);
  if (url.origin !== new URL(origin).origin) throw new JourneyScopeError(`Journey path ${path} resolves outside ${origin}`);
  url.hash = "";
  return url.toString();
}

export function describeLocator(locator: JourneyLocator): string {
  switch (locator.by) {
    case "role":
      return `${locator.role} "${locator.name}"`;
    case "text":
      return `text "${locator.text}"`;
    case "label":
      return `field labeled "${locator.label}"`;
    case "placeholder":
      return `field with placeholder "${locator.placeholder}"`;
    case "testId":
      return `test id "${locator.testId}"`;
    case "css":
      return `CSS ${locator.selector}`;
  }
}

/** One-line human description of a step. */
export function describeStep(step: JourneyStep): string {
  if (step.label) return step.label;
  switch (step.type) {
    case "navigate":
      return `Open ${step.path}`;
    case "reload":
      return "Reload the page";
    case "click":
      return `Click ${describeLocator(step.target)}`;
    case "fill":
      return `Fill ${describeLocator(step.target)}`;
    case "waitForVisible":
      return `Wait for ${describeLocator(step.target)}`;
    case "assertVisible":
      return `${describeLocator(step.target)} is visible`;
    case "assertHidden":
      return `${describeLocator(step.target)} is not visible`;
    case "assertEnabled":
      return `${describeLocator(step.target)} is enabled`;
    case "assertDisabled":
      return `${describeLocator(step.target)} is disabled`;
    case "assertText":
      return `${describeLocator(step.target)} ${step.match === "equals" ? "equals" : "contains"} "${step.text}"`;
  }
}

/** Mutating methods that are blocked unless the journey explicitly allows them. */
export const MUTATING_METHODS = ["POST", "PUT", "PATCH", "DELETE"] as const;

export function isMutationAllowed(journey: Pick<JourneyDefinition, "allowedMutations">, origin: string, method: string, url: string): boolean {
  const upper = method.toUpperCase();
  if (!(MUTATING_METHODS as readonly string[]).includes(upper)) return true;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.origin !== new URL(origin).origin) return false;
  return journey.allowedMutations.some((m) => m.method === upper && m.path === parsed.pathname);
}
