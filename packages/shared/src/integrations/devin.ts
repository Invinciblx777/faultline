import { z } from "zod";

/**
 * Server-side client for the Devin API v3.
 *
 * Request and response shapes follow Devin's published OpenAPI document
 * (https://docs.devin.ai/v3-openapi.json): SessionCreateRequest,
 * SessionResponse, PaginatedResponse[SessionMessage], ServiceUserSelf,
 * RepositoryResponse, AttachmentResponse, and RFC 9457 ProblemDetail errors.
 * Unknown extra fields are ignored; required fields are validated.
 *
 * The API key is only ever placed in the Authorization header. It never
 * appears in errors, logs, or return values.
 */

export const DEVIN_DEFAULT_BASE_URL = "https://api.devin.ai";

export const DEVIN_SESSION_STATUSES = ["new", "claimed", "running", "exit", "error", "suspended", "resuming"] as const;
export type DevinSessionStatus = (typeof DEVIN_SESSION_STATUSES)[number];

// Status values outside the documented enum are kept as strings rather than rejected,
// so a new upstream status shows up as-is instead of breaking synchronization.
export const devinSessionSchema = z.object({
  session_id: z.string().min(1),
  url: z.string().url(),
  status: z.string().min(1),
  status_detail: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  tags: z.array(z.string()).default([]),
  org_id: z.string().nullable().optional(),
  created_at: z.number().int(),
  updated_at: z.number().int(),
  acus_consumed: z.number().optional(),
  pull_requests: z.array(z.object({ pr_url: z.string(), pr_state: z.string().nullable().optional() })).default([]),
  is_archived: z.boolean().optional(),
});
export type DevinSession = z.infer<typeof devinSessionSchema>;

export const devinMessageSchema = z.object({
  event_id: z.string().min(1),
  source: z.string().min(1),
  message: z.string(),
  created_at: z.number().int(),
});
export type DevinMessage = z.infer<typeof devinMessageSchema>;

const paginated = <T extends z.ZodType>(item: T) =>
  z.object({
    items: z.array(item),
    has_next_page: z.boolean().default(false),
    end_cursor: z.string().nullable().optional(),
  });

export const devinSelfSchema = z.object({
  principal_type: z.string(),
  service_user_id: z.string().optional(),
  service_user_name: z.string().optional(),
  user_id: z.string().optional(),
  user_name: z.string().optional(),
  org_id: z.string().nullable().optional(),
});
export type DevinSelf = z.infer<typeof devinSelfSchema>;

export const devinRepositorySchema = z.object({
  repo_full_name: z.string(),
  repo_name: z.string(),
  repo_path: z.string(),
  git_connection_host: z.string(),
});
export type DevinRepository = z.infer<typeof devinRepositorySchema>;

export const devinAttachmentSchema = z.object({ attachment_id: z.string(), name: z.string(), url: z.string().url() });
export type DevinAttachment = z.infer<typeof devinAttachmentSchema>;

const problemSchema = z.object({ title: z.string().optional(), status: z.number().optional(), detail: z.string().nullable().optional(), error_code: z.string().nullable().optional() });

export interface CreateSessionRequest {
  prompt: string;
  title?: string;
  tags?: string[];
  repos?: string[];
  attachment_urls?: string[];
  max_acu_limit?: number;
}

export type DevinErrorCategory =
  | "not_configured"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "invalid_request"
  | "rate_limited"
  | "server_error"
  | "timeout"
  | "network"
  | "invalid_response";

export class DevinApiError extends Error {
  constructor(
    readonly category: DevinErrorCategory,
    message: string,
    readonly httpStatus: number | null = null,
    /** Whether the request may have been processed even though no response confirmed it. */
    readonly ambiguous = false,
  ) {
    super(message);
    this.name = "DevinApiError";
  }
}

const CATEGORY_HINTS: Partial<Record<DevinErrorCategory, string>> = {
  unauthorized: "The API key was rejected. Use a v3 service-user key (prefix cog_) in DEVIN_API_KEY.",
  forbidden: "The service user lacks permission. Grant it UseDevinSessions and ViewOrgSessions in Settings > Devin API, and check DEVIN_ORG_ID.",
  not_found: "Not found. Check DEVIN_ORG_ID (prefix org-) and the session ID.",
  rate_limited: "Devin rate-limited the request.",
};

