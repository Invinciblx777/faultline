import { z } from "zod";
import { FAULT_KINDS, type DependencyGroup, type DependencyMatcher, type FaultKind } from "./dependencies";
import { describeStep, isAssertionStep, type JourneyDefinition } from "./journey";

/**
 * Blast Radius analysis: one baseline journey, one independent calibration
 * run, then isolated experiments that each disturb exactly one dependency (or
 * one environmental condition) and compare the journey against the baseline.
 */

export const ERROR_STATUSES = [500, 503] as const;
export type InjectedErrorStatus = (typeof ERROR_STATUSES)[number];

export const NARROW_VIEWPORT = { width: 360, height: 740 } as const;

export const blastRadiusConfigSchema = z
  .object({
    kind: z.literal("blast-radius"),
    journeyId: z.uuid("Choose a journey."),
    /** Fault kinds applied to discovered dependencies (automatic selection). */
    faults: z
      .array(z.enum(FAULT_KINDS))
      .max(FAULT_KINDS.length)
      .default(["unavailable", "http-error", "latency"])
      .transform((kinds) => FAULT_KINDS.filter((k) => kinds.includes(k))),
    errorStatus: z.union([z.literal(500), z.literal(503)]).default(503),
    latencyMs: z.number().int().min(250).max(20_000).default(3_000),
    includeOffline: z.boolean().default(false),
    includeNarrowViewport: z.boolean().default(false),
    maxExperiments: z.number().int().min(1).max(20).default(8),
    /** Re-run BROKEN and DEGRADED experiments once in a fresh context to check reproducibility. */
    confirmFindings: z.boolean().default(true),
    /** Explicit dependency selection (from an earlier analysis). Replaces automatic selection when present. */
    targets: z
      .array(z.object({ dependencyKey: z.string().min(1).max(600), fault: z.enum(FAULT_KINDS) }))
      .max(20)
      .optional(),
    viewport: z.enum(["desktop", "mobile"]).default("desktop"),
  })
  .refine((c) => c.faults.length > 0 || c.includeOffline || c.includeNarrowViewport || (c.targets?.length ?? 0) > 0, {
    message: "Select at least one fault or condition to test.",
    path: ["faults"],
  });
export type BlastRadiusConfig = z.infer<typeof blastRadiusConfigSchema>;

export const EXPERIMENT_KINDS = ["unavailable", "http-error", "latency", "offline", "narrow-viewport"] as const;
export type ExperimentKind = (typeof EXPERIMENT_KINDS)[number];

export const EXPERIMENT_KIND_LABELS: Record<ExperimentKind, string> = {
  unavailable: "Dependency unavailable",
  "http-error": "API returns an error",
  latency: "Slow response",
  offline: "Online → offline",
  "narrow-viewport": "Narrow viewport",
};

/** Exact fault configuration applied in one experiment. Recorded verbatim as evidence. */
export type ExperimentFault =
  | { kind: "unavailable"; matcher: DependencyMatcher; abortErrorCode: "connectionrefused" }
  | { kind: "http-error"; matcher: DependencyMatcher; status: InjectedErrorStatus }
  | { kind: "latency"; matcher: DependencyMatcher; delayMs: number }
  | { kind: "offline" }
  | { kind: "narrow-viewport"; width: number; height: number };

export function describeFault(fault: ExperimentFault, dependencyLabel?: string | null): string {
  const target = dependencyLabel ?? ("matcher" in fault ? fault.matcher.origin : "");
  switch (fault.kind) {
    case "unavailable":
      return `Requests to ${target} are aborted in the browser (connection refused)`;
    case "http-error":
      return `Requests to ${target} receive an injected HTTP ${fault.status} response`;
    case "latency":
      return `Requests to ${target} are held for ${fault.delayMs} ms before being sent`;
    case "offline":
      return "The browser context is switched offline after the first page loads";
    case "narrow-viewport":
      return `The journey runs in a ${fault.width}×${fault.height} touch viewport (Chromium emulation)`;
  }
}

