import { NextResponse } from "next/server";
import { apiOperator, notFoundJson, unauthorized } from "@/lib/api";
import { getAnalysisStatus } from "@/lib/data/analysis";

/** Live Blast Radius progress: scan state plus each experiment's state, read from stored rows. */
export async function GET(_request: Request, { params }: { params: Promise<{ scanId: string }> }) {
  if (!(await apiOperator())) return unauthorized();
  const status = await getAnalysisStatus((await params).scanId);
  if (!status) return notFoundJson();
  return NextResponse.json(status, { headers: { "cache-control": "no-store" } });
}
