import { NextResponse } from "next/server";
import { apiOperator, notFoundJson, unauthorized } from "@/lib/api";
import { getRepairStatus } from "@/lib/data/repairs";

/** Live repair state read from stored rows. Polling this never calls Devin or GitHub. */
export async function GET(_request: Request, { params }: { params: Promise<{ repairId: string }> }) {
  if (!(await apiOperator())) return unauthorized();
  const status = await getRepairStatus((await params).repairId);
  if (!status) return notFoundJson();
  return NextResponse.json(status, { headers: { "cache-control": "no-store" } });
}
