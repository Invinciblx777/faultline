import { NextResponse } from "next/server";
import { apiOperator, notFoundJson, unauthorized } from "@/lib/api";
import { getScanDetail } from "@/lib/data/queries";
import { reportFromDetail } from "@/lib/report";

/** Structured JSON export (faultline.report/v1) built only from persisted observations. */
export async function GET(_request: Request, { params }: { params: Promise<{ scanId: string }> }) {
  if (!(await apiOperator())) return unauthorized();
  const detail = await getScanDetail((await params).scanId);
  if (!detail) return notFoundJson();
  const report = reportFromDetail(detail);
  return new NextResponse(JSON.stringify(report, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="faultline-scan-${detail.scan.id}.json"`,
      "cache-control": "no-store",
    },
  });
}
