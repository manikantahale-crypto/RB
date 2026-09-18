/**
 * Refuse to start a second copy of the stack.
 *
 * WHY THIS EXISTS, AND IT IS NOT HYPOTHETICAL.
 *
 * Two workers were running for eight hours. Both relay the outbox, both claim
 * rows with `FOR UPDATE SKIP LOCKED`, so each event went to whichever grabbed
 * it first — and the older one predated that day's changes. The result was a
 * stack that worked for one event and not the next, with no code difference
 * to explain it. An evening went into finding that.
 *
 * The same shape has bitten before: twenty-one orphaned `tsx watch` processes
 * fighting over port 4200, which made a health check pass against a server
 * nobody was editing.
 *
 * A port clash announces itself. A SECOND WORKER DOES NOT — it has no port to
 * collide on, so nothing notices and the only symptom is intermittence. That
 * is the case this check is really for.
 *
 * Run: node scripts/dev-preflight.mjs
 */
import { createConnection } from "node:net";
import { execFileSync } from "node:child_process";

/** Each service and the port it must have — no drifting to the next one free. */
const PORTS = [
  { port: 4000, what: "SYNTRA api", script: "dev:syntra-api" },
  { port: 3005, what: "RELAY smart inbox", script: "dev:relay" },
  { port: 4100, what: "orchestrator ingress", script: "dev:orch-api" },
  { port: 4200, what: "authoring api", script: "dev:admin-api" },
  { port: 5173, what: "authoring ui", script: "dev:admin-ui" },
];

/** Is something already listening? Resolves true when the port is taken. */
function inUse(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host: "127.0.0.1" });
    const done = (answer) => {
      socket.destroy();
      resolve(answer);
    };
    socket.setTimeout(700);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

/**
 * Workers already running — one entry per worker, not per process.
 *
 * ONE WORKER IS SEVERAL PROCESSES. `npm run dev:worker` spawns an npm wrapper,
 * another for the workspace script, tsx's `cli.mjs`, and tsx's own
 * `--require preflight` child — and more than one of those carries
 * `bootstrap-pgboss.ts` in its command line.
 *
 * Counting matches therefore reported two workers for one, every single time.
 * A guard that cries wolf gets ignored, and then it is not trusted on the day
 * two really are running — which is the day it was written for.
 *
 * So keep only the ROOTS: a match whose parent is also a match belongs to the
 * same worker rather than being another one.
 *
 * Windows-only, and best effort: a check that cannot see reports nothing
 * rather than blocking a start it has no evidence against. The ports above are
 * the portable half.
 */
function runningWorkers() {
  if (process.platform !== "win32") return [];
  try {
    const out = execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | " +
          "Where-Object { $_.CommandLine -match 'bootstrap-pgboss' } | " +
          "ForEach-Object { \"$($_.ProcessId)|$($_.ParentProcessId)|$($_.CreationDate)\" }",
      ],
      { encoding: "utf8", timeout: 10_000 },
    );
    const rows = out
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const [pid, parent, started] = l.split("|");
        return { pid, parent, started };
      });
    const pids = new Set(rows.map((r) => r.pid));
    return rows
      .filter((r) => !pids.has(r.parent))
      .map((r) => `pid ${r.pid}, started ${r.started}`);
  } catch {
    return [];
  }
}

const taken = [];
for (const p of PORTS) if (await inUse(p.port)) taken.push(p);
const workers = runningWorkers();

if (taken.length === 0 && workers.length === 0) {
  console.log("preflight — 4 ports free, no worker running. Starting.\n");
  process.exit(0);
}

console.error("\npreflight — something from a previous run is still up.\n");

for (const p of taken) {
  console.error(`  :${p.port} is taken — ${p.what} (${p.script})`);
}
for (const w of workers) {
  console.error(`  worker already running — ${w}`);
}

console.error(
  "\nTwo workers is the bad one: both drain the outbox, so events go to " +
    "whichever claims them first,\nand an older one runs the code it was " +
    "started with. Nothing collides and nothing warns.\n" +
    "\nStop everything from this repo, then start again:\n\n" +
    "  Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" |\n" +
    "    Where-Object { $_.CommandLine -match 'Bench-Sales' } |\n" +
    "    ForEach-Object { Stop-Process -Id $_.ProcessId -Force }\n",
);
process.exit(1);
