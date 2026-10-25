#!/usr/bin/env node
// Records the 4-beat demo video (Break, Understand, Fix, Prove) from a running FAULTLINE web app
// and its stored records. Every product scene is a real page; title cards come from
// docs/demo/card.html. Nothing is scanned or approved while recording.
//
//   node scripts/record-demo.mjs            # writes docs/demo/faultline-demo-video.webm
//
// Needs: `pnpm start:web` on :3000 (FAULTLINE_DEMO_URL to change it), the database the demo
// runbook points at, and Chromium from Playwright. The record IDs come from the tab table in
// DEMO_RUNBOOK.md (tabs B to E), which `pnpm demo:preflight` prints from the database.
// Sign-in happens in a separate, unrecorded context as the local `visual-snapshots` operator,
// whose password is reset to a random value per run through `pnpm operator:create`.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { chromium } = await import(pathToFileURL(join(root, "apps/web/node_modules/@playwright/test/index.mjs")).href);

const base = process.env.FAULTLINE_DEMO_URL ?? "http://localhost:3000";
const W = 1440;
const H = 900;
const out = join(root, "docs/demo");
const card = pathToFileURL(join(out, "card.html")).href;

// Record IDs from the runbook tab table.
const runbook = readFileSync(join(root, "DEMO_RUNBOOK.md"), "utf8");
const tab = (letter) => runbook.match(new RegExp(`\\|\\s*${letter}\\s*\\|\\s*(\\S+)\\s*\\|`))?.[1];
const tabs = { B: tab("B"), C: tab("C"), D: tab("D"), E: tab("E") };
for (const [k, v] of Object.entries(tabs)) if (!v) throw new Error(`DEMO_RUNBOOK.md has no tab ${k}`);
const path = (url) => new URL(url).pathname;

// Unrecorded sign-in.
const USERNAME = "visual-snapshots";
const password = randomBytes(18).toString("base64url");
const created = spawnSync("pnpm", ["-s", "operator:create", USERNAME], { cwd: root, env: { ...process.env, FAULTLINE_OPERATOR_PASSWORD: password }, encoding: "utf8" });
if (created.status !== 0) throw new Error(`operator:create failed: ${created.stderr || created.stdout}`);
const browser = await chromium.launch();
const login = await browser.newContext({ baseURL: base });
const lp = await login.newPage();
await lp.goto("/login");
await lp.getByLabel("Username").fill(USERNAME);
await lp.getByLabel("Password").fill(password);
await lp.getByRole("button", { name: "Sign in" }).click();
await lp.waitForURL((u) => !u.pathname.startsWith("/login"));
const storageState = await login.storageState();
await login.close();

const videoDir = join(out, ".recording");
mkdirSync(videoDir, { recursive: true });
const ctx = await browser.newContext({
  baseURL: base,
  storageState,
  viewport: { width: W, height: H },
  deviceScaleFactor: 1,
  colorScheme: "dark",
  reducedMotion: "no-preference",
  recordVideo: { dir: videoDir, size: { width: W, height: H } },
});
await ctx.addCookies([{ name: "faultline_theme", value: "dark", url: base }]);
const page = await ctx.newPage();
const t0 = Date.now();
const marks = [];
const mark = (scene, what) => marks.push({ at: (Date.now() - t0) / 1000, scene, what });
const wait = (s) => page.waitForTimeout(s * 1000);
const pace = () => wait(0.3);

