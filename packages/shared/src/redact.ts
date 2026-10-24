/**
 * Redaction helpers applied to everything the worker records from untrusted pages.
 * FAULTLINE never stores request/response headers, cookies, or bodies. URLs and
 * console text are stored, so obvious secrets inside them are masked.
 */

export const REDACTED = "[redacted]";
export const MAX_MESSAGE_LENGTH = 2000;
export const MAX_STORED_URL_LENGTH = 2048;

const SENSITIVE_PARAM =
  /(^|[_-])(token|access[_-]?token|refresh[_-]?token|id[_-]?token|auth|authorization|key|api[_-]?key|apikey|secret|client[_-]?secret|password|passwd|pwd|pass|session|sessionid|sid|sig|signature|code|credential|credentials|jwt|bearer|otp|nonce|state|x-amz-credential|x-amz-signature|x-amz-security-token)$/i;

export function isSensitiveParam(name: string): boolean {
  return SENSITIVE_PARAM.test(name);
}

export function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1))}…`;
}

/**
 * Remove credentials, mask sensitive query parameters, and drop fragments that
 * look like they carry parameters (e.g. OAuth implicit-flow tokens).
 * Non-URL input (e.g. `data:` URLs) is summarized instead of stored.
 */
export function redactUrl(input: string): string {
  if (input.startsWith("data:")) {
    const comma = input.indexOf(",");
    const meta = comma > 0 ? input.slice(0, comma) : input.slice(0, 64);
    return `${truncate(meta, 120)},…`;
  }
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return truncate(input, MAX_STORED_URL_LENGTH);
  }
  if (url.username) url.username = REDACTED;
  if (url.password) url.password = REDACTED;
  const names = [...new Set([...url.searchParams.keys()])];
  for (const name of names) {
    if (isSensitiveParam(name)) url.searchParams.set(name, REDACTED);
  }
  if (url.hash && url.hash.includes("=")) url.hash = REDACTED;
  return truncate(url.toString(), MAX_STORED_URL_LENGTH);
}

const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const BEARER_PATTERN = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const KEY_VALUE_PATTERN =
  /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password|passwd|authorization|token)(["']?\s*[:=]\s*["']?)([^\s"'&,;]{4,})/gi;
const URL_IN_TEXT = /\bhttps?:\/\/[^\s"'<>)]+/gi;

/** Mask likely secrets in free text captured from the page (console messages, exceptions). */
export function redactText(input: string, max = MAX_MESSAGE_LENGTH): string {
  const masked = input
    .replace(URL_IN_TEXT, (match) => redactUrl(match))
    .replace(JWT_PATTERN, "[redacted-jwt]")
    .replace(BEARER_PATTERN, (_m, scheme: string) => `${scheme} ${REDACTED}`)
    .replace(KEY_VALUE_PATTERN, (_m, key: string, sep: string) => `${key}${sep}${REDACTED}`);
  return truncate(masked, max);
}