export interface PlannedExperiment {
  ordinal: number;
  kind: ExperimentKind;
  dependencyKey: string | null;
  fault: ExperimentFault;
}

export interface SkippedCandidate {
  dependencyKey: string;
  fault: FaultKind;
  reason: string;
}

function faultFor(kind: FaultKind, group: DependencyGroup, config: BlastRadiusConfig): ExperimentFault {
  switch (kind) {
    case "unavailable":
      return { kind, matcher: group.matcher, abortErrorCode: "connectionrefused" };
    case "http-error":
      return { kind, matcher: group.matcher, status: config.errorStatus };
    case "latency":
      return { kind, matcher: group.matcher, delayMs: config.latencyMs };
  }
}

/** Lower is tested first: first-party APIs, then third-party origins, scripts and styles, then other static files. */
function priority(group: DependencyGroup): number {
  if (group.scope === "endpoint") return 0;
  if (group.scope === "origin") return 1;
  if (group.resourceTypes.some((t) => t === "script" || t === "stylesheet")) return 2;
  return 3;
}

/** The order fault kinds are tried for one dependency. Error responses first for APIs, outages first otherwise. */
function faultOrder(group: DependencyGroup): FaultKind[] {
  return group.scope === "endpoint" ? ["http-error", "unavailable", "latency"] : ["unavailable", "latency", "http-error"];
}

/**
 * Chooses which experiments to run. Deterministic. Every candidate that is
 * not scheduled is returned with the reason, so nothing is silently dropped.
 */
export function planExperiments(dependencies: DependencyGroup[], config: BlastRadiusConfig): { planned: PlannedExperiment[]; skipped: SkippedCandidate[] } {
  const planned: PlannedExperiment[] = [];
  const skipped: SkippedCandidate[] = [];
  const push = (kind: ExperimentKind, dependencyKey: string | null, fault: ExperimentFault) =>
    planned.push({ ordinal: planned.length + 1, kind, dependencyKey, fault });

  if (config.targets && config.targets.length > 0) {
    for (const target of config.targets) {
      const group = dependencies.find((d) => d.key === target.dependencyKey);
      if (!group) {
        skipped.push({ ...target, reason: "Not observed in this analysis's baseline, so there was nothing to disturb." });
      } else if (!group.eligibleFaults.includes(target.fault)) {
        skipped.push({ ...target, reason: group.ineligibleReason ?? "This fault is not eligible for this dependency." });
      } else if (planned.length >= config.maxExperiments) {
        skipped.push({ ...target, reason: `Experiment limit of ${config.maxExperiments} reached.` });
      } else {
        push(target.fault, group.key, faultFor(target.fault, group, config));
      }
    }
  } else {
    const sorted = [...dependencies].sort((a, b) => priority(a) - priority(b));
    const candidates: Array<{ group: DependencyGroup; fault: FaultKind; round: number }> = [];
    for (const group of sorted) {
      let round = 0;
      for (const fault of faultOrder(group)) {
        if (!config.faults.includes(fault)) continue;
        if (!group.eligibleFaults.includes(fault)) {
          skipped.push({ dependencyKey: group.key, fault, reason: group.ineligibleReason ?? "Not eligible for this fault." });
          continue;
        }
        candidates.push({ group, fault, round: round++ });
      }
    }
    // Breadth first: every dependency gets its first fault before any gets a second.
    candidates.sort((a, b) => a.round - b.round || priority(a.group) - priority(b.group));
    for (const candidate of candidates) {
      if (planned.length >= config.maxExperiments) {
        skipped.push({ dependencyKey: candidate.group.key, fault: candidate.fault, reason: `Experiment limit of ${config.maxExperiments} reached.` });
      } else {
        push(candidate.fault, candidate.group.key, faultFor(candidate.fault, candidate.group, config));
      }
    }
  }
  // Environmental conditions do not count toward the dependency experiment limit.
  if (config.includeOffline) push("offline", null, { kind: "offline" });
  if (config.includeNarrowViewport) push("narrow-viewport", null, { kind: "narrow-viewport", ...NARROW_VIEWPORT });
  return { planned, skipped };
}

