/**
 * FUTURE CONTRACT (Phase "AI Detective"). Not implemented in Phase 1.
 *
 * These interfaces describe how evidence-backed AI analysis will plug in
 * without changing the evidence model. Nothing in Phase 1 calls a model, and
 * the UI never presents AI output because there is none.
 *
 * Rules any implementation must follow:
 * - Provider keys live only on the server (web or worker), never in browser code.
 * - Models receive evidence as untrusted data. Page text is never treated as instructions.
 * - Every hypothesis must cite evidence event ids or artifact ids it relies on.
 * - Output is a hypothesis, never test evidence. Only a browser execution produces evidence.
 */

export type AiProviderId = "anthropic" | "google" | "openai" | "openai-compatible";

export interface AiProviderConfig {
  provider: AiProviderId;
  /** Model identifier as accepted by the provider. */
  model: string;
  /** Base URL, required for `openai-compatible` (e.g. a local inference server). */
  baseUrl?: string;
  /** Name of the server-side environment variable holding the key. The key itself is never stored in the database. */
  apiKeyEnvVar?: string;
  maxOutputTokens?: number;
  timeoutMs?: number;
}

export type ConfidenceLabel = "low" | "medium" | "high";

export interface EvidenceCitation {
  executionId: string;
  /** Sequence number of an evidence event within the execution. */
  eventSeq?: number;
  artifactId?: string;
}

export interface RootCauseHypothesis {
  id: string;
  summary: string;
  reasoning: string;
  confidence: ConfidenceLabel;
  citations: EvidenceCitation[];
  /** Explicit statement of what would confirm or refute this hypothesis. */
  verificationIdea: string;
}

export interface SuggestedFix {
  hypothesisId: string;
  description: string;
  /** Optional unified diff. Never applied automatically. */
  patch?: string;
}

export interface AnalysisRequest {
  scanId: string;
  /** The exported report (faultline.report/v1) is the only input. */
  reportJson: unknown;
}

export interface AnalysisResult {
  provider: AiProviderId;
  model: string;
  createdAt: string;
  kind: "hypothesis";
  hypotheses: RootCauseHypothesis[];
  fixes: SuggestedFix[];
  /** Raw usage metadata reported by the provider, if any. */
  usage?: Record<string, number>;
}

export interface AiAnalysisAdapter {
  readonly provider: AiProviderId;
  /** Returns false (with a reason) when the adapter is not configured. */
  isConfigured(): { configured: true } | { configured: false; reason: string };
  analyze(request: AnalysisRequest, signal?: AbortSignal): Promise<AnalysisResult>;
}
