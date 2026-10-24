/**
 * URL normalization and origin allowlisting.
 *
 * This module is pure (WHATWG URL only) so it can run in the browser for form
 * feedback as well as on the server, where it is the authoritative check.
 * Network-level destination checks (DNS, private ranges) live in `./network`.
 */

export const MAX_URL_LENGTH = 2048;

export type UrlValidationErrorCode =
  | "empty"
  | "too_long"
  | "malformed"
  | "unsupported_scheme"
  | "credentials_not_allowed"
  | "missing_host"
  | "not_an_origin"
  | "invalid_wildcard";

export class UrlValidationError extends Error {
  constructor(
    readonly code: UrlValidationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "UrlValidationError";
  }
}

export interface NormalizedUrl {
  /** Normalized absolute URL with the fragment removed. */
  url: string;
  /** Serialized origin, e.g. `https://example.com` or `http://localhost:4600`. */
  origin: string;
  protocol: "http:" | "https:";
  /** Lowercase hostname without IPv6 brackets. */
  hostname: string;
  /** Effective port (explicit, or the scheme default). */
  port: number;
}

export function stripBrackets(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

export function effectivePort(url: URL): number {
  if (url.port) return Number(url.port);
  return url.protocol === "https:" ? 443 : 80;
}

/**
 * Parse and normalize a user-supplied target URL.
 * Only http(s) is accepted, embedded credentials are rejected, and the
 * fragment is dropped (it is never sent to servers and may hold tokens).
 */
export function normalizeTargetUrl(input: string): NormalizedUrl {
  const raw = input.trim();
  if (!raw) throw new UrlValidationError("empty", "Enter a URL.");
  if (raw.length > MAX_URL_LENGTH) {
    throw new UrlValidationError("too_long", `URLs are limited to ${MAX_URL_LENGTH} characters.`);
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UrlValidationError("malformed", "Enter a complete URL including http:// or https://.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UrlValidationError("unsupported_scheme", "Only http:// and https:// URLs can be scanned.");
  }
  if (url.username || url.password) {
    throw new UrlValidationError("credentials_not_allowed", "URLs must not contain usernames or passwords.");
  }
  const hostname = stripBrackets(url.hostname.toLowerCase());
  if (!hostname) throw new UrlValidationError("missing_host", "The URL must include a host name.");
  url.hash = "";
  const serialized = url.toString();
  if (serialized.length > MAX_URL_LENGTH) {
    throw new UrlValidationError("too_long", `URLs are limited to ${MAX_URL_LENGTH} characters.`);
  }
  return {
    url: serialized,
    origin: url.origin,
    protocol: url.protocol,
    hostname,
    port: effectivePort(url),
  };
}

/**
 * Normalize an origin such as `https://Example.com/` into `https://example.com`.
 * Paths, queries, and fragments are rejected so an origin cannot be confused with a page.
 */
export function normalizeOrigin(input: string): NormalizedUrl {
  const raw = input.trim();
  const normalized = normalizeTargetUrl(raw);
  const url = new URL(normalized.url);
  if ((url.pathname !== "/" && url.pathname !== "") || url.search) {
    throw new UrlValidationError(
      "not_an_origin",
      "Enter an origin only (scheme, host, and optional port), without a path or query.",
    );
  }
  return { ...normalized, url: normalized.origin };
}

/** One allowlist entry: an exact origin or a `*.` wildcard over subdomains. */
export interface AllowlistEntry {
  /** The entry as configured, normalized. */
  source: string;
  protocol: "http:" | "https:";
  /** Lowercase host. For wildcards, the suffix after `*.`. */
  host: string;
  wildcard: boolean;
  port: number;
}

export function parseAllowlistEntry(raw: string): AllowlistEntry {
  const trimmed = raw.trim();
  const wildcardMatch = /^(https?):\/\/\*\.(.+)$/i.exec(trimmed);
  if (wildcardMatch) {
    const [, scheme, rest] = wildcardMatch;
    if (!rest || rest.includes("*")) {
      throw new UrlValidationError("invalid_wildcard", `Invalid wildcard allowlist entry: ${trimmed}`);
    }
    const parsed = normalizeOrigin(`${scheme}://${rest}`);
    if (!parsed.hostname.includes(".") || /^[\d.]+$/.test(parsed.hostname) || parsed.hostname.includes(":")) {
      throw new UrlValidationError(
        "invalid_wildcard",
        `Wildcards must cover a registrable domain name, not a TLD or IP address: ${trimmed}`,
      );
    }
    return {
      source: `${parsed.protocol}//*.${new URL(parsed.origin).host}`,
      protocol: parsed.protocol,
      host: parsed.hostname,
      wildcard: true,
      port: parsed.port,
    };
  }
  if (trimmed.includes("*")) {
    throw new UrlValidationError("invalid_wildcard", `Wildcards are only allowed as a leading "*." label: ${trimmed}`);
  }
  const parsed = normalizeOrigin(trimmed);
  return { source: parsed.origin, protocol: parsed.protocol, host: parsed.hostname, wildcard: false, port: parsed.port };
}

/** Parse a comma or whitespace separated allowlist. Invalid entries throw. */
export function parseAllowlist(value: string | undefined | null): AllowlistEntry[] {
  if (!value) return [];
  return value
    .split(/[\s,]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map(parseAllowlistEntry);
}

function hostMatches(entry: AllowlistEntry, hostname: string): boolean {
  if (!entry.wildcard) return hostname === entry.host;
  return hostname.endsWith(`.${entry.host}`) && hostname.length > entry.host.length + 1;
}

/** Find the allowlist entry that authorizes a URL or origin, if any. */
export function findAllowlistMatch(target: string | NormalizedUrl, entries: AllowlistEntry[]): AllowlistEntry | null {
  let normalized: NormalizedUrl;
  try {
    normalized = typeof target === "string" ? normalizeTargetUrl(target) : target;
  } catch {
    return null;
  }
  return (
    entries.find(
      (entry) =>
        entry.protocol === normalized.protocol &&
        entry.port === normalized.port &&
        hostMatches(entry, normalized.hostname),
    ) ?? null
  );
}

export function isAllowlisted(target: string | NormalizedUrl, entries: AllowlistEntry[]): boolean {
  return findAllowlistMatch(target, entries) !== null;
}

/** True if a host:port pair (as seen by a proxy, without scheme) matches any entry. */
export function hostPortAllowlisted(hostname: string, port: number, entries: AllowlistEntry[]): boolean {
  const host = stripBrackets(hostname.toLowerCase());
  return entries.some((entry) => entry.port === port && hostMatches(entry, host));
}

export type ScanTargetCheck =
  | { ok: true; target: NormalizedUrl }
  | { ok: false; code: UrlValidationErrorCode | "not_allowlisted" | "origin_mismatch"; message: string };

/**
 * Authoritative check run before a scan is created: the URL must be valid,
 * belong to the project's origin, and that origin must still be allowlisted.
 */
export function checkScanTarget(input: string, projectOrigin: string, entries: AllowlistEntry[]): ScanTargetCheck {
  let target: NormalizedUrl;
  try {
    target = normalizeTargetUrl(input);
  } catch (error) {
    if (error instanceof UrlValidationError) return { ok: false, code: error.code, message: error.message };
    throw error;
  }
  if (target.origin !== projectOrigin) {
    return {
      ok: false,
      code: "origin_mismatch",
      message: `The URL must belong to this project's origin (${projectOrigin}).`,
    };
  }
  if (!isAllowlisted(target, entries)) {
    return {
      ok: false,
      code: "not_allowlisted",
      message: `${target.origin} is not on the server's scan allowlist (FAULTLINE_SCAN_ALLOWLIST).`,
    };
  }
  return { ok: true, target };
}
