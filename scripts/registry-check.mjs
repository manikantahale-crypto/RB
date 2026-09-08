/**
 * The check `adapters/README.md` has always promised.
 *
 *   npm run check:registry
 *
 * That file says filenames derive from a node's key mechanically "so
 * `registry:check` can verify a file sits where its key says". No such script
 * existed. CI ran `typecheck:adapters`, which proves the contracts compile and
 * nothing about where they live or whether anything loads them.
 *
 * A convention nobody checks is not a rule — it is a habit, and habits drift.
 * ORBIT's controllers drifted out of `services/orbit/` while that directory
 * already existed, and nothing complained for months.
 *
 * Four things, none of which need a database, so this runs in CI:
 *
 *   1. every `*.node.ts` sits where its key and module say it should
 *   2. no two contracts share a key
 *   3. every contract file is reachable from `adapters/index.ts`
 *   4. everything `adapters/index.ts` lists actually exists
 *
 * Exits 1 on any failure.
 */
import { readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { contractFilePath } from "@tekisho/node-contract";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const adapters = join(root, "adapters");

function nodeFiles(dir = adapters) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...nodeFiles(full));
    else if (entry.endsWith(".node.ts")) out.push(full);
  }
  return out;
}

const problems = [];

/**
 * If `adapters/index.ts` cannot even load, say so plainly and stop. It imports
 * every contract by path, so a file renamed or deleted takes the whole module
 * down — and a stack trace is a worse answer than a sentence naming the cause.
 */
let listed = [];
try {
  const index = await import("../adapters/index.ts");
  listed = [...index.nodeContracts, ...index.declaredNodes];
} catch (err) {
  const msg = err?.message ?? String(err);
  console.log("");
  console.log(`  FAIL  adapters/index.ts does not load: ${msg}`);
  console.log("");
  console.log(
    "        It imports every contract by path, so this is usually a file",
  );
  console.log("        renamed, moved or deleted without updating the list.");
  console.log("");
  process.exit(1);
}
const listedKeys = new Set(listed.map((c) => c.key));

const files = nodeFiles();
const seen = new Map();

for (const file of files) {
  const rel = relative(adapters, file).split("\\").join("/");
  // An absolute Windows path is not a valid ESM specifier — it needs file://
  const mod = await import(pathToFileURL(file).href);

  const contracts = Object.values(mod).filter(
    (v) => v && typeof v === "object" && typeof v.key === "string" && v.module,
  );

  if (contracts.length === 0) {
    problems.push(`${rel} exports no node contract`);
    continue;
  }
  if (contracts.length > 1) {
    problems.push(
      `${rel} exports ${contracts.length} contracts — one node per file`,
    );
  }

  for (const c of contracts) {
    // 1 · does the file sit where the key says?
    const expected = contractFilePath(c);
    if (expected !== rel) {
      problems.push(`${c.key} is in ${rel} but its key says ${expected}`);
    }

    // 2 · is the key unique?
    const prior = seen.get(c.key);
    if (prior) problems.push(`${c.key} is declared twice — ${prior} and ${rel}`);
    else seen.set(c.key, rel);

    // 3 · is anything loading it?
    if (!listedKeys.has(c.key)) {
      problems.push(
        `${c.key} (${rel}) is in no list in adapters/index.ts — nothing loads it, ` +
          `so it is invisible to the registry and to every screen`,
      );
    }
  }
}

// 4 · the other direction: a list naming something that is not there.
for (const c of listed) {
  if (!seen.has(c.key)) {
    problems.push(`adapters/index.ts lists ${c.key}, but no file declares it`);
  }
}

console.log(
  `\nregistry:check — ${files.length} node files, ${listed.length} listed in adapters/index.ts\n`,
);

if (problems.length === 0) {
  console.log("  ok   every contract is where its key says, unique, and loaded.\n");
  process.exitCode = 0;
} else {
  for (const p of problems) console.log(`  FAIL  ${p}`);
  console.log(`\n${problems.length} problem(s).\n`);
  process.exitCode = 1;
}
