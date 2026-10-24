// Lighthouse accessibility scores for the M3 Expressive screens, signed in as the visual-snapshot
// operator. Run `pnpm test:visual` first: it signs in and records which stored records to open.
//
//   pnpm a11y   (FAULTLINE_VISUAL_URL defaults to http://localhost:3000)
import { readFileSync } from "node:fs";
import { chromium } from "@playwright/test";
import lighthouse from "lighthouse";

const baseURL = process.env.FAULTLINE_VISUAL_URL ?? "http://localhost:3000";
const dir = new URL("../../test-results/visual/", import.meta.url);
const targets = JSON.parse(readFileSync(new URL("targets.json", dir), "utf8"));
const state = JSON.parse(readFileSync(new URL("state.json", dir), "utf8"));
const cookie = state.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
const screens = { design: "/design", ...targets };
const minimum = Number(process.env.FAULTLINE_A11Y_MIN ?? 95);

const port = 9333;
const browser = await chromium.launch({ args: [`--remote-debugging-port=${port}`] });
let failed = 0;
try {
  for (const [name, path] of Object.entries(screens)) {
    const result = await lighthouse(`${baseURL}${path}`, {
      port,
      onlyCategories: ["accessibility"],
      extraHeaders: { Cookie: cookie },
      formFactor: "desktop",
      screenEmulation: { mobile: false, width: 1440, height: 900, deviceScaleFactor: 1, disabled: false },
      logLevel: "error",
    });
    const lhr = result.lhr;
    const score = Math.round((lhr.categories.accessibility.score ?? 0) * 100);
    const issues = Object.values(lhr.audits)
      .filter((a) => a.score === 0 && a.scoreDisplayMode === "binary")
      .map((a) => a.id);
    if (score < minimum) failed++;
    console.log(`${score >= minimum ? "PASS" : "FAIL"}  ${String(score).padStart(3)}  ${name.padEnd(16)} ${lhr.finalDisplayedUrl.replace(baseURL, "")}${issues.length ? `  failing: ${issues.join(", ")}` : ""}`);
  }
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
