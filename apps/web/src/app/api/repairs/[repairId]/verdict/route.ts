import { NextResponse } from "next/server";
import { buildRepairVerdictComment } from "@faultline/db";
import { apiOperator, notFoundJson, unauthorized } from "@/lib/api";
import { getDb } from "@/lib/db";
import { isUuid } from "@/lib/data/queries";

/** The verdict report as Markdown: the same text FAULTLINE posts on the pull request. */
export async function GET(_request: Request, { params }: { params: Promise<{ repairId: string }> }) {
  if (!(await apiOperator())) return unauthorized();
  const { repairId } = await params;
  if (!isUuid(repairId)) return notFoundJson();
  const built = await buildRepairVerdictComment(getDb(), repairId);
  if (!built.ok) return built.error === "Repair not found." ? notFoundJson() : NextResponse.json({ error: built.error }, { status: 409 });
  return new NextResponse(`${built.markdown}\n`, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "content-disposition": `attachment; filename="faultline-verdict-${repairId}.md"`,
      "cache-control": "no-store",
    },
  });
}
