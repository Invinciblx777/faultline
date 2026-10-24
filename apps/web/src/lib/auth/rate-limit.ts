/**
 * In-memory login throttling for a single web process. Failed attempts are
 * counted per username and per client address within a sliding window.
 * Multi-instance deployments should add throttling at the reverse proxy too.
 */

const WINDOW_MS = 15 * 60_000;
const MAX_PER_USERNAME = 5;
const MAX_PER_CLIENT = 20;

const failures = new Map<string, number[]>();

function recent(key: string, now: number): number[] {
  const list = (failures.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (list.length) failures.set(key, list);
  else failures.delete(key);
  return list;
}

export function loginBlocked(username: string, client: string, now = Date.now()): { blocked: boolean; retryAfterMs: number } {
  const u = recent(`u:${username.toLowerCase()}`, now);
  const c = recent(`c:${client}`, now);
  const over = u.length >= MAX_PER_USERNAME ? u : c.length >= MAX_PER_CLIENT ? c : null;
  if (!over) return { blocked: false, retryAfterMs: 0 };
  return { blocked: true, retryAfterMs: Math.max(0, WINDOW_MS - (now - over[0]!)) };
}

export function recordLoginFailure(username: string, client: string, now = Date.now()) {
  for (const key of [`u:${username.toLowerCase()}`, `c:${client}`]) {
    failures.set(key, [...recent(key, now), now]);
  }
}

export function clearLoginFailures(username: string) {
  failures.delete(`u:${username.toLowerCase()}`);
}

export function resetRateLimiter() {
  failures.clear();
}
