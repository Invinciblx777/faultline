/**
 * Posts FAULTLINE's verdict comment on a repair's pull request, once.
 *
 *   GITHUB_TOKEN=$(gh auth token) pnpm repair:comment <repairId> [--run <runId>] [--title-detail <text>] [--limitation <n>]... [--dry-run] [--out <file.md>]
 *
 * --run picks a completed run other than the latest, such as a cross-check;
 * each run gets its own comment. --title-detail adds a qualifier to the heading.
 * --limitation quotes only the PR's nth agent-stated limitation, as the one this
 * run tests (repeatable).
 * --dry-run only prints the Markdown. --out also writes it to a file, which is
 * the paste-in fallback when the token cannot comment. Screenshot links come
 * from FAULTLINE_COMMENT_IMAGE_URL, a URL template containing {sha256}.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { GitHubClient } from "@faultline/shared/integrations";
import { createDatabase } from "../src/client";
import { buildRepairVerdictComment, postVerificationComment } from "../src/verdict-comment";
import { loadRootEnv } from "./env";

loadRootEnv();
const args = process.argv.slice(2).filter((a) => a !== "--");
const VALUE_FLAGS = ["--out", "--run", "--title-detail", "--limitation"];
const values = (flag: string) => args.flatMap((a, i) => (a === flag ? [args[i + 1]] : []));
const repairId = args.find((a, i) => !a.startsWith("--") && !VALUE_FLAGS.includes(args[i - 1] ?? ""));
const dryRun = args.includes("--dry-run");
const [outArg] = values("--out");
// pnpm runs this script from packages/db; resolve --out against the directory the command was typed in.
const out = outArg ? resolve(process.env.INIT_CWD ?? process.cwd(), outArg) : undefined;
const [runId] = values("--run");
const [titleDetail] = values("--title-detail");
const testedLimitations = values("--limitation").map(Number);
const missingValue = VALUE_FLAGS.some((flag) => values(flag).some((v) => !v || v.startsWith("--")));
if (!repairId || missingValue || testedLimitations.some((n) => !Number.isInteger(n) || n < 1)) {
  console.error("Usage: pnpm repair:comment <repairId> [--run <runId>] [--title-detail <text>] [--limitation <n>]... [--dry-run] [--out <file.md>]");
  process.exit(2);
}
const options = { runId, titleDetail, testedLimitations: testedLimitations.length ? testedLimitations : undefined };
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
    const built = await buildRepairVerdictComment(db, repairId, imageUrl, options);
    if (!built.ok) throw new Error(built.error);
    if (out) writeFileSync(out, `${built.markdown}\n`);
    console.log(built.markdown);
  } else {
    const result = await postVerificationComment(db, new GitHubClient({ token: process.env.GITHUB_TOKEN?.trim() || null }), repairId, { ...options, imageUrl });
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
