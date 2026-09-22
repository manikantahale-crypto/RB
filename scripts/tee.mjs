/**
 * Run a command, show its output, and keep a copy on disk.
 *
 *   node scripts/tee.mjs <logfile> <command> [args...]
 *
 * WHY. On 2026-09-22 a fan-out filled the queue with 4,439 jobs and the one
 * line that would have named the caller —
 *
 *     [funnel] resume <resumeId>: pool=… tier1=… tier2_finalists=15
 *
 * — had scrolled out of the console. An hour of database forensics narrowed it
 * to two possible callers and could not choose between them. The log had the
 * answer and the log was gone.
 *
 * `tee` is not on Windows and npm scripts run through cmd.exe, so this is the
 * portable version. It is deliberately thin: it does not parse, colour or
 * filter — whatever the command prints is what lands in the file, ANSI codes
 * and all, so a later `grep` sees exactly what you saw.
 *
 * APPENDS, with a banner per session. History is the point; a log that starts
 * empty each run is a log that has already lost the thing you need. It grows
 * unbounded — `*.log` is gitignored, so delete it whenever it gets big.
 *
 * Signals and the exit code pass straight through, so Ctrl-C still reaches the
 * command and still runs its own graceful shutdown.
 *
 * ONE LIMIT, NAMED. `shell: true` is required for npm's `.cmd` shims on
 * Windows, and it means the shell re-parses the arguments — so an argument
 * containing quotes or spaces will not survive intact. Fine for what this is
 * for (`npm run <script>`); do not use it to pass a quoted `-e` snippet.
 */
import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const [logPath, command, ...args] = process.argv.slice(2);

if (!logPath || !command) {
  console.error("usage: node scripts/tee.mjs <logfile> <command> [args...]");
  process.exit(2);
}

const file = resolve(process.cwd(), logPath);
mkdirSync(dirname(file), { recursive: true });
const log = createWriteStream(file, { flags: "a" });

log.write(
  `\n${"=".repeat(78)}\n` +
    `  ${new Date().toISOString()}  ${command} ${args.join(" ")}\n` +
    `${"=".repeat(78)}\n`,
);

const child = spawn(command, args, {
  // npm and npx are .cmd shims on Windows; spawning them without a shell
  // fails with EINVAL.
  shell: true,
  stdio: ["inherit", "pipe", "pipe"],
});

for (const [stream, out] of [
  [child.stdout, process.stdout],
  [child.stderr, process.stderr],
]) {
  stream.on("data", (chunk) => {
    out.write(chunk);
    log.write(chunk);
  });
}

// Ctrl-C must reach the command, not just this wrapper, or the graceful
// shutdown it was given never runs.
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"]) {
  try {
    process.on(signal, () => child.kill(signal));
  } catch {
    /* not available on this platform */
  }
}

child.on("exit", (code, signal) => {
  log.end(`\n--- exited code=${code} signal=${signal} at ${new Date().toISOString()} ---\n`);
  process.exit(code ?? 1);
});

child.on("error", (err) => {
  console.error(`tee: could not run ${command}: ${err.message}`);
  log.end(`\n--- failed to start: ${err.message} ---\n`);
  process.exit(1);
});
