/**
 * Fail when a screen's stylesheet grows classes that belong to another screen.
 *
 * WHY THIS EXISTS. `styles/editor.css` was one file holding screens 2, 3 and 4.
 * That was fine while one person wrote all three. The moment those screens had
 * three owners, every one of them had that file open, and a stylesheet is the
 * most annoying merge conflict there is: nothing is broken, the diff is
 * enormous, and resolving it means re-reading rules you did not write.
 *
 * Splitting it only helps if it stays split. Without this check the first
 * person in a hurry adds a `.nw-` rule to the graph editor's file — nothing
 * complains — and a month later the files are shuffled back together and
 * nobody can tell which screen owns what.
 *
 * Same argument as check-tokens.mjs, which is next door.
 *
 * ADDING A SCREEN: create `styles/<screen>.css`, add it to OWNS below, and
 * import it from main.tsx. Three lines, and the guard covers you from then on.
 *
 * Run: npm run check:styles -w @tekisho/admin
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const STYLES = fileURLToPath(new URL("../src/styles", import.meta.url));

/**
 * Which class prefixes each screen's stylesheet may define.
 *
 * `ge` is the graph editor and `nt` is the node-test panel inside it — one
 * screen, one owner, two components, so they share a file on purpose.
 */
const OWNS = {
  "graph-editor.css": ["ge", "nt"],
  "event-catalog.css": ["ec"],
  "new-workflow.css": ["nw"],
  "live-test.css": ["lt"],
  "platform-health.css": ["ph"],
};

/**
 * The first class in a top-level selector. `.ge-node--on`, `.nt-head .rd-h`
 * and `.nw-row:hover` all answer with their own prefix, which is the one that
 * says who owns the rule; a descendant from another screen is a legitimate
 * thing to style against and is not what this is looking for.
 */
function prefixesIn(css) {
  const found = new Map();
  // Strip comments so a class named in prose is not mistaken for a rule.
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const line of bare.split("\n")) {
    const m = /^\s*\.([a-z][a-z0-9]*)[-\s.:,{[]/.exec(line);
    if (!m) continue;
    const prefix = m[1];
    if (!found.has(prefix)) found.set(prefix, line.trim());
  }
  return found;
}

const files = readdirSync(STYLES).filter((f) => f.endsWith(".css"));
const problems = [];

for (const file of files) {
  const owned = OWNS[file];
  if (!owned) {
    problems.push(
      `${file} — not listed in OWNS. Add its prefixes to ` +
        `apps/admin/scripts/check-styles.mjs so the split stays enforced.`,
    );
    continue;
  }
  const css = readFileSync(join(STYLES, file), "utf8");
  for (const [prefix, example] of prefixesIn(css)) {
    if (owned.includes(prefix)) continue;
    const home = Object.entries(OWNS).find(([, p]) => p.includes(prefix));
    problems.push(
      `${file} defines .${prefix}-* — ${example}\n    ` +
        (home
          ? `that belongs in ${home[0]}.`
          : `no stylesheet owns .${prefix}-*. Give the screen its own file.`),
    );
  }
}

for (const file of Object.keys(OWNS)) {
  if (!files.includes(file)) {
    problems.push(`${file} is listed in OWNS but does not exist.`);
  }
}

if (problems.length > 0) {
  console.error("check:styles — a screen's classes are in the wrong file\n");
  for (const p of problems) console.error(`  ${p}\n`);
  process.exit(1);
}

console.error(
  `check:styles — ${files.length} screen stylesheets, each holding only its own classes`,
);
