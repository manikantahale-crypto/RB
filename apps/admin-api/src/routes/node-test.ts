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

async function provision(client: PoolClient, needs: Needs): Promise<Scratch> {
  const out: Scratch = {};
  if (needs.candidate) {
    const r = await client.query(
      `INSERT INTO syntra.candidates (full_name, email, created_by)
       VALUES ($1, 'jordan.fixture@example.invalid', NULL) RETURNING id::text`,
      [`${SCRATCH_MARK} Jordan Fixture`],
    );
    out.candidateId = r.rows[0].id;
  }
  if (needs.resume && out.candidateId) {
    const r = await client.query(
      `INSERT INTO syntra.resumes (candidate_id, original_file_name, file_path, raw_text)
       VALUES ($1, 'node-test-resume.txt', './uploads/node-test-resume.txt', $2)
       RETURNING id::text`,
      [out.candidateId, SCRATCH_RESUME],
    );
    out.resumeId = r.rows[0].id;
  }
  if (needs.job) {
    const r = await client.query(
      `INSERT INTO syntra.jobs (title, original_file_name, raw_text, created_by)
       VALUES ($1, 'node-test.txt', $2, NULL) RETURNING id::text`,
      [SCRATCH_MARK, SCRATCH_JD],
    );
    out.jobId = r.rows[0].id;
  }
  return out;
}

/** Deletes everything provisioned, plus anything the run hung off it. */
async function cleanup(client: PoolClient, s: Scratch): Promise<string[]> {
  const removed: string[] = [];
  const ids = [s.jobId, s.resumeId, s.candidateId].filter(Boolean) as string[];
  if (ids.length === 0) return removed;

  const ml = await client.query(
    `DELETE FROM syntra.ml_scoring_log
      WHERE job_id::text = ANY($1) OR resume_id::text = ANY($1)
         OR candidate_id::text = ANY($1)`,
    [ids],
  );
  if (ml.rowCount) removed.push(`ml_scoring_log:${ml.rowCount}`);

  const ob = await client.query(
    `DELETE FROM event_outbox
      WHERE occurred_at > now() - interval '10 minutes'
        AND (${ids.map((_, i) => `payload_ref::text LIKE '%'||$${i + 1}||'%'`).join(" OR ")})`,
    ids,
  );
  if (ob.rowCount) removed.push(`event_outbox:${ob.rowCount}`);

  const mt = await client.query(
    `DELETE FROM syntra.matches
      WHERE job_id::text = ANY($1) OR resume_id::text = ANY($1)
         OR candidate_id::text = ANY($1)`,
    [ids],
  );
  if (mt.rowCount) removed.push(`matches:${mt.rowCount}`);

  if (s.jobId) {
    const r = await client.query(`DELETE FROM syntra.jobs WHERE id = $1`, [s.jobId]);
    if (r.rowCount) removed.push(`jobs:${r.rowCount}`);
  }
  if (s.resumeId) {
    const r = await client.query(`DELETE FROM syntra.resumes WHERE id = $1`, [s.resumeId]);
    if (r.rowCount) removed.push(`resumes:${r.rowCount}`);
  }
  if (s.candidateId) {
    const r = await client.query(`DELETE FROM syntra.candidates WHERE id = $1`, [
      s.candidateId,
    ]);
    if (r.rowCount) removed.push(`candidates:${r.rowCount}`);
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
      scratch = await provision(client, needs);

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
