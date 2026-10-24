import { redactUrl } from "./redact";

/**
 * Network dependency discovery.
 *
 * Dependencies are derived only from requests a real browser execution made.
 * Each observed request is assigned to one dependency group; the group keeps
 * the exact (redacted) URLs it was built from so the readable grouping always
 * points back to evidence.
 */

export type Party = "first-party" | "third-party";

export const DEPENDENCY_SCOPES = ["endpoint", "resource", "origin"] as const;
export type DependencyScope = (typeof DEPENDENCY_SCOPES)[number];

/** How a fault experiment selects requests. Matching is exact on origin and normalized path. */
export interface DependencyMatcher {
  scope: DependencyScope;
  origin: string;
  /** Endpoint scope only. */
  method?: string;
  /** Endpoint and resource scope: normalized path (see `normalizePath`). */
  pathPattern?: string;
}

export const API_RESOURCE_TYPES = ["fetch", "xhr", "eventsource"] as const;
const SAFE_METHODS = new Set(["GET", "HEAD"]);

/** One request as recorded by the worker (already redacted). */
export interface ObservedRequest {
  url: string;
  method: string;
  resourceType: string;
  status: number | null;
  durationMs: number | null;
  outcome: "completed" | "failed" | "cancelled" | "intercepted" | "pending";
  isMainDocument: boolean;
}

export interface DependencyGroup {
  key: string;
  label: string;
  scope: DependencyScope;
  party: Party;
  origin: string;
  method: string | null;
  pathPattern: string | null;
  resourceTypes: string[];
  matcher: DependencyMatcher;
  requestCount: number;
  failedCount: number;
  statuses: number[];
  medianDurationMs: number | null;
  /** Exact observed URLs (redacted), up to 5. */
  sampleUrls: string[];
  /** Fault kinds that may be applied to this dependency. */
  eligibleFaults: FaultKind[];
  ineligibleReason: string | null;
}

export const FAULT_KINDS = ["unavailable", "http-error", "latency"] as const;
export type FaultKind = (typeof FAULT_KINDS)[number];

export const FAULT_KIND_LABELS: Record<FaultKind, string> = {
  unavailable: "Dependency unavailable",
  "http-error": "API returns an error",
  latency: "Slow response",
};

const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Collapses identifier-like path segments so repeated calls to the same
 * endpoint group together: numbers, UUIDs, long hex strings, and long mixed
 * alphanumeric tokens become placeholders.
 */
export function normalizePath(pathname: string): string {
  const segments = pathname.split("/").map((segment) => {
    if (!segment) return segment;
    if (/^\d+$/.test(segment)) return ":n";
    if (UUID_SEGMENT.test(segment)) return ":uuid";
    if (/^[0-9a-f]{16,}$/i.test(segment)) return ":hex";
    if (segment.length >= 24 && /\d/.test(segment) && /[a-z]/i.test(segment) && !segment.includes(".")) return ":token";
    return segment;
  });
  return segments.join("/") || "/";
}

function originOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return "/";
  }
}

/** Assigns a request to its dependency group, or null when it is not a dependency (main document, data: URLs). */
export function classifyRequest(
  request: Pick<ObservedRequest, "url" | "method" | "resourceType" | "isMainDocument">,
  targetOrigin: string,
): Omit<DependencyGroup, "requestCount" | "failedCount" | "statuses" | "medianDurationMs" | "sampleUrls" | "eligibleFaults" | "ineligibleReason"> | null {
  if (request.isMainDocument) return null;
  const origin = originOf(request.url);
  if (!origin) return null;
  const party: Party = origin === new URL(targetOrigin).origin ? "first-party" : "third-party";
  const method = request.method.toUpperCase();
  const pathPattern = normalizePath(pathOf(request.url));
  const host = new URL(origin).host;

  if (party === "third-party") {
    return {
      key: `origin ${origin}`,
      label: host,
      scope: "origin",
      party,
      origin,
      method: null,
      pathPattern: null,
      resourceTypes: [request.resourceType],
      matcher: { scope: "origin", origin },
    };
  }
  if ((API_RESOURCE_TYPES as readonly string[]).includes(request.resourceType)) {
    return {
      key: `endpoint ${method} ${origin}${pathPattern}`,
      label: `${method} ${pathPattern}`,
      scope: "endpoint",
      party,
      origin,
      method,
      pathPattern,
      resourceTypes: [request.resourceType],
      matcher: { scope: "endpoint", origin, method, pathPattern },
    };
  }
  return {
    key: `resource ${origin}${pathPattern}`,
    label: pathPattern,
    scope: "resource",
    party,
    origin,
    method: null,
    pathPattern,
    resourceTypes: [request.resourceType],
    matcher: { scope: "resource", origin, pathPattern },
  };
}

