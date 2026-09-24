/**
 * The wiring test — does node-api still assemble, and do the boundaries hold?
 *
 * WHY THIS FILE EXISTS
 *
 * `node-api` had no runnable tests. The four files under `tests/` are plain
 * Node scripts using `assert` with no `describe` or `it`, so every vitest run
 * reported four failures that everybody learned to ignore — which is worse than
 * no tests, because a real failure looks the same.
 *
 * So this does not attempt to test matching, scoring or parsing. It tests the
 * two things a restructure can break and nothing else catches:
 *
 *   1. every file still resolves — a moved file with a stale `require` fails at
 *      LOAD time in CommonJS, so loading the app proves the whole graph
 *   2. the module boundaries hold — no application reaching into another
 *
 * The second is the first rule module teams are given: your module never
 * imports another module. A convention nobody checks is not a rule —
 * `adapters/README.md` promised a `registry:check` that was never written until
 * recently, and ORBIT's controllers drifted out of `services/orbit/` while
 * nothing complained.
 *
 * NO DATABASE IS NEEDED. `config/env.js` throws without `DATABASE_URL`, but
 * `config/db.js` builds its Pool lazily and only connects inside a function, so
 * a syntactically valid fake is enough to load the whole application.
 */
import "tsx/cjs";
import { createRequire } from "node:module";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, "src");
const require_ = createRequire(import.meta.url);

process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:5432/test";
process.env.AUTH_JWT_SECRET ??= "test-secret-not-used";

/** Every `.js` file under src, as paths relative to src, with `/` separators. */
function sourceFiles(dir = SRC) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (entry.endsWith(".js")) out.push(full);
  }
  return out;
}

const FILES = sourceFiles();
const known = new Set(FILES.map((f) => resolve(f)));

/** Resolve a relative `require` the way Node does: exact, then `.js` / `.ts`, then `/index.js` / `/index.ts`. */
function resolveRequire(fromFile, spec) {
  const base = resolve(dirname(fromFile), spec);
  for (const candidate of [
    base,
    `${base}.js`,
    `${base}.ts`,
    join(base, "index.js"),
    join(base, "index.ts"),
  ]) {
    if (known.has(candidate) || existsSync(candidate)) return candidate;
  }
  return null;
}

/** Which application a file belongs to, or null for everything else. */
function moduleOf(file) {
  const rel = relative(SRC, file).split("\\").join("/");
  const m = /^modules\/([^/]+)\//.exec(rel);
  return m ? m[1] : null;
}

function localRequires(file) {
  const text = readFileSync(file, "utf8");
  return [...text.matchAll(/require\(["'](\.[^"']+)["']\)/g)].map((m) => m[1]);
}

describe("the application still assembles", () => {
  /**
   * 90s, against a default of 5. This is the only test in the repository that
   * touches the filesystem in anger — it loads the entire application, which
   * pulls in dotenvx, reads several `.env` files and constructs a pg Pool.
   *
   * It runs in under a second normally and timed out twice, both times
   * immediately after a batch of files had been written, which is what an
   * on-access virus scanner does to a cold require graph on Windows.
   *
   * A generous timeout is right here rather than a mask: the assertion is "does
   * every module resolve", and a slow disk is not a broken import. Anything
   * genuinely wrong throws immediately with the missing module named.
   */
  // Raised from 30 s on 2026-09-20: it crossed 30 s twice more in full runs
  // that shared the machine with fifty other files, for the reason above.
  it("loads app.js, and with it every file it reaches", { timeout: 90_000 }, () => {
    // A stale require after a file move throws here, naming the missing module.
    // That is the whole failure mode of a restructure, caught in one line.
    expect(() => require_("./src/app.js")).not.toThrow();
  });

  it("resolves every relative require in the tree", () => {
    // Catches a file that nothing currently loads — a worker registered only in
    // production, say — which the app.js load above would silently miss.
    const broken = [];
    for (const file of FILES) {
      for (const spec of localRequires(file)) {
        if (!resolveRequire(file, spec)) {
          broken.push(`${relative(SRC, file)} -> ${spec}`);
        }
      }
    }
    expect(broken).toEqual([]);
  });
});

describe("module boundaries", () => {
  it("never lets one application import another", () => {
    // The rule that makes a module extractable later, and the one CODEOWNERS
    // depends on: if ORBIT's code is ORBIT's, taking it out is a move rather
    // than an untangling.
    const crossings = [];
    for (const file of FILES) {
      const from = moduleOf(file);
      if (!from) continue;
      for (const spec of localRequires(file)) {
        const target = resolveRequire(file, spec);
        if (!target) continue;
        const to = moduleOf(target);
        if (to && to !== from) {
          crossings.push(`${relative(SRC, file)} -> ${relative(SRC, target)}`);
        }
      }
    }
    expect(crossings).toEqual([]);
  });

  it("keeps the composition root uncomposed", () => {
    // `app.js` and `server.js` may import anything; nothing may import them.
    // A file requiring app.js is a file that has decided to know about every
    // layer at once, which is how a cycle starts.
    const importers = [];
    for (const file of FILES) {
      if (["app.js", "server.js"].includes(relative(SRC, file))) continue;
      for (const spec of localRequires(file)) {
        const target = resolveRequire(file, spec);
        if (!target) continue;
        const name = relative(SRC, target);
        if (name === "app.js" || name === "server.js") {
          importers.push(`${relative(SRC, file)} -> ${name}`);
        }
      }
    }
    expect(importers).toEqual([]);
  });
});
