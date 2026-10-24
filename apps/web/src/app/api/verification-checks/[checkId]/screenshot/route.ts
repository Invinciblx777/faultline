import { Readable } from "node:stream";
import { apiOperator, notFoundJson, unauthorized } from "@/lib/api";
import { getVerificationCheckScreenshot } from "@/lib/data/repairs";
import { getStorage } from "@/lib/storage";

/** Streams the screenshot a verification check recorded, to signed-in operators only. */
export async function GET(request: Request, { params }: { params: Promise<{ checkId: string }> }) {
  if (!(await apiOperator())) return unauthorized();
  const shot = await getVerificationCheckScreenshot((await params).checkId);
  if (!shot) return notFoundJson();
  const etag = `"${shot.sha256}"`;
  if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: { etag } });
  const object = await getStorage().get(shot.key);
  return new Response(Readable.toWeb(object.body) as ReadableStream, {
    headers: {
      "content-type": "image/png",
      "content-length": String(shot.bytes),
      etag,
      "x-faultline-sha256": shot.sha256,
      "cache-control": "private, max-age=31536000, immutable",
      "content-security-policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
      "x-content-type-options": "nosniff",
    },
  });
}
