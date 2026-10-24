/**
 * Posts FAULTLINE's verdict comment on a repair's pull request, once.
 *
 *   GITHUB_TOKEN=$(gh auth token) pnpm repair:comment <repairId> [--dry-run] [--out <file.md>]
 *
 * --dry-run only prints the Markdown. --out also writes it to a file, which is
 * the paste-in fallback when the token cannot comment. Screenshot links come
 * from FAULTLINE_COMMENT_IMAGE_URL, a URL template containing {sha256}.
 */
import { writeFileSync } from "node:fs";
import { GitHubClient } from "@faultline/shared/integrations";
import { createDatabase } from "../src/client";
import { buildRepairVerdictComment, postVerificationComment } from "../src/verdict-comment";
import { loadRootEnv } from "./env";

loadRootEnv();
const args = process.argv.slice(2).filter((a) => a !== "--");
const repairId = args.find((a) => !a.startsWith("--"));
const dryRun = args.includes("--dry-run");
const outIndex = args.indexOf("--out");
const out = outIndex >= 0 ? args[outIndex + 1] : undefined;
if (!repairId || (outIndex >= 0 && !out)) {
  console.error("Usage: pnpm repair:comment <repairId> [--dry-run] [--out <file.md>]");
  process.exit(2);
}
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set.");
  process.exit(2);
}

const template = process.env.FAULTLINE_COMMENT_IMAGE_URL?.trim();
const imageUrl = template && template.includes("{sha256}") ? (sha: string) => template.replace("{sha256}", sha) : undefined;
const { db, pool } = createDatabase(databaseUrl, { max: 2, applicationName: "faultline-verdict-comment" });

try {
  if (dryRun) {
    const built = await buildRepairVerdictComment(db, repairId, imageUrl);
    if (!built.ok) throw new Error(built.error);
    if (out) writeFileSync(out, `${built.markdown}\n`);
    console.log(built.markdown);
  } else {
    const result = await postVerificationComment(db, new GitHubClient({ token: process.env.GITHUB_TOKEN?.trim() || null }), repairId, { imageUrl });
    if (out && result.markdown) writeFileSync(out, `${result.markdown}\n`);
    if (!result.ok) {
      console.error(result.error);
      if (out && result.markdown) console.error(`The Markdown is in ${out}; paste it into the pull request.`);
      process.exitCode = 1;
    } else {
      console.log(`${result.created ? "Posted" : "Already posted"}: ${result.url}`);
    }
  }
} finally {
  await pool.end();
}
