import { z } from "zod";

/**
 * Resource types FAULTLINE can deliberately abort. These map to Playwright's
 * `request.resourceType()` values. `document` is intentionally excluded:
 * aborting the main document is not a degraded-resource scenario.
 */
export const BLOCKABLE_RESOURCE_TYPES = [
  "stylesheet",
  "image",
  "font",
  "script",
  "media",
  "fetch",
  "xhr",
] as const;
export type BlockableResourceType = (typeof BLOCKABLE_RESOURCE_TYPES)[number];

export const RESOURCE_TYPE_LABELS: Record<BlockableResourceType, string> = {
  stylesheet: "Stylesheets",
  image: "Images",
  font: "Web fonts",
  script: "Scripts",
  media: "Audio & video",
  fetch: "Fetch requests",
  xhr: "XHR requests",
};

/** Which requests of the selected types are aborted, relative to the target origin. */
export const BLOCK_SCOPES = ["all", "first-party", "third-party"] as const;
export type BlockScope = (typeof BLOCK_SCOPES)[number];

export const BLOCK_SCOPE_LABELS: Record<BlockScope, string> = {
  all: "All origins",
  "first-party": "Target origin only",
  "third-party": "Other origins only",
};

/**
 * Network error code the browser reports for intentionally aborted requests.
 * These are Playwright `route.abort()` error codes.
 */
export const ABORT_ERROR_CODES = ["failed", "connectionfailed", "connectionrefused", "timedout", "blockedbyclient"] as const;
export type AbortErrorCode = (typeof ABORT_ERROR_CODES)[number];

export const VIEWPORT_PRESETS = ["desktop", "mobile"] as const;
export type ViewportPreset = (typeof VIEWPORT_PRESETS)[number];

export const VIEWPORT_PRESET_LABELS: Record<ViewportPreset, string> = {
  desktop: "Desktop · 1366×900",
  mobile: "Mobile emulation · 430×932",
};

export const SCENARIO_KINDS = ["resource-block", "offline-reload"] as const;
export type ScenarioKind = (typeof SCENARIO_KINDS)[number];

export const SCENARIO_LABELS: Record<ScenarioKind, string> = {
  "resource-block": "Resource failure",
  "offline-reload": "Offline reload",
};

export const SCENARIO_DESCRIPTIONS: Record<ScenarioKind, string> = {
  "resource-block":
    "Loads the page normally, then loads it again in a fresh browser context while deliberately aborting the selected resource types.",
  "offline-reload":
    "Loads the page normally, then switches the browser context offline and reloads. This is browser-context network emulation, not physical device network loss.",
};

const resourceBlockSchema = z.object({
  kind: z.literal("resource-block"),
  resourceTypes: z
    .array(z.enum(BLOCKABLE_RESOURCE_TYPES))
    .min(1, "Select at least one resource type")
    .max(BLOCKABLE_RESOURCE_TYPES.length)
    .transform((types) => [...new Set(types)].sort()),
  scope: z.enum(BLOCK_SCOPES).default("all"),
  abortErrorCode: z.enum(ABORT_ERROR_CODES).default("failed"),
  viewport: z.enum(VIEWPORT_PRESETS).default("desktop"),
});

const offlineReloadSchema = z.object({
  kind: z.literal("offline-reload"),
  viewport: z.enum(VIEWPORT_PRESETS).default("desktop"),
});

export const scenarioConfigSchema = z.discriminatedUnion("kind", [resourceBlockSchema, offlineReloadSchema]);
export type ScenarioConfig = z.infer<typeof scenarioConfigSchema>;
export type ResourceBlockScenario = z.infer<typeof resourceBlockSchema>;
export type OfflineReloadScenario = z.infer<typeof offlineReloadSchema>;

/** Human readable one-line summary of a scenario configuration. */
export function describeScenario(config: ScenarioConfig): string {
  switch (config.kind) {
    case "resource-block": {
      const types = config.resourceTypes.map((t) => RESOURCE_TYPE_LABELS[t].toLowerCase()).join(", ");
      const scope = config.scope === "all" ? "" : ` (${BLOCK_SCOPE_LABELS[config.scope].toLowerCase()})`;
      return `Abort ${types}${scope}`;
    }
    case "offline-reload":
      return "Reload while the browser context is offline";
  }
}

/** Conditions applied to one execution, recorded verbatim in evidence. */
export interface ExecutionConditions {
  network: "normal" | "resource-block" | "offline-emulation";
  /** Exact resource types aborted (resource-block only). */
  blockedResourceTypes?: BlockableResourceType[];
  blockScope?: BlockScope;
  abortErrorCode?: AbortErrorCode;
  /** Ordered steps the worker performs. */
  steps: string[];
  viewport: ViewportPreset;
  serviceWorkers: "allow" | "block";
  notes: string[];
}

export function conditionsFor(config: ScenarioConfig, role: "baseline" | "fault"): ExecutionConditions {
  if (config.kind === "resource-block") {
    const base = {
      viewport: config.viewport,
      // Service workers are blocked so every request passes through Playwright routing,
      // which is required for interception to be complete.
      serviceWorkers: "block" as const,
      steps: ["navigate", "wait for load", "wait for network to settle (bounded)", "capture screenshot"],
    };
    if (role === "baseline") {
      return { ...base, network: "normal", notes: ["No requests are intentionally altered."] };
    }
    return {
      ...base,
      network: "resource-block",
      blockedResourceTypes: config.resourceTypes,
      blockScope: config.scope,
      abortErrorCode: config.abortErrorCode,
      notes: [
        "Matching requests are aborted inside the browser before they leave it; servers are never contacted for them.",
        "Server responses are never replaced or fabricated.",
      ],
    };
  }

  const steps = [
    "navigate",
    "wait for load",
    "wait for network to settle (bounded)",
    role === "fault" ? "switch browser context offline" : "keep network online",
    "reload",
    "capture screenshot",
  ];
  return {
    viewport: config.viewport,
    // Service workers are allowed so an application's own offline support can be observed.
    serviceWorkers: "allow",
    network: role === "fault" ? "offline-emulation" : "normal",
    steps,
    notes:
      role === "fault"
        ? [
            "Offline is emulated by the browser context (Playwright setOffline). It is not physical device network loss.",
            "Whether the page should work offline depends on the application's intended offline support, which is not configured. Outcomes are recorded as observations.",
          ]
        : ["The reload runs with the network online, so it is comparable to the offline reload."],
  };
}
