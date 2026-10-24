import { NextResponse } from "next/server";
import { apiOperator, notFoundJson, unauthorized } from "@/lib/api";
import { getScanStatus } from "@/lib/data/queries";

/** Live scan status for the progress view. */
export async function GET(_request: Request, { params }: { params: Promise<{ scanId: string }> }) {
  if (!(await apiOperator())) return unauthorized();
  const status = await getScanStatus((await params).scanId);
  if (!status) return notFoundJson();
  return NextResponse.json(status, { headers: { "cache-control": "no-store" } });
}
