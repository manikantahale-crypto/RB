/**
 * Screen 4 — TEST THIS NODE.
 *
 * Runs ONE node against the real services, exactly as production would, and
 * hands back what it returned.
 *
 * HOW CLOSE IS THIS TO PRODUCTION?
 * The same contract object, the same `run` function, the same Zod schemas for
 * input, config and output. The production bridge (`from-contract.ts`) does
 * that sequence and then throws the output away, keeping a summary string for
 * the graph state — so this repeats the sequence rather than calling it, to
 * keep the output. There is no second implementation of a node anywhere.
 *
 * WHY IT CANNOT JUST RUN AGAINST REAL RECORDS.
 * These nodes write. `syntra.jd.process` replaces a requirement's parsed
 * content; `syntra.resume.process` overwrites a candidate's name, email and
 * visa status. There is no separate dev database — node-api and Supabase are
 * the live ones. So the test PROVISIONS its own throwaway records, runs against
 * those, and deletes them afterwards in a `finally`. Nothing a person has
 * touched is read or written.
 *
 * WHAT IS PROVISIONED IS DERIVED, NOT HARD-CODED.
 * The contract declares what the node takes. A node asking for `jobId` gets a
 * scratch job; one asking for `resumeId` gets a scratch candidate and resume.
 * Add a node tomorrow and this works for it, provided it asks for things this
 * knows how to fabricate.
 *
 * NOT TESTABLE HERE: `external` and `financial` nodes. Something leaves the
 * building, and a test that emails a client is not a test.
 */
