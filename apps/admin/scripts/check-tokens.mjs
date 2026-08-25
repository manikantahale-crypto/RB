/**
 * Fail when a raw colour appears outside tokens.css.
 *
 * Without this the token system decays one hurry at a time: someone drops a
 * `#fff` into a component, nothing complains, and six months later a designer
 * edits one file and the app comes back half-restyled. That half-restyled
 * result is worse than no token system, because it looks like the file does
 * not work.
 *
 * tokens.css is the one place raw values are allowed — that is its job.
 *
 * Run: npm run check:tokens -w @tekisho/admin
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("../src", import.meta.url));
const ALLOWED = new Set(["tokens.css"]);

/** #fff, #ffffff, #ffffffff */
const HEX = /#[0-9a-fA-F]{3,8}\b/g;
/** rgb(...) / rgba(...) / hsl(...) with numeric arguments */
const FUNC = /\b(?:rgba?|hsla?)\(\s*[\d.]/g;

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(css|tsx?|jsx?)$/.test(entry)) out.push(full);
  }
  return out;
}

const problems = [];
for (const file of walk(SRC)) {
  const name = file.split(/[\\/]/).pop();
  if (ALLOWED.has(name)) continue;
  const text = readFileSync(file, "utf8");
  text.split("\n").forEach((line, i) => {
    // A fallback inside token(...) is deliberate — it is what renders if the
    // stylesheet has not loaded, and it names its token right there.
    if (/token\(\s*"--/.test(line)) return;
    for (const re of [HEX, FUNC]) {
      re.lastIndex = 0;
      const hit = re.exec(line);
      if (hit) {
        problems.push(
          `${relative(SRC, file)}:${i + 1}  ${hit[0]}  ->  use a token from tokens.css`,
        );
        break;
      }
    }
  });
}

if (problems.length) {
  console.error(`\nRaw colours found outside tokens.css (${problems.length}):\n`);
  for (const p of problems) console.error("  " + p);
  console.error(
    "\nAdd a token to src/tokens.css and reference it with var(--name).\n" +
      "For a library that needs a resolved string (mermaid, SVG attributes),\n" +
      "use token(\"--name\", \"#fallback\") from src/lib/tokens.ts.\n",
  );
  process.exit(1);
}

console.log("check:tokens — no raw colours outside tokens.css");