async function caption(beat, text) {
  await page.evaluate(
    ([b, t]) => {
      let el = document.getElementById("__cap");
      if (!el) {
        el = document.createElement("div");
        el.id = "__cap";
        el.style.cssText =
          "position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:2147483647;max-width:1120px;padding:14px 22px;border-radius:16px;background:rgba(38,30,25,.96);color:#efe0d7;font:600 21px/1.35 'Manrope Variable',system-ui,sans-serif;text-align:center;pointer-events:none;display:flex;gap:14px;align-items:center";
        document.body.appendChild(el);
      }
      el.innerHTML = "";
      const chip = document.createElement("span");
      chip.textContent = b;
      chip.style.cssText = "padding:4px 12px;border-radius:999px;background:#634000;color:#ffddb5;font-size:14px;letter-spacing:.12em;white-space:nowrap";
      const body = document.createElement("span");
      body.textContent = t;
      el.append(chip, body);
    },
    [beat, text],
  );
}
async function showCard(beat, text, meta, seconds) {
  const hash = new URLSearchParams({ beat, caption: text, meta: meta ?? "" }).toString();
  await page.goto(`${card}#${hash}`);
  await wait(seconds);
}
async function go(url) {
  await page.goto(url, { waitUntil: "load" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await wait(0.6);
}
async function scrollTo(selector, block = "start") {
  await page.evaluate(([s, b]) => document.querySelector(s)?.scrollIntoView({ behavior: "smooth", block: b }), [selector, block]);
  await wait(1.2);
}
const scrollBy = async (y) => {
  await page.evaluate((dy) => window.scrollBy({ top: dy, behavior: "smooth" }), y);
  await wait(1.1);
};

// 1. Title card.
mark("Title card", "card.html");
await showCard("FAULTLINE", "Break it. Understand it. Fix it. Prove it.", "Devin Hacks Kochi · Track 2", 8);

// 2. BREAK.
mark("BREAK", `${path(tabs.B)}: Blast Radius of the stored reference-shop analysis`);
await go(path(tabs.B));
const hero = (await page.getByText(/experiments? breaks? the journey/).first().textContent())?.trim();
await caption("BREAK", `Real checkout journey in Chromium, one dependency broken at a time. ${hero}.`);
await wait(9);
await scrollTo("#journey-strip-title");
const inventory = page.getByRole("button", { name: /GET \/api\/inventory: BROKEN/ });
await inventory.scrollIntoViewIfNeeded();
await pace();
await inventory.hover();
await caption("BREAK", "One 503 from GET /api/inventory takes down the rest of checkout.");
await wait(3.5);
await inventory.click();
await caption("BREAK", "The finding: affected steps, reasons, reproduced in a second run.");
await wait(4);
await page.getByRole("complementary", { name: "Experiment details" }).getByText("Affected steps").scrollIntoViewIfNeeded().catch(() => {});
await wait(4);
await page.keyboard.press("Escape");
await pace();
mark("BREAK", `${path(tabs.C)}: Blast Radius of the stored real-app analysis (scan only)`);
await go(path(tabs.C));
await caption("BREAK", "A live client store, scan only. Same engine, real production site.");
await wait(4);
const note = page.getByText(/localhost:8081/).first();
await note.scrollIntoViewIfNeeded();
await wait(0.8);
await caption("BREAK", "Its visitors' browsers call http://localhost:8081: a development endpoint shipped to production.");
await wait(6);

// 3. UNDERSTAND.
mark("UNDERSTAND", `${path(tabs.D)}: experiment evidence, Reality Split, timeline, regression test`);
await go(path(tabs.D));
await caption("UNDERSTAND", "BROKEN, reproduced in a second run. Every reason comes from a recorded execution.");
await wait(4);
await scrollTo('[aria-labelledby="split-title"]');
await caption("UNDERSTAND", "Reality Split: the normal run and the run with inventory failing.");
const seam = page.getByRole("radio", { name: "Seam" });
if (await seam.count()) await seam.click();
await wait(1);
const slider = page.getByRole("slider", { name: "Reveal normal or fault screenshot" });
const box = await slider.boundingBox();
if (box) {
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * 0.5, y);
  await page.mouse.down();
  for (const f of [0.35, 0.2, 0.1, 0.3, 0.55, 0.8, 0.9, 0.7, 0.5]) {
    await page.mouse.move(box.x + box.width * f, y, { steps: 12 });
    await wait(0.35);
  }
  await page.mouse.up();
}
await wait(2);
await scrollTo('[aria-labelledby="timeline-title"]');
await caption("UNDERSTAND", "The causal timeline: fault injected, request failed, console error, assertion failed.");
await wait(3);
await scrollBy(320);
await wait(3);
await scrollTo('[aria-labelledby="test-title"]');
await page.getByText("View source").click();
await wait(0.8);
await caption("UNDERSTAND", "A generated Playwright test that fails today. The test is the contract for the fix.");
await wait(3);
await scrollBy(380);
await wait(5);

// 4. FIX.
mark("FIX", `${path(tabs.E)}: repair record, approval row, Devin session and PR links (persisted)`);
await go(path(tabs.E));
const mainText = await page.locator("main").innerText();
const approved = mainText.match(/Approved by\s*\n?\s*([^\n]+)/)?.[1]?.trim();
const sessionHref = await page.locator('a[href*="devin.ai/sessions/"]').first().getAttribute("href").catch(() => null);
const session = sessionHref?.split("/sessions/")[1];
await caption("FIX", "A human approved checksum-locked evidence. FAULTLINE opened one Devin session.");
await wait(5);
const approvedRow = page.getByText("Approved by").first();
if (await approvedRow.count()) {
  await approvedRow.scrollIntoViewIfNeeded();
  await wait(0.6);
  await caption("FIX", `Approved by a human click${approved ? `: ${approved}` : ""}. Nothing is approved on camera.`);
  await wait(5);
}
const devinCard = page.getByText("Devin session").first();
if (await devinCard.count()) {
  await devinCard.scrollIntoViewIfNeeded();
  await wait(0.6);
  await caption("FIX", `Devin session ${session ? session.slice(0, 8) : ""} opened PR #1 on the reference shop (repo private until release).`);
  await wait(6);
}

// 5. PROVE.
mark("PROVE", `${path(tabs.E)}: verification verdicts, numerals, screenshots, cross-check`);
await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
await wait(1.2);
await caption("PROVE", "FAULTLINE re-ran its own unchanged test on Devin's exact commit, in a container with no network.");
await wait(6);
await scrollTo('[aria-labelledby="verify-title"]');
await caption("PROVE", "Under the identical injected fault: original fails 2 of 2, Devin's commit passes 2 of 2. VERIFIED FIXED.");
await wait(6);
await scrollBy(560);
await caption("PROVE", "Before and after screenshots under the same fault. The verdict is posted on the PR; FAULTLINE never merges.");
await wait(7);
const limitation = page.getByText(/Agent-stated limitation/).first();
if (await limitation.count()) {
  await limitation.scrollIntoViewIfNeeded();
  await wait(0.8);
  await caption("PROVE", "The agent's own stated limitation, quoted from the pull request. FAULTLINE tests it next.");
  await wait(7);
}
await scrollTo('[aria-labelledby="cross-title"]');
await caption("PROVE", "Cross-check, stricter journey v2: can an out-of-stock item still be bought while inventory is down?");
await wait(5);
await scrollBy(360);
await caption("PROVE", "STILL FAILING. Devin said fixed. FAULTLINE proved it, and found the hole.");
await wait(9);

// 6. Closing card.
mark("Closing card", "card.html");
await showCard("PROVE", "AI can write the fix. FAULTLINE proves whether it works.", "github.com/Invinciblx777/faultline", 10);

const seconds = (Date.now() - t0) / 1000;
const video = page.video();
await ctx.close();
const recorded = await video.path();
const dest = join(out, "faultline-demo-video.webm");
copyFileSync(recorded, dest);
await browser.close();
console.log(JSON.stringify({ seconds: Number(seconds.toFixed(1)), bytes: statSync(dest).size, dest, marks }, null, 2));