import type { Pool, PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { nodeContracts as contractNodes } from "../../../../adapters/index.js";

type FastifyLike = { post: (path: string, handler: any) => void };

type AnyContract = (typeof contractNodes)[number];

const SCRATCH_MARK = "ZZ_NODE_TEST — delete me";

const SCRATCH_JD = `Job Description — Node Test (SYNTHETIC, NOT A REAL REQUIREMENT)
About the role: We are seeking a senior backend engineer for the platform team.
Key Responsibilities: design REST APIs in Node.js and TypeScript; own PostgreSQL schema design.
Required Qualifications: 6+ years backend; strong Node.js, TypeScript, PostgreSQL.
Employment type: Contract. Location: Remote (US).`;

const SCRATCH_RESUME = `NODE TEST — SYNTHETIC RESUME, NOT A REAL PERSON
Jordan Fixture
jordan.fixture@example.invalid | (555) 010-0100 | Remote, US
Professional Summary: Backend engineer with 8 years building Node.js and TypeScript services.
Technical Skills: Node.js, TypeScript, PostgreSQL, REST APIs, Docker.
Professional Experience: Senior Backend Engineer, Example Corp (2019-present).
Education: B.S. Computer Science. Work Authorization: US Citizen.`;

/** What a node's declared input says it needs us to fabricate. */
type Needs = { job: boolean; resume: boolean; candidate: boolean };

function needsOf(contract: AnyContract): Needs {
  /**
   * Read the declared input as JSON Schema rather than poking at Zod's
   * internals. Several node inputs are `.refine()`-wrapped — "needs jobId OR
   * requirement_id" — which have no plain `.shape`, and reaching for one threw.
   * This is the same call the registry materializer makes.
   */
  let props: string[] = [];
  try {
    const schema = z.toJSONSchema(contract.input as any) as {
      properties?: Record<string, unknown>;
    };
    props = Object.keys(schema.properties ?? {});
  } catch {
    props = [];
  }
  const has = (...names: string[]) => names.some((n) => props.includes(n));
  const resume = has("resumeId", "resume_id", "document_id", "documentId");
  return {
    job: has("jobId", "requirement_id"),
    resume,
    // A resume row requires a candidate — it is a NOT NULL foreign key.
    candidate: resume || has("candidateId", "candidate_id"),
  };
}

type Scratch = {
  jobId?: string;
  resumeId?: string;
  candidateId?: string;
};

async function provision(
  client: PoolClient,
  needs: Needs,
  orgId: string,
): Promise<Scratch> {
  const out: Scratch = {};
  if (needs.candidate) {
    const r = await client.query(
      // core, not syntra. The nodes under test read core; a fixture in the
      // legacy shim would be invisible to the very thing it is provisioning
      // for. org_id is derived on insert by app.core_org_from_creator.
      `INSERT INTO core.people (org_id, full_name, email, created_by)
       VALUES ($2::uuid, $1, 'jordan.fixture@example.invalid', NULL)
       RETURNING id::text`,
      [`${SCRATCH_MARK} Jordan Fixture`, orgId],
    );
    out.candidateId = r.rows[0].id;
  }
  if (needs.resume && out.candidateId) {
    const r = await client.query(
      // The file columns went to core.source_files; a resume row is the
      // parsed profile, not the document.
      `INSERT INTO core.resumes (org_id, person_id, summary)
       VALUES ($3::uuid, $1, $2) RETURNING id::text`,
      [out.candidateId, SCRATCH_RESUME, orgId],
    );
    out.resumeId = r.rows[0].id;
  }
  if (needs.job) {
    const r = await client.query(
      `INSERT INTO core.requirements (org_id, title, summary, created_by)
       VALUES ($3::uuid, $1, $2, NULL) RETURNING id::text`,
      [SCRATCH_MARK, SCRATCH_JD, orgId],
    );
    out.jobId = r.rows[0].id;
  }
  return out;
}

/**
 * Deletes everything provisioned, plus anything the run hung off it.
 *
 * Both copies. A fixture is written to `core`, and the mirror in
 * V20260909.27 puts a copy in the legacy shim -- but that mirror is AFTER
 * INSERT OR UPDATE and has no DELETE, so removing the core row on its own
 * would leave the shim copy behind for ever. A scratch row that does not go
 * away is not scratch.
 *
 * Children before parents, or the foreign keys refuse the order.
 */
async function cleanup(client: PoolClient, s: Scratch): Promise<string[]> {
  const removed: string[] = [];
  const ids = [s.jobId, s.resumeId, s.candidateId].filter(Boolean) as string[];
  if (ids.length === 0) return removed;

  const count = (label: string, n: number | null) => {
    if (n) removed.push(`${label}:${n}`);
  };

  const ml = await client.query(
    `DELETE FROM syntra.scoring_log
      WHERE job_id::text = ANY($1) OR resume_id::text = ANY($1)
         OR candidate_id::text = ANY($1)`,
    [ids],
  );
  count("scoring_log", ml.rowCount);

  const ob = await client.query(
    `DELETE FROM orch.event_outbox
      WHERE occurred_at > now() - interval '10 minutes'
        AND (${ids.map((_, i) => `payload_ref::text LIKE '%'||$${i + 1}||'%'`).join(" OR ")})`,
    ids,
  );
  count("event_outbox", ob.rowCount);

  for (const [label, table, cols] of [
    ["matches", "core.matches", ["requirement_id", "person_id", "resume_id"]],
    ["matches", "syntra.matches", ["job_id", "candidate_id", "resume_id"]],
  ] as Array<[string, string, string[]]>) {
    const where = cols.map((c) => `${c}::text = ANY($1)`).join(" OR ");
    const r = await client.query(`DELETE FROM ${table} WHERE ${where}`, [ids]);
    count(label, r.rowCount);
  }

  if (s.resumeId) {
    for (const table of ["core.resumes", "syntra.resumes"]) {
      const r = await client.query(`DELETE FROM ${table} WHERE id = $1`, [s.resumeId]);
      count("resumes", r.rowCount);
    }
  }
  if (s.jobId) {
    for (const table of ["core.requirements", "syntra.jobs"]) {
      const r = await client.query(`DELETE FROM ${table} WHERE id = $1`, [s.jobId]);
      count("jobs", r.rowCount);
    }
  }
  if (s.candidateId) {
    for (const table of ["core.people", "syntra.candidates"]) {
      const r = await client.query(`DELETE FROM ${table} WHERE id = $1`, [s.candidateId]);
      count("candidates", r.rowCount);
    }
  }
  return removed;
}

function issuesOf(err: unknown): Array<{ path: string; message: string }> {
  const issues = (err as { issues?: Array<{ path: unknown[]; message: string }> })
    ?.issues;
  return Array.isArray(issues)
    ? issues.map((i) => ({ path: i.path.join(".") || "(root)", message: i.message }))
    : [];
}

export function registerNodeTestRoutes(app: FastifyLike, pool: Pool): void {
  /**
   * POST /node-test
   * { nodeKey, config, input? }
   *
   * `input` is optional — without it the node is run against freshly created
   * scratch records, which is the common case. With it, the given values win,
   * so a fixture or a previous run's input can be replayed.
   */
  app.post("/node-test", async (req: any, reply: any) => {
    const body = req.body ?? {};
    const nodeKey = String(body.nodeKey ?? "");
    const config = (body.config ?? {}) as Record<string, unknown>;
    const givenInput = (body.input ?? null) as Record<string, unknown> | null;

    const contract = contractNodes.find((c) => c.key === nodeKey);
    if (!contract) {
      return reply.code(404).send({
        error: "no_contract",
        message: `${nodeKey} has no contract, so there is nothing to run here. Only declared nodes can be tested.`,
      });
    }
    if (contract.sideEffect === "external" || contract.sideEffect === "financial") {
      return reply.code(422).send({
        error: "not_testable",
        message: `${nodeKey} is declared "${contract.sideEffect}" — something leaves the building. A test that reaches a real person is not a test.`,
      });
    }

    const started = Date.now();
    const client = await pool.connect();
    let scratch: Scratch = {};
    let removed: string[] = [];

    try {
      const needs = needsOf(contract);

      /**
       * A real organisation. `core.people` and `core.requirements` have a
       * foreign key onto platform.organizations, so the header's value is used
       * only if it names one that exists -- the route's own fallback is a
       * random uuid, which would be rejected.
       */
      const { rows: orgRows } = await client.query<{ id: string }>(
        `SELECT id::text AS id FROM platform.organizations
          WHERE id = $1::uuid
          UNION ALL
         SELECT id::text FROM platform.organizations ORDER BY 1 LIMIT 1`,
        [String(req.headers["x-org-id"] ?? "00000000-0000-0000-0000-000000000000")],
      );
      if (!orgRows[0]) {
        return reply.code(500).send({
          error: "no_organisation",
          message: "A node test provisions rows that must belong to an organisation, and there are none.",
        });
      }

      scratch = await provision(client, needs, orgRows[0].id);

      // Scratch ids under every name the node might ask for; anything the
      // caller supplied wins, so a replayed input is used as given.
      const built: Record<string, unknown> = {};
      if (scratch.jobId) {
        built.jobId = scratch.jobId;
        built.requirement_id = scratch.jobId;
      }
      if (scratch.resumeId) built.resumeId = scratch.resumeId;
      if (scratch.candidateId) built.candidateId = scratch.candidateId;
      const input = { ...built, ...(givenInput ?? {}) };

      // Same schemas the runtime enforces, in the same order.
      const parsedInput = (contract.input as any).safeParse(input);
      if (!parsedInput.success) {
        return {
          ok: false,
          stage: "input",
          nodeKey,
          input,
          issues: issuesOf(parsedInput.error),
          ms: Date.now() - started,
          scratch,
        };
      }
      const parsedConfig = (contract.config as any).safeParse(config);
      if (!parsedConfig.success) {
        return {
          ok: false,
          stage: "config",
          nodeKey,
          issues: issuesOf(parsedConfig.error),
          ms: Date.now() - started,
          scratch,
        };
      }

      // Events are COLLECTED, never published. A test must not put a fact into
      // the outbox that a worker would later act on.
      const emitted: Array<{ event_type: string; payload: unknown }> = [];
      const logs: string[] = [];
      const ctx = {
        orgId: String(req.headers["x-org-id"] ?? randomUUID()),
        logger: {
          info: (...args: unknown[]) => logs.push(args.map(String).join(" ")),
          error: (...args: unknown[]) => logs.push(args.map(String).join(" ")),
        },
        emit: (e: { event_type: string; payload: Record<string, unknown> }) =>
          emitted.push(e),
      };

      let raw: unknown;
      try {
        raw = await (contract.run as any)(ctx, parsedInput.data, parsedConfig.data);
      } catch (err) {
        return {
          ok: false,
          stage: "run",
          nodeKey,
          input: parsedInput.data,
          error: err instanceof Error ? err.message : String(err),
          errorClass: (contract.execution as any)?.classifyError?.(err) ?? null,
          ms: Date.now() - started,
          logs,
          scratch,
        };
      }

      const parsedOutput = (contract.output as any).safeParse(raw);
      return {
        ok: parsedOutput.success,
        stage: parsedOutput.success ? "done" : "output",
        nodeKey,
        input: parsedInput.data,
        config: parsedConfig.data,
        output: raw,
        schemaOk: parsedOutput.success,
        issues: parsedOutput.success ? [] : issuesOf(parsedOutput.error),
        emitted,
        logs,
        ms: Date.now() - started,
        scratch,
      };
    } catch (err) {
      req.log?.error?.(err);
      return reply
        .code(500)
        .send({ error: "node_test_failed", message: String(err) });
    } finally {
      // Runs whatever happened above — a thrown node must not leave rows behind.
      try {
        removed = await cleanup(client, scratch);
      } catch (err) {
        req.log?.error?.({ msg: "node-test cleanup failed", err, scratch });
      }
      client.release();
      if (removed.length) {
        req.log?.info?.(`[node-test] cleaned up ${removed.join(" ")}`);
      }
    }
  });
}