// ---------------------------------------------------------------------------
// Verdicts
// ---------------------------------------------------------------------------

export const VERDICTS = ["broken", "degraded", "resilient", "inconclusive", "test_failed"] as const;
export type Verdict = (typeof VERDICTS)[number];

export const VERDICT_LABELS: Record<Verdict, string> = {
  broken: "BROKEN",
  degraded: "DEGRADED",
  resilient: "RESILIENT",
  inconclusive: "INCONCLUSIVE",
  test_failed: "TEST FAILED",
};

export const VERDICT_DEFINITIONS: Record<Verdict, string> = {
  broken: "A behavioral check that passed in both baseline runs failed, or was never reached, under this condition.",
  degraded: "Behavioral checks held, but a configured performance, layout, or recovery expectation was violated.",
  resilient: "Every configured check that passed in both baseline runs also passed under this condition.",
  inconclusive: "The evidence cannot support a verdict: no usable assertions, unstable baseline, fault never applied, incomplete capture, or a result that did not reproduce.",
  test_failed: "The experiment itself could not execute reliably. This says nothing about the website.",
};

export type StepStatus = "passed" | "failed" | "not_reached";

export interface StepObservation {
  index: number;
  status: StepStatus;
  durationMs: number | null;
  error: string | null;
}

export interface JourneyObservation {
  /** False when FAULTLINE itself failed (engine error, browser launch, crash of the harness). */
  completed: boolean;
  engineError: string | null;
  steps: StepObservation[];
  /** First step start to last step end; null when the journey did not run every step. */
  journeyMs: number | null;
  captureComplete: boolean;
  /** Requests the injected fault acted on. Not meaningful for baselines. */
  faultApplications: number;
  layout: { horizontalOverflowPx: number; offscreenSteps: number[] } | null;
  offlineChecks: StepObservation[];
}

export interface VerdictReason {
  code: string;
  message: string;
  stepIndex?: number;
}

export interface ExperimentEvaluation {
  verdict: Verdict;
  reasons: VerdictReason[];
  /** Journey step indexes whose expectation this experiment violated. */
  affectedSteps: number[];
  usableAssertions: number[];
  excludedSteps: Array<{ index: number; reason: string }>;
}

const passed = (o: JourneyObservation, i: number) => o.steps.find((s) => s.index === i)?.status === "passed";

/**
 * Rule-based verdict from recorded observations only. No scores, weights, or
 * inference: each rule cites the step and the observation that triggered it.
 */
