/**
 * Creates (or resets the password of) an operator account.
 *
 *   pnpm operator:create <username>
 *
 * The password is read from the FAULTLINE_OPERATOR_PASSWORD environment variable
 * if set (for automation), otherwise prompted for without echo. It is never
 * accepted as a command-line argument, which would leak into shell history and
 * process listings.
 */
import { eq, sql } from "drizzle-orm";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline";
import { hashPassword, validatePasswordStrength } from "@faultline/shared/password";
import { createDatabase } from "../src/client";
import { operators } from "../src/schema";
import { loadRootEnv } from "./env";

function promptHidden(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!stdin.isTTY) {
      reject(new Error("No TTY available. Set FAULTLINE_OPERATOR_PASSWORD to provide the password non-interactively."));
      return;
    }
    const rl = createInterface({ input: stdin, output: stdout, terminal: true });
    const write = (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput;
    let muted = false;
    (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s: string) => {
      if (!muted) write.call(rl, s);
    };
    rl.question(question, (answer) => {
      rl.close();
      stdout.write("\n");
      resolve(answer);
    });
    muted = true;
  });
}

loadRootEnv();
const username = process.argv[2]?.trim();
if (!username || !/^[a-zA-Z0-9._-]{3,64}$/.test(username)) {
  console.error("Usage: pnpm operator:create <username>   (3-64 chars: letters, digits, . _ -)");
  process.exit(1);
}
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

let password = process.env.FAULTLINE_OPERATOR_PASSWORD ?? "";
if (!password) {
  password = await promptHidden(`Password for ${username}: `);
  const confirm = await promptHidden("Confirm password: ");
  if (password !== confirm) {
    console.error("Passwords do not match.");
    process.exit(1);
  }
}
const problem = validatePasswordStrength(password);
if (problem) {
  console.error(problem);
  process.exit(1);
}

const handle = createDatabase(url, { max: 1, applicationName: "faultline-cli" });
try {
  const passwordHash = await hashPassword(password);
  const [existing] = await handle.db
    .select({ id: operators.id })
    .from(operators)
    .where(eq(sql`lower(${operators.username})`, username.toLowerCase()));
  if (existing) {
    await handle.db.update(operators).set({ passwordHash }).where(eq(operators.id, existing.id));
    console.log(`Password updated for operator "${username}". Existing sessions remain valid until they expire or the operator signs out.`);
  } else {
    await handle.db.insert(operators).values({ username, passwordHash });
    console.log(`Operator "${username}" created.`);
  }
} finally {
  await handle.close();
}