export interface DevinClientOptions {
  apiKey: string;
  orgId: string;
  baseUrl?: string;
  timeoutMs?: number;
  /** Attempts for requests that are safe to repeat (reads, and writes rejected with 429). */
  maxAttempts?: number;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export type DevinConfig = { configured: true; apiKey: string; orgId: string; baseUrl: string } | { configured: false; reason: string };

/** Reads DEVIN_API_KEY, DEVIN_ORG_ID, and optional DEVIN_API_BASE_URL. */
export function devinConfigFromEnv(env: Record<string, string | undefined>): DevinConfig {
  const apiKey = env.DEVIN_API_KEY?.trim();
  const orgId = env.DEVIN_ORG_ID?.trim();
  if (!apiKey && !orgId) return { configured: false, reason: "DEVIN_API_KEY and DEVIN_ORG_ID are not set." };
  if (!apiKey) return { configured: false, reason: "DEVIN_API_KEY is not set." };
  if (!orgId) return { configured: false, reason: "DEVIN_ORG_ID is not set (find it at the top of Settings > Devin API)." };
  if (!apiKey.startsWith("cog_")) return { configured: false, reason: "DEVIN_API_KEY must be a v3 service-user key (prefix cog_). Legacy apk_ keys do not work with API v3." };
  if (!/^org-[A-Za-z0-9_-]+$/.test(orgId)) return { configured: false, reason: "DEVIN_ORG_ID must look like org-…" };
  const baseUrl = env.DEVIN_API_BASE_URL?.trim() || DEVIN_DEFAULT_BASE_URL;
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== "https:" && url.hostname !== "127.0.0.1" && url.hostname !== "localhost") return { configured: false, reason: "DEVIN_API_BASE_URL must use https." };
  } catch {
    return { configured: false, reason: "DEVIN_API_BASE_URL is not a valid URL." };
  }
  return { configured: true, apiKey, orgId, baseUrl: baseUrl.replace(/\/+$/, "") };
}

/** Devin reports integer timestamps without a documented unit; values this large are milliseconds. */
export function devinTimestamp(value: number): Date {
  return new Date(value > 1e12 ? value : value * 1000);
}

const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);

function categorize(status: number): DevinErrorCategory {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 400 || status === 422) return "invalid_request";
  if (status === 429) return "rate_limited";
  return "server_error";
}

function retryDelayMs(attempt: number, retryAfter: string | null): number {
  const seconds = retryAfter ? Number(retryAfter) : NaN;
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 30_000);
  return Math.min(1000 * 2 ** (attempt - 1), 8_000);
}