export function evaluateExperiment(input: {
  journey: JourneyDefinition;
  kind: ExperimentKind;
  baseline: JourneyObservation;
  calibration: JourneyObservation;
  experiment: JourneyObservation;
}): ExperimentEvaluation {
  const { journey, kind, baseline, calibration, experiment } = input;
  const reasons: VerdictReason[] = [];
  const excludedSteps: ExperimentEvaluation["excludedSteps"] = [];
  const result = (verdict: Verdict, affectedSteps: number[] = [], usableAssertions: number[] = []): ExperimentEvaluation => ({
    verdict,
    reasons,
    affectedSteps,
    usableAssertions,
    excludedSteps,
  });

  if (!experiment.completed) {
    reasons.push({ code: "engine_error", message: `The experiment did not execute reliably: ${experiment.engineError ?? "unknown error"}.` });
    return result("test_failed");
  }
  if (!baseline.completed || !calibration.completed) {
    reasons.push({ code: "baseline_incomplete", message: "A baseline run did not complete, so there is nothing reliable to compare against." });
    return result("inconclusive");
  }

  const assertionIndexes = journey.steps.flatMap((step, i) => (isAssertionStep(step) ? [i] : []));
  if (assertionIndexes.length === 0) {
    reasons.push({
      code: "no_assertions",
      message: "The journey has no assertion steps. FAULTLINE does not give a passing verdict to a journey that checks nothing.",
    });
    return result("inconclusive");
  }

  const stable: number[] = [];
  journey.steps.forEach((step, i) => {
    const b = passed(baseline, i);
    const c = passed(calibration, i);
    if (b && c) stable.push(i);
    else if (b !== c) excludedSteps.push({ index: i, reason: `Unstable: ${b ? "passed" : "failed"} in the baseline and ${c ? "passed" : "failed"} in the calibration run.` });
    else excludedSteps.push({ index: i, reason: "Did not pass in either baseline run, so it cannot show a regression." });
  });
  const usableAssertions = assertionIndexes.filter((i) => stable.includes(i));
  if (usableAssertions.length === 0) {
    reasons.push({ code: "no_usable_assertions", message: "No assertion passed consistently in both baseline runs." });
    return result("inconclusive", [], usableAssertions);
  }

  const isDependencyFault = kind === "unavailable" || kind === "http-error" || kind === "latency";
  if (isDependencyFault && experiment.faultApplications === 0) {
    reasons.push({
      code: "fault_not_applied",
      message: "The selected dependency was never requested during this experiment, so the fault had no opportunity to act.",
    });
    return result("inconclusive", [], usableAssertions);
  }

  const broken = stable.filter((i) => !passed(experiment, i));

  if (kind === "offline") {
    if (broken.length > 0) {
      const first = experiment.steps.find((s) => s.index === broken[0]);
      reasons.push({
        code: "offline_observation",
        message: `Observed offline: step ${broken[0]! + 1} (${describeStep(journey.steps[broken[0]!]!)}) ${first?.status === "not_reached" ? "was not reached" : "failed"}.`,
        stepIndex: broken[0],
      });
    }
    if (journey.offlineExpectations.length === 0) {
      reasons.push({
        code: "no_offline_expectation",
        message: "No offline-resilience expectation is configured, so the offline behavior is recorded as an observation, not judged.",
      });
      return result("inconclusive", broken, usableAssertions);
    }
    const failedChecks = experiment.offlineChecks.filter((c) => c.status !== "passed");
    if (failedChecks.length > 0) {
      for (const check of failedChecks) {
        const step = journey.offlineExpectations[check.index];
        reasons.push({
          code: "offline_expectation_failed",
          message: `Offline expectation not met: ${step ? describeStep(step) : `#${check.index + 1}`}${check.error ? ` (${check.error})` : ""}.`,
        });
      }
      return result("degraded", broken, usableAssertions);
    }
    reasons.push({ code: "offline_expectations_met", message: `All ${journey.offlineExpectations.length} offline expectations were met.` });
    return result("resilient", broken, usableAssertions);
  }

  if (broken.length > 0) {
    for (const i of broken) {
      const obs = experiment.steps.find((s) => s.index === i);
      const step = journey.steps[i]!;
      reasons.push({
        code: obs?.status === "not_reached" ? "step_not_reached" : isAssertionStep(step) ? "assertion_failed" : "action_failed",
        message:
          obs?.status === "not_reached"
            ? `Step ${i + 1} (${describeStep(step)}) was never reached because an earlier step failed.`
            : `Step ${i + 1} (${describeStep(step)}) passed in both baseline runs but failed${obs?.error ? `: ${obs.error}` : "."}`,
        stepIndex: i,
      });
    }
    return result("broken", broken, usableAssertions);
  }

  const violations: VerdictReason[] = [];
  journey.steps.forEach((step, i) => {
    if (!("maxDurationMs" in step) || step.maxDurationMs === undefined || !stable.includes(i)) return;
    const b = baseline.steps.find((s) => s.index === i)?.durationMs ?? null;
    const c = calibration.steps.find((s) => s.index === i)?.durationMs ?? null;
    const e = experiment.steps.find((s) => s.index === i)?.durationMs ?? null;
    if (b === null || c === null || b > step.maxDurationMs || c > step.maxDurationMs) {
      excludedSteps.push({ index: i, reason: `Duration budget of ${step.maxDurationMs} ms was not met in both baseline runs, so it is not used.` });
      return;
    }
    if (e !== null && e > step.maxDurationMs) {
      violations.push({
        code: "step_budget_exceeded",
        message: `Step ${i + 1} (${describeStep(step)}) took ${e} ms; its budget is ${step.maxDurationMs} ms (baseline ${b} ms, calibration ${c} ms).`,
        stepIndex: i,
      });
    }
  });
  const maxJourneyMs = journey.performance.maxJourneyMs;
  if (maxJourneyMs !== undefined) {
    const b = baseline.journeyMs;
    const c = calibration.journeyMs;
    if (b === null || c === null || b > maxJourneyMs || c > maxJourneyMs) {
      reasons.push({ code: "journey_budget_unusable", message: `The journey budget of ${maxJourneyMs} ms was not met in both baseline runs, so it is not used.` });
    } else if (experiment.journeyMs !== null && experiment.journeyMs > maxJourneyMs) {
      violations.push({
        code: "journey_budget_exceeded",
        message: `The journey took ${experiment.journeyMs} ms; its budget is ${maxJourneyMs} ms (baseline ${b} ms, calibration ${c} ms).`,
      });
    }
  }
  if (kind === "narrow-viewport" && experiment.layout) {
    if (experiment.layout.horizontalOverflowPx > 0) {
      violations.push({
        code: "horizontal_overflow",
        message: `The page is ${experiment.layout.horizontalOverflowPx} px wider than the viewport, so it scrolls horizontally.`,
      });
    }
    for (const i of experiment.layout.offscreenSteps) {
      violations.push({
        code: "control_offscreen",
        message: `The control used in step ${i + 1} (${describeStep(journey.steps[i]!)}) extends beyond the viewport's horizontal bounds.`,
        stepIndex: i,
      });
    }
  }
  if (violations.length > 0) {
    reasons.push(...violations);
    return result(
      "degraded",
      [...new Set(violations.flatMap((v) => (v.stepIndex === undefined ? [] : [v.stepIndex])))],
      usableAssertions,
    );
  }

  if (!experiment.captureComplete) {
    reasons.push({ code: "capture_incomplete", message: "Every check passed, but evidence capture hit a limit, so a passing verdict is withheld." });
    return result("inconclusive", [], usableAssertions);
  }
  reasons.push({
    code: "checks_passed",
    message: `All ${usableAssertions.length} usable assertion${usableAssertions.length === 1 ? "" : "s"} and every action step passed under this condition.`,
  });
  return result("resilient", [], usableAssertions);
}

