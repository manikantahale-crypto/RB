/**
 * THE ROLE BOUNDARY, PROVED AGAINST THE RUNNING SERVICE.
 *
 *   node apps/admin-api/scripts/prove-roles-live.mjs
 *
 * Unit tests prove `adminOnlyRoute` returns the right answer. They cannot
 * prove the hook is registered, that it runs before the route handler, or that
 * the refusal is a 403 with a sentence in it rather than a 500. Only starting
 * the thing proves that, so this starts it.
 *
 * NOTHING IS WRITTEN. Every request names a workflow that does not exist, so
 * the handlers that would write reach their "no such workflow" branch first;
 * the point of each check is the STATUS, and specifically whether it is 403.
 * An operator-allowed route answering 404 has passed — it got past the guard,
 * which is the whole question.
 *
 * The two tokens are signed here with AUTH_JWT_SECRET, the same secret
 * node-api signs with. They are never printed.
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import jwt from "jsonwebtoken";
import "dotenv/config";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const PORT = 4287;
const BASE = `http://127.0.0.1:${PORT}`;
/** A key no workflow has, so every handler takes its "not found" branch. */
const ABSENT = "zz.role-proof.does-not-exist";

const secret = (process.env.AUTH_JWT_SECRET ?? "").trim();
if (!secret) {
  console.error("AUTH_JWT_SECRET is not set — cannot sign a token to prove anything.");
  process.exit(1);
}

const tokenFor = (role) =>
  jwt.sign(
    {
      userId:
        role === "admin"
          ? "11111111-1111-1111-1111-111111111111"
          : "22222222-2222-2222-2222-222222222222",
      email: `${role}@role-proof.invalid`,
      role,
    },
    secret,
    { expiresIn: "5m" },
  );

const TOKENS = { admin: tokenFor("admin"), operator: tokenFor("operator") };

let passed = 0;
const failures = [];

function check(name, ok, detail) {
  if (ok) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failures.push(`${name} — ${detail}`);
    console.log(`  FAIL ${name} — ${detail}`);
  }
}

async function call(role, method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKENS[role]}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return { status: res.status, body: json };
}

/** Wait for the service to answer /health, or give up. */
async function waitForBoot(ms = 40_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

const child = spawn(
  process.execPath,
  [join(root, "node_modules", "tsx", "dist", "cli.mjs"), "apps/admin-api/src/index.ts"],
  {
    cwd: root,
    // Anonymous access OFF, so the tokens are the only way in — which is what
    // production looks like and what the proof is about.
    env: { ...process.env, ADMIN_API_PORT: String(PORT), ADMIN_ALLOW_ANONYMOUS: "" },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
child.stdout.on("data", () => {});
child.stderr.on("data", (d) => {
  const line = String(d);
  if (/Error|error:/.test(line)) process.stderr.write(line);
});

async function main() {
  if (!(await waitForBoot())) throw new Error(`admin-api did not answer on :${PORT}`);
  console.log(`admin-api up on :${PORT}\n`);

  /* ── who am I ────────────────────────────────────────────────────────── */
  console.log("the service reports the role the token carries");
  for (const role of ["admin", "operator"]) {
    const me = await call(role, "GET", "/me");
    check(`/me says ${role}`, me.status === 200 && me.body.role === role,
      `status ${me.status}, role ${me.body?.role}`);
  }
  const me = await call("operator", "GET", "/me");
  check(
    "/me lists the acts it reserves, so the UI need not hard-code them",
    Array.isArray(me.body.adminOnly) && me.body.adminOnly.length > 0,
    JSON.stringify(me.body.adminOnly),
  );

  /* ── refused for an operator ─────────────────────────────────────────── */
  console.log("\nan operator is refused the verbs that change what is running");
  const RESERVED = [
    ["POST", `/workflows/${ABSENT}/approve-go-live`],
    ["POST", `/workflows/${ABSENT}/take-offline`],
    ["POST", `/workflows/${ABSENT}/rollback`],
    ["POST", `/agents/${ABSENT}/activate`],
    ["POST", `/agents/${ABSENT}/go-live`],
    ["POST", `/agents/${ABSENT}/approve-go-live`],
    ["POST", `/agents/${ABSENT}/take-offline`],
    ["POST", `/agents/${ABSENT}/rollback`],
    ["POST", `/plans/${ABSENT}/approve`],
    ["POST", `/plans/${ABSENT}/release`],
    ["POST", "/runtime/threads/resume"],
  ];
  for (const [method, path] of RESERVED) {
    const r = await call("operator", method, path, {});
    check(
      `403 ${method} ${path.replace(ABSENT, "…")}`,
      r.status === 403 && r.body.error === "admin_only",
      `status ${r.status} ${JSON.stringify(r.body).slice(0, 90)}`,
    );
  }

  const refusal = await call("operator", "POST", `/workflows/${ABSENT}/approve-go-live`, {});
  check(
    "the refusal names the act, not the route",
    typeof refusal.body.message === "string" && /admin/i.test(refusal.body.message),
    JSON.stringify(refusal.body),
  );

  /* ── allowed for an operator ─────────────────────────────────────────── */
  console.log("\nan operator may still author, test and ask — no 403 anywhere here");
  const ALLOWED = [
    ["GET", "/workflows"],
    ["GET", "/platform/checks"],
    ["POST", `/workflows/${ABSENT}/draft`],
    ["POST", `/workflows/${ABSENT}/request-go-live`],
    ["POST", `/workflows/${ABSENT}/send-for-approval`],
    ["POST", `/workflows/${ABSENT}/cancel-go-live-request`],
    ["POST", "/node-test"],
    ["POST", "/live-test/fire"],
  ];
  for (const [method, path] of ALLOWED) {
    const r = await call("operator", method, path, method === "GET" ? undefined : {});
    check(
      `role does not refuse ${method} ${path.replace(ABSENT, "…")}`,
      r.body?.error !== "admin_only",
      `status ${r.status} ${JSON.stringify(r.body).slice(0, 90)}`,
    );
  }

  /* ── an admin is not stopped by the role ─────────────────────────────── */
  console.log("\nan admin passes the guard on every reserved verb");
  /**
   * `error !== "admin_only"` rather than `status !== 403`, and the difference
   * is the point. `/plans/:id/approve` answers 403 `approver_unknown` to this
   * admin, because approving a plan records WHO approved it and the token here
   * names a user that does not exist. That is the route's own rule doing its
   * job — a different refusal, for a different reason, and reading it as a
   * failure of the role guard would be reading the wrong thing.
   */
  for (const [method, path] of RESERVED) {
    const r = await call("admin", method, path, {});
    check(
      `role does not refuse ${method} ${path.replace(ABSENT, "…")}`,
      r.body?.error !== "admin_only",
      `status ${r.status} ${JSON.stringify(r.body).slice(0, 90)}`,
    );
  }

  /* ── and nobody at all without a token ───────────────────────────────── */
  console.log("\nand an unsigned caller gets nowhere");
  const anon = await fetch(`${BASE}/workflows`);
  check("401 without a token", anon.status === 401, `status ${anon.status}`);
  const health = await fetch(`${BASE}/health`);
  check("/health stays open for the process manager", health.ok, `status ${health.status}`);
}

main()
  .then(() => {
    console.log(`\n${passed} checks passed, ${failures.length} failed`);
    if (failures.length) for (const f of failures) console.log(`  ${f}`);
    child.kill();
    process.exit(failures.length ? 1 : 0);
  })
  .catch((err) => {
    console.error(`\n${err.message}`);
    child.kill();
    process.exit(1);
  });