export class DevinClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly options: DevinClientOptions) {
    if (!options.apiKey) throw new DevinApiError("not_configured", "DEVIN_API_KEY is not set.");
    if (!options.orgId) throw new DevinApiError("not_configured", "DEVIN_ORG_ID is not set.");
    this.baseUrl = (options.baseUrl ?? DEVIN_DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.maxAttempts = Math.max(1, options.maxAttempts ?? 3);
    this.fetchImpl = options.fetch ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  private orgPath(path: string): string {
    return `/v3/organizations/${encodeURIComponent(this.options.orgId)}${path}`;
  }

  /**
   * Sends one request. `idempotent` requests are retried with backoff on 429
   * and 502/503/504. Non-idempotent requests are retried only on 429 (the
   * request was refused, so nothing was created); a timeout or 5xx on them is
   * reported as ambiguous and never repeated here.
   */
  private async request<T extends z.ZodType>(
    method: "GET" | "POST",
    path: string,
    schema: T,
    options: { body?: unknown; form?: FormData; query?: URLSearchParams; idempotent: boolean },
  ): Promise<z.infer<T>> {
    const url = `${this.baseUrl}${path}${options.query && [...options.query].length ? `?${options.query}` : ""}`;
    for (let attempt = 1; ; attempt++) {
      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          method,
          headers: {
            authorization: `Bearer ${this.options.apiKey}`,
            accept: "application/json",
            ...(options.body !== undefined ? { "content-type": "application/json" } : {}),
          },
          body: options.form ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined),
          signal: AbortSignal.timeout(this.timeoutMs),
          redirect: "error",
        });
      } catch (error) {
        const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
        const category = timedOut ? "timeout" : "network";
        if (options.idempotent && attempt < this.maxAttempts) {
          await this.sleep(retryDelayMs(attempt, null));
          continue;
        }
        throw new DevinApiError(
          category,
          timedOut ? `Devin API did not respond within ${this.timeoutMs} ms (${method} ${path}).` : `Could not reach the Devin API (${method} ${path}): ${error instanceof Error ? error.message : String(error)}`,
          null,
          !options.idempotent,
        );
      }

      if (response.ok) {
        const text = await response.text();
        let json: unknown;
        try {
          json = text ? JSON.parse(text) : null;
        } catch {
          throw new DevinApiError("invalid_response", `Devin API returned a non-JSON response for ${method} ${path}.`, response.status);
        }
        const parsed = schema.safeParse(json);
        if (!parsed.success) {
          const issue = parsed.error.issues[0];
          throw new DevinApiError("invalid_response", `Devin API response for ${method} ${path} did not match the documented schema (${issue?.path.join(".") || "root"}: ${issue?.message}).`, response.status);
        }
        return parsed.data;
      }

      const retryable = RETRYABLE_STATUSES.has(response.status) && (options.idempotent || response.status === 429);
      if (retryable && attempt < this.maxAttempts) {
        await response.body?.cancel().catch(() => undefined);
        await this.sleep(retryDelayMs(attempt, response.headers.get("retry-after")));
        continue;
      }
      const problem = problemSchema.safeParse(await response.json().catch(() => null));
      const detail = problem.success ? [problem.data.title, problem.data.detail, problem.data.error_code].filter(Boolean).join(": ") : "";
      const category = categorize(response.status);
      const hint = CATEGORY_HINTS[category];
      throw new DevinApiError(
        category,
        `Devin API ${method} ${path} returned HTTP ${response.status}${detail ? ` (${detail.slice(0, 300)})` : ""}.${hint ? ` ${hint}` : ""}`,
        response.status,
        category === "server_error" && !options.idempotent,
      );
    }
  }

  /** GET /v3/self: validates the credential without side effects. */
  self(): Promise<DevinSelf> {
    return this.request("GET", "/v3/self", devinSelfSchema, { idempotent: true });
  }

  /** POST /v3/organizations/{org_id}/sessions. Creates a session and spends credits. */
  createSession(body: CreateSessionRequest): Promise<DevinSession> {
    return this.request("POST", this.orgPath("/sessions"), devinSessionSchema, { body, idempotent: false });
  }

  /** GET /v3/organizations/{org_id}/sessions/{devin_id} */
  getSession(sessionId: string): Promise<DevinSession> {
    return this.request("GET", this.orgPath(`/sessions/${encodeURIComponent(sessionId)}`), devinSessionSchema, { idempotent: true });
  }

  /**
   * Sessions carrying a tag, created after a point in time. Results are also
   * filtered by tag locally, so a server that ignores the filter cannot
   * return unrelated sessions.
   */
  async findSessionsByTag(tag: string, createdAfter: Date): Promise<DevinSession[]> {
    const found: DevinSession[] = [];
    let after: string | null | undefined = null;
    for (let page = 0; page < 10; page++) {
      const query = new URLSearchParams({ first: "100", tags: tag, created_after: String(Math.floor(createdAfter.getTime() / 1000) - 60) });
      if (after) query.set("after", after);
      const result = await this.request("GET", this.orgPath("/sessions"), paginated(devinSessionSchema), { query, idempotent: true });
      found.push(...result.items.filter((s) => s.tags.includes(tag)));
      if (!result.has_next_page || !result.end_cursor) break;
      after = result.end_cursor;
    }
    return found;
  }

  /** GET /v3/organizations/{org_id}/sessions/{devin_id}/messages, one page in chronological order. */
  listMessages(sessionId: string, after: string | null, first = 100) {
    const query = new URLSearchParams({ first: String(first) });
    if (after) query.set("after", after);
    return this.request("GET", this.orgPath(`/sessions/${encodeURIComponent(sessionId)}/messages`), paginated(devinMessageSchema), { query, idempotent: true });
  }

  /** GET /v3/organizations/{org_id}/repositories filtered by name: confirms Devin's Git connection can see a repository. */
  async findRepository(fullName: string): Promise<DevinRepository | null> {
    const name = fullName.split("/").pop() ?? fullName;
    const query = new URLSearchParams({ first: "100", filter_name: name });
    const result = await this.request("GET", this.orgPath("/repositories"), paginated(devinRepositorySchema), { query, idempotent: true });
    return result.items.find((r) => r.repo_full_name.toLowerCase() === fullName.toLowerCase()) ?? null;
  }

  /** POST /v3/organizations/{org_id}/attachments (multipart, field "file"). */
  uploadAttachment(filename: string, bytes: Uint8Array, contentType: string): Promise<DevinAttachment> {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(bytes)], { type: contentType }), filename);
    return this.request("POST", this.orgPath("/attachments"), devinAttachmentSchema, { form, idempotent: false });
  }
}
