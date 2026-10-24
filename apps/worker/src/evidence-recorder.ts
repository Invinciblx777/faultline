import {
  EVIDENCE_LIMITS,
  emptySummary,
  redactText,
  redactUrl,
  truncate,
  type EvidenceEvent,
  type EvidenceKind,
  type EvidenceSeverity,
  type ExecutionSummary,
} from "@faultline/shared";

export interface RecordInput {
  kind: EvidenceKind;
  severity: EvidenceSeverity;
  message: string;
  url?: string | null;
  resourceType?: string | null;
  method?: string | null;
  statusCode?: number | null;
  detail?: Record<string, unknown> | null;
}

/**
 * Collects evidence for one execution with redaction and hard limits.
 * Text coming from the page is untrusted: it is redacted, truncated, and
 * only ever stored and displayed as data.
 */
export class EvidenceRecorder {
  readonly events: EvidenceEvent[] = [];
  readonly summary: ExecutionSummary = emptySummary();
  private readonly perKind = new Map<EvidenceKind, number>();
  private seq = 0;

  constructor(readonly startedAt: Date = new Date()) {}

  record(input: RecordInput): EvidenceEvent | null {
    const kindCount = this.perKind.get(input.kind) ?? 0;
    if (kindCount >= EVIDENCE_LIMITS.perKind[input.kind] || this.events.length >= EVIDENCE_LIMITS.maxEventsPerExecution) {
      this.summary.droppedEvents[input.kind] = (this.summary.droppedEvents[input.kind] ?? 0) + 1;
      return null;
    }
    this.perKind.set(input.kind, kindCount + 1);
    const now = new Date();
    const event: EvidenceEvent = {
      seq: this.seq++,
      kind: input.kind,
      severity: input.severity,
      occurredAt: now.toISOString(),
      offsetMs: Math.max(0, now.getTime() - this.startedAt.getTime()),
      message: redactText(input.message),
      url: input.url ? redactUrl(input.url) : null,
      resourceType: input.resourceType ? truncate(input.resourceType, 32) : null,
      method: input.method ? truncate(input.method, 16) : null,
      statusCode: input.statusCode ?? null,
      detail: input.detail ?? null,
    };
    this.events.push(event);
    return event;
  }

  lifecycle(message: string, detail?: Record<string, unknown>) {
    return this.record({ kind: "lifecycle", severity: "info", message, detail: detail ?? null });
  }
}