/** True when a request falls inside a dependency matcher. */
export function matchesDependency(matcher: DependencyMatcher, request: { url: string; method: string }): boolean {
  const origin = originOf(request.url);
  if (!origin || origin !== matcher.origin) return false;
  if (matcher.scope === "origin") return true;
  if (matcher.scope === "endpoint" && matcher.method && request.method.toUpperCase() !== matcher.method) return false;
  return normalizePath(pathOf(request.url)) === matcher.pathPattern;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

function eligibility(group: Pick<DependencyGroup, "scope" | "method" | "resourceTypes">): { faults: FaultKind[]; reason: string | null } {
  if (group.scope === "endpoint") {
    if (group.method && SAFE_METHODS.has(group.method)) return { faults: ["unavailable", "http-error", "latency"], reason: null };
    return {
      faults: ["unavailable"],
      reason: `${group.method} requests are not given injected error or delayed responses; only GET and HEAD are treated as safe to intercept that way.`,
    };
  }
  return {
    faults: ["unavailable", "latency"],
    reason: "Injected error responses are applied only to first-party API endpoints called with GET or HEAD. Whole origins and static files are tested as unavailable or slow.",
  };
}

/** Groups observed requests into dependencies. Deterministic: sorted by party, scope, then key. */
export function discoverDependencies(requests: ObservedRequest[], targetOrigin: string): DependencyGroup[] {
  const groups = new Map<string, DependencyGroup & { durations: number[] }>();
  for (const request of requests) {
    const base = classifyRequest(request, targetOrigin);
    if (!base) continue;
    let group = groups.get(base.key);
    if (!group) {
      group = {
        ...base,
        resourceTypes: [],
        requestCount: 0,
        failedCount: 0,
        statuses: [],
        medianDurationMs: null,
        sampleUrls: [],
        eligibleFaults: [],
        ineligibleReason: null,
        durations: [],
      };
      groups.set(base.key, group);
    }
    group.requestCount += 1;
    if (!group.resourceTypes.includes(request.resourceType)) group.resourceTypes.push(request.resourceType);
    if (request.outcome === "failed") group.failedCount += 1;
    if (request.status !== null && !group.statuses.includes(request.status)) group.statuses.push(request.status);
    if (request.durationMs !== null) group.durations.push(request.durationMs);
    const sample = redactUrl(request.url);
    if (group.sampleUrls.length < 5 && !group.sampleUrls.includes(sample)) group.sampleUrls.push(sample);
  }
  const order: Record<DependencyScope, number> = { endpoint: 0, origin: 1, resource: 2 };
  return [...groups.values()]
    .map(({ durations, ...group }) => {
      const { faults, reason } = eligibility(group);
      return {
        ...group,
        resourceTypes: group.resourceTypes.sort(),
        statuses: group.statuses.sort((a, b) => a - b),
        medianDurationMs: median(durations),
        eligibleFaults: faults,
        ineligibleReason: reason,
      };
    })
    .sort((a, b) => (a.party === b.party ? order[a.scope] - order[b.scope] || a.key.localeCompare(b.key) : a.party === "first-party" ? -1 : 1));
}
