import "server-only";
import { FAULTLINE_VERSION } from "@faultline/shared";
import type { AnalysisDetail } from "./data/analysis";

export const ANALYSIS_REPORT_SCHEMA = "faultline.analysis/v1";

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/** JSON export of a Blast Radius analysis, built only from persisted rows. */
export function analysisReport(detail: AnalysisDetail, generatedAt = new Date()) {
  const { scan, project } = detail;
  return {
    schema: ANALYSIS_REPORT_SCHEMA,
    generator: { name: "faultline", version: FAULTLINE_VERSION },
    generatedAt: generatedAt.toISOString(),
    project: { id: project.id, name: project.name, origin: project.origin },
    analysis: {
      id: scan.id,
      status: scan.status,
      targetUrl: scan.targetUrl,
      config: scan.scenarioConfig,
      journey: scan.journeySnapshot,
      createdAt: iso(scan.createdAt),
      startedAt: iso(scan.startedAt),
      finishedAt: iso(scan.finishedAt),
      durationMs: scan.durationMs,
      errorCode: scan.errorCode,
      errorMessage: scan.errorMessage,
      environment: scan.environment ?? null,
      summary: scan.analysis ?? null,
    },
    executions: detail.executions.map((e) => ({
      id: e.id,
      role: e.role,
      ordinal: e.ordinal,
      attempt: e.attempt,
      experimentId: e.experimentId,
      status: e.status,
      outcome: e.outcome,
      durationMs: e.durationMs,
      viewport: e.viewport,
      summary: e.summary,
      failureMessage: e.failureMessage,
    })),
    dependencies: detail.dependencies.map((d) => ({
      key: d.key,
      label: d.label,
      scope: d.scope,
      party: d.party,
      requestCount: d.requestCount,
      failedCount: d.failedCount,
      statuses: d.statuses,
      medianDurationMs: d.medianDurationMs,
      sampleUrls: d.sampleUrls,
      requestedDuringSteps: d.requestedDuringSteps,
      eligibleFaults: d.eligibleFaults,
      ineligibleReason: d.ineligibleReason,
    })),
    experiments: detail.experiments.map((e) => ({
      id: e.id,
      ordinal: e.ordinal,
      kind: e.kind,
      dependencyKey: e.dependencyKey,
      fault: e.fault,
      status: e.status,
      verdict: e.verdict,
      reproducibility: e.reproducibility,
      reasons: e.reasons,
      affectedSteps: e.affectedSteps,
      usableAssertions: e.usableAssertions,
      excludedSteps: e.excludedSteps,
      newErrors: e.newErrors,
      affectedRequestCount: e.affectedRequestCount,
      newFailedRequestCount: e.newFailedRequestCount,
      visual: e.visual,
      failureMessage: e.failureMessage,
      durationMs: e.durationMs,
      regressionTest: detail.regressionTests.find((t) => t.experimentId === e.id) ?? null,
    })),
  };
}
