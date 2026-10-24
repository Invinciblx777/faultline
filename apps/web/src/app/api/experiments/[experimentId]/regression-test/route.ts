import { apiOperator, notFoundJson, unauthorized } from "@/lib/api";
import { getRegressionTest } from "@/lib/data/analysis";

/** Downloads the generated Playwright regression test for a finding. */
export async function GET(_request: Request, { params }: { params: Promise<{ experimentId: string }> }) {
  if (!(await apiOperator())) return unauthorized();
  const test = await getRegressionTest((await params).experimentId);
  if (!test || !/^[a-z0-9-]+\.spec\.ts$/.test(test.filename)) return notFoundJson();
  return new Response(test.content, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "content-disposition": `attachment; filename="${test.filename}"`,
      "x-faultline-sha256": test.sha256,
      "x-content-type-options": "nosniff",
      "cache-control": "no-store",
    },
  });
}
