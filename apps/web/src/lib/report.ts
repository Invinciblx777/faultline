import "server-only";
import { buildReport, FAULTLINE_VERSION, type FaultlineReport, type ReportInput } from "@faultline/shared";
import type { ScanDetail } from "./data/queries";

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/** Maps persisted rows into the report contract. Only stored observations are used. */
export function reportFromDetail(detail: ScanDetail, generatedAt = new Date()): FaultlineReport {
  const input: ReportInput = {
    generator: { name: "faultline", version: FAULTLINE_VERSION },
    generatedAt: generatedAt.toISOString(),
    project: { id: detail.project.id, name: detail.project.name, origin: detail.project.origin },
    scan: {
      id: detail.scan.id,
      targetUrl: detail.scan.targetUrl,
      scenario: detail.scan.scenarioConfig,
      status: detail.scan.status,
      createdAt: detail.scan.createdAt.toISOString(),
      startedAt: iso(detail.scan.startedAt),
      finishedAt: iso(detail.scan.finishedAt),
      durationMs: detail.scan.durationMs,
      errorCode: detail.scan.errorCode,
      errorMessage: detail.scan.errorMessage,
      environment: detail.scan.environment ?? null,
    },
    executions: detail.executions.map((e) => ({
      id: e.id,
      role: e.role,
      status: e.status,
      outcome: e.outcome,
      conditions: e.conditions,
      requestedUrl: e.requestedUrl,
      finalUrl: e.finalUrl,
      httpStatus: e.httpStatus,
      pageTitle: e.pageTitle,
      startedAt: iso(e.startedAt),
      finishedAt: iso(e.finishedAt),
      durationMs: e.durationMs,
      browserName: e.browserName,
      browserVersion: e.browserVersion,
      userAgent: e.userAgent,
      viewport: e.viewport,
      navigationError: e.navigationError,
      summary: e.summary,
      events: e.events.map((ev) => ({
        seq: ev.seq,
        kind: ev.kind,
        severity: ev.severity,
        occurredAt: ev.occurredAt.toISOString(),
        offsetMs: ev.offsetMs,
        message: ev.message,
        url: ev.url,
        resourceType: ev.resourceType,
        method: ev.method,
        statusCode: ev.statusCode,
        detail: ev.detail,
      })),
      screenshot: e.screenshot
        ? {
            id: e.screenshot.id,
            kind: "screenshot",
            contentType: e.screenshot.contentType,
            byteSize: e.screenshot.byteSize,
            sha256: e.screenshot.sha256,
            width: e.screenshot.width,
            height: e.screenshot.height,
            createdAt: e.screenshot.createdAt.toISOString(),
          }
        : null,
    })),
  };
  return buildReport(input);
}
