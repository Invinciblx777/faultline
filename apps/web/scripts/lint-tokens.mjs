// Fails when a .tsx file under src/ contains a raw hex color (colors come from src/design/tokens.css only)
// or imports the removed legacy component layer (src/components/ui/*; use src/design/components).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("../src/", import.meta.url).pathname;
const HEX = /#[0-9a-fA-F]{3,8}\b/g;
const LEGACY = /from\s+["']@\/components\/ui\//;
const hits = [];
const legacy = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (path.endsWith(".tsx") || path.endsWith(".ts")) {
      readFileSync(path, "utf8").split("\n").forEach((line, i) => {
        if (path.endsWith(".tsx")) for (const m of line.matchAll(HEX)) hits.push(`${relative(process.cwd(), path)}:${i + 1}: ${m[0]}`);
        if (LEGACY.test(line)) legacy.push(`${relative(process.cwd(), path)}:${i + 1}`);
      });
    }
  }
}

walk(root);
if (legacy.length) {
  console.error(`lint:tokens — legacy imports from @/components/ui (use @/design/components):\n${legacy.join("\n")}`);
}
if (hits.length) {
  console.error(`lint:tokens — raw hex colors found (use tokens from src/design/tokens.css):\n${hits.join("\n")}`);
}
if (hits.length || legacy.length) process.exit(1);
console.log("lint:tokens — no raw hex colors, no legacy component imports");
