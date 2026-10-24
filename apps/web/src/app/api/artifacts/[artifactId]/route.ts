import { Readable } from "node:stream";
import { apiOperator, notFoundJson, unauthorized } from "@/lib/api";
import { getArtifact } from "@/lib/data/queries";
import { getStorage } from "@/lib/storage";

/** Streams a stored artifact to an authenticated operator. The bucket itself is never public. */
export async function GET(request: Request, { params }: { params: Promise<{ artifactId: string }> }) {
  if (!(await apiOperator())) return unauthorized();
  const artifact = await getArtifact((await params).artifactId);
  if (!artifact || artifact.contentType !== "image/png") return notFoundJson();
  const etag = `"${artifact.sha256}"`;
  if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: { etag } });
  const object = await getStorage().get(artifact.storageKey);
  const download = new URL(request.url).searchParams.get("download") === "1";
  return new Response(Readable.toWeb(object.body) as ReadableStream, {
    headers: {
      "content-type": "image/png",
      "content-length": String(artifact.byteSize),
      etag,
      "x-faultline-sha256": artifact.sha256,
      // Artifacts are immutable; cache privately in the operator's browser only.
      "cache-control": "private, max-age=31536000, immutable",
      "content-security-policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
      "x-content-type-options": "nosniff",
      ...(download ? { "content-disposition": `attachment; filename="faultline-${artifact.executionId}.png"` } : {}),
    },
  });
}
