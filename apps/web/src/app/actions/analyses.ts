"use server";

import { redirect } from "next/navigation";
import { requireOperator } from "@/lib/auth/dal";
import { getDb } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { enqueueScan } from "@/lib/queue";
import { analysisInputFromForm, createAnalysis } from "@/lib/services/analyses";

export interface AnalysisFormState {
  error?: string;
  fieldErrors?: Record<string, string>;
}

export async function launchAnalysisAction(_prev: AnalysisFormState, form: FormData): Promise<AnalysisFormState> {
  const operator = await requireOperator();
  const env = getEnv();
  const result = await createAnalysis(
    { db: getDb(), allowlist: env.FAULTLINE_SCAN_ALLOWLIST, enqueue: enqueueScan, maxActive: env.FAULTLINE_MAX_ACTIVE_ANALYSES },
    operator,
    analysisInputFromForm(form),
  );
  if (!result.ok) return { error: result.error, fieldErrors: result.fieldErrors };
  redirect(`/scans/${result.scanId}/blast-radius`);
}
