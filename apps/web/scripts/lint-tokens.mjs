// Fails when a .tsx file under src/ contains a raw hex color. Colors come from src/design/tokens.css only.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("../src/", import.meta.url).pathname;
const HEX = /#[0-9a-fA-F]{3,8}\b/g;
const hits = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (path.endsWith(".tsx")) {
      readFileSync(path, "utf8").split("\n").forEach((line, i) => {
        for (const m of line.matchAll(HEX)) hits.push(`${relative(process.cwd(), path)}:${i + 1}: ${m[0]}`);
      });
    }
  }
}

walk(root);
if (hits.length) {
  console.error(`lint:tokens — raw hex colors found (use tokens from src/design/tokens.css):\n${hits.join("\n")}`);
  process.exit(1);
}
console.log("lint:tokens — no raw hex colors in .tsx files");