export type Reproducibility = "single-run" | "reproduced" | "not-reproduced" | "not-applicable";

export const REPRODUCIBILITY_LABELS: Record<Reproducibility, string> = {
  "single-run": "Single run",
  reproduced: "Reproduced 2/2",
  "not-reproduced": "Did not reproduce",
  "not-applicable": "Not applicable",
};

/** Combines a first attempt with an optional confirmation attempt. Disagreement is reported, never averaged away. */
export function combineAttempts(first: ExperimentEvaluation, second: ExperimentEvaluation | null): ExperimentEvaluation & { reproducibility: Reproducibility } {
  if (first.verdict === "test_failed") return { ...first, reproducibility: "not-applicable" };
  if (!second) return { ...first, reproducibility: "single-run" };
  if (second.verdict === first.verdict) {
    return { ...first, reproducibility: "reproduced" };
  }
  return {
    ...first,
    verdict: "inconclusive",
    reasons: [
      ...first.reasons,
      {
        code: "not_reproduced",
        message: `A confirmation run in a fresh browser context produced ${VERDICT_LABELS[second.verdict]} instead of ${VERDICT_LABELS[first.verdict]}, so the result is not treated as reliable.`,
      },
    ],
    reproducibility: "not-reproduced",
  };
}

/** True when the verdict describes a user-visible problem worth a regression test. */
export function isFinding(verdict: Verdict): boolean {
  return verdict === "broken" || verdict === "degraded";
}
