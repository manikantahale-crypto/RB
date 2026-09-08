/**
 * Screen 4 — the graph editor's backend.
 *
 * Three responsibilities, and one rule that shapes all of them.
 *
 * THE RULE: an ACTIVE version is never edited in place. Editing means creating
 * a new DRAFT version, and a draft physically cannot run — the router reads
 * `status = 'active'` only. That is not a policy this file enforces with a
 * check; it is what the save handler refuses to do.
 *
 *   GET  /node-registry            what may be inserted, and what is known about it
 *   POST /workflows/:key/draft     copy the active version into a new draft
 *   GET  /workflows/:key/versions/:version    load one for the canvas
 *   PUT  /workflows/:key/versions/:version    save a draft
 */
import type { Pool } from "pg";
import {
  GraphDefinitionSchema,
  validateGraphTopology,
  checksumOf,
} from "@tekisho/graph-contract";
import { withOrgScope } from "../with-org-scope.js";
import { deriveChain } from "../lib/derive-chain.js";
import { collectGateEvidence } from "../lib/gate-evidence.js";
import { diffGraphs } from "../lib/diff-graphs.js";
import {
  evaluateGoLiveGate,
  oneActiveIndexIsPerGraphKey,
} from "@tekisho/authoring/src/go-live-gate.js";

type FastifyLike = {
  get: (path: string, handler: any) => void;
  post: (path: string, handler: any) => void;
  put: (path: string, handler: any) => void;
};

function readOrgId(headers: Record<string, unknown>): string | null {
  const raw = headers["x-org-id"];
  if (raw === undefined || raw === null || raw === "" || raw === "~global~") {
    return null;
  }
  return String(raw);
}

export type RegistryNode = {
  registryKey: string;
  key: string;
  module: string;
  shareable: boolean;
  title: string;
  description: string;
  sideEffect: string | null;
  /** null for nodes that have not declared themselves — see `source`. */
  inputSchema: unknown;
  outputSchema: unknown;
  configSchema: unknown;
  adminExposed: string[];
  idempotency: unknown;
  execution: unknown;
  dependencies: string[];
  persistence: unknown;
  fixtureNames: string[];
  /** "contract" — declared and enforced. "legacy" — an engine function. */
  /**
   * Where this node's declaration came from.
   *
   *   contract  declared, and the declaration is what runs
   *   declared  declared, but the engine runs its own implementation, so
   *             nothing checks one against the other
   *   legacy    an engine function with no declaration at all
   *
   * `declared` exists for the two platform control nodes — `human.gate` parks
   * a run, `orch.branch.decision` writes graph state — neither of which can
   * travel back through the contract bridge. Their schemas are real and worth
   * projecting; the guarantee is not, so the screens must not imply one.
   */
  source: "contract" | "declared" | "legacy";
  /** external / financial need written justification and are not testable here. */
  requiresAllowlist: boolean;
  editorTestable: boolean;
};

export function registerEditorRoutes(app: FastifyLike, pool: Pool): void {
  /**
   * GET /node-registry?module=syntra
   *
   * What may be inserted into a workflow being built for `module`.
   *
   * THE MODULE RULE: you get that module's own nodes, plus anything another
   * module marked `shareable`. That flag already exists on the contract and
   * already means something — `syntra.duplicate.merge` is false because only
   * SYNTRA merges candidate records, and `syntra.run.retry` is false because
   * retry policy belongs to the platform. Without the filter an ORBIT author
   * would be offered SYNTRA's private nodes and find out at runtime.
   *
   * Without `module`, everything is returned — the catalogue view.
   */
  app.get("/node-registry", async (req: any, reply: any) => {
    const module = req.query?.module ? String(req.query.module) : null;
    try {
      const { rows } = await pool.query(
        module
          ? `SELECT * FROM node_registry
              WHERE module = $1 OR shareable = true
              ORDER BY (module = $1) DESC, module, key`
          : `SELECT * FROM node_registry ORDER BY module, key`,
        module ? [module] : [],
      );

      const nodes: RegistryNode[] = rows.map((r: any) => ({
        registryKey: r.registry_key,
        key: r.key,
        module: r.module,
        shareable: r.shareable,
        title: r.title,
        description: r.description,
        sideEffect: r.side_effect ?? null,
        inputSchema: r.input_schema ?? null,
        outputSchema: r.output_schema ?? null,
        configSchema: r.config_schema ?? null,
        adminExposed: r.admin_exposed ?? [],
        idempotency: r.idempotency ?? null,
        execution: r.execution ?? null,
        dependencies: r.dependencies ?? [],
        persistence: r.persistence ?? null,
        fixtureNames: r.fixture_names ?? [],
        source:
          r.source === "legacy" || r.source === "declared"
            ? r.source
            : "contract",
        requiresAllowlist:
          r.side_effect === "external" || r.side_effect === "financial",
        editorTestable:
          r.source === "contract" &&
          r.side_effect !== "external" &&
          r.side_effect !== "financial",
      }));

      return { nodes, module };
    } catch (err) {
      const message = String(err);
      if (message.includes("node_registry")) {
        return reply.code(503).send({
          error: "node_registry_missing",
          message:
            "node_registry has not been built yet. Run: npm run materialize:nodes -w @tekisho/worker",
        });
      }
      req.log?.error?.(err);
      return reply
        .code(500)
        .send({ error: "node_registry_failed", message });
    }
  });

  /**
   * POST /workflows/:graphKey/draft
   *
   * Start editing: copy the active version's topology into a new draft at
   * `max(version) + 1`. The active row is not touched.
   *
   * If a draft already exists, that one is returned instead of stacking a
   * second — one draft per workflow keeps "which draft am I looking at"
   * from becoming a question.
   */
  app.post("/workflows/:graphKey/draft", async (req: any, reply: any) => {
    const graphKey = String(req.params?.graphKey ?? "");
    const orgId = readOrgId(req.headers);
    if (!graphKey) return reply.code(400).send({ error: "graph_key_required" });

    try {
      return await withOrgScope(pool, orgId, async (client) => {
        const existing = await client.query(
          `SELECT version FROM graph_definitions
            WHERE graph_key = $1 AND status = 'draft' AND org_id IS NULL
            ORDER BY version DESC LIMIT 1`,
          [graphKey],
        );
        if (existing.rows[0]) {
          return {
            graphKey,
            version: existing.rows[0].version,
            created: false,
            note: "A draft already exists for this workflow; opening that one.",
          };
        }

        const source = await client.query(
          `SELECT version, definition FROM graph_definitions
            WHERE graph_key = $1 AND status = 'active' AND org_id IS NULL
            LIMIT 1`,
          [graphKey],
        );
        if (!source.rows[0]) {
          return reply.code(404).send({
            error: "no_active_version",
            message: `${graphKey} has no active version to copy from.`,
          });
        }

        const next = await client.query(
          `SELECT coalesce(max(version), 0) + 1 AS v FROM graph_definitions
            WHERE graph_key = $1`,
          [graphKey],
        );
        const version = Number(next.rows[0].v);
        const definition = source.rows[0].definition;

        await client.query(
          `INSERT INTO graph_definitions
             (id, org_id, graph_key, version, definition, checksum, status, created_by)
           VALUES ($1, NULL, $2, $3, $4::jsonb, $5, 'draft', $6)`,
          [
            `${graphKey}@${version}`,
            graphKey,
            version,
            JSON.stringify(definition),
            checksumOf(definition),
            req.headers["x-admin-id"] ?? "admin-local",
          ],
        );

        return {
          graphKey,
          version,
          created: true,
          copiedFrom: Number(source.rows[0].version),
        };
      });
    } catch (err) {
      req.log?.error?.(err);
      return reply
        .code(500)
        .send({ error: "draft_create_failed", message: String(err) });
    }
  });

  /** GET one version's topology, for the canvas. */
  app.get(
    "/workflows/:graphKey/versions/:version",
    async (req: any, reply: any) => {
      const graphKey = String(req.params?.graphKey ?? "");
      const version = Number(req.params?.version);
      const orgId = readOrgId(req.headers);
      if (!graphKey || !Number.isFinite(version)) {
        return reply.code(400).send({ error: "graph_key_and_version_required" });
      }

      try {
        return await withOrgScope(pool, orgId, async (client) => {
          const { rows } = await client.query(
            `SELECT version, status, definition, checksum, created_by, created_at
               FROM graph_definitions
              WHERE graph_key = $1 AND version = $2 AND org_id IS NULL`,
            [graphKey, version],
          );
          const row = rows[0] as any;
          if (!row) {
            return reply
              .code(404)
              .send({ error: "version_not_found", graphKey, version });
          }

          const triggers = await client.query(
            `SELECT event_type FROM graph_event_bindings
              WHERE graph_key = $1 AND status = 'active'`,
            [graphKey],
          );

          const bound = triggers.rows.map((t: any) => t.event_type);

          /**
           * A DRAFT'S TRIGGER IS NOT A BINDING YET.
           *
           * `graph_event_bindings` permits only 'active' and 'retired', so a
           * draft binding has no representation and accepting a proposal keeps
           * the chosen trigger inside the definition (`entryInput`) until
           * go-live — see propose.ts. Reading bindings alone therefore shows
           * "no trigger bound" on every workflow that has never gone live,
           * which is exactly the ones being edited.
           *
           * So fall back to the definition, and say which one this is. The
           * distinction is real and the canvas must not hide it: bound means
           * events reach it today, pending means the binding appears at
           * go-live.
           */
          const pending =
            bound.length === 0 && row.definition?.entryInput
              ? [String(row.definition.entryInput)]
              : [];

          /**
           * WHAT THE TRIGGER CARRIES, so the canvas can say whether each step
           * can actually get what it needs.
           *
           * Every step's input is built from the trigger payload, so this is
           * the other half of that answer — the registry says what a step
           * requires, this says what will be there. Without it the editor can
           * only check the shape of a workflow, which is how a step needing a
           * field its trigger never carries reaches production.
           *
           * `declared` is not the same as "empty". Eight event schemas carry a
           * permissive placeholder, written at boot so ingress can accept an
           * event nobody has described yet. Reading those as "carries nothing"
           * would blame the workflow for a gap in the catalogue.
           */
          const chosen = (bound.length > 0 ? bound : pending)[0];
          let triggerFields: string[] = [];
          let triggerDeclared = false;
          if (chosen) {
            const ev = await client.query(
              `SELECT payload_schema FROM event_schemas
                WHERE event_type = $1 LIMIT 1`,
              [chosen],
            );
            triggerFields = Object.keys(
              (ev.rows[0] as any)?.payload_schema?.properties ?? {},
            );
            triggerDeclared = triggerFields.length > 0;
          }

          return {
            graphKey,
            version: row.version,
            status: row.status,
            definition: row.definition,
            checksum: row.checksum,
            createdBy: row.created_by,
            createdAt: row.created_at,
            // The canvas draws these as the trigger chip. A workflow can have
            // several — it never learns which door fired.
            triggers: bound.length > 0 ? bound : pending,
            triggerSource:
              bound.length > 0 ? "binding" : pending.length > 0 ? "draft" : "none",
            /** Field names the trigger's payload schema declares. */
            triggerFields,
            /** False when that schema is a placeholder rather than a description. */
            triggerDeclared,
            editable: row.status === "draft",
          };
        });
      } catch (err) {
        req.log?.error?.(err);
        return reply
          .code(500)
          .send({ error: "version_load_failed", message: String(err) });
      }
    },
  );

  /**
   * The workflows on either side of this one.
   *
   * A cross-application flow is stored as a chain: a workflow per application,
   * joined by published events. The editor edits one link, and without this it
   * would show no sign the others exist — an author who described one flow
   * would open it and find half their work missing.
   *
   * DERIVED, NOT STORED. Nothing records that two workflows are one authored
   * flow, and adding a column for it is a schema decision nobody has taken. It
   * does not need one: a workflow's last step carries the handoff event in its
   * config (`astra.route.decision` has `onActionable: syntra.jd.normalized`),
   * and that event is bound to the workflow downstream. So the chain is
   * recoverable from what is already there.
   *
   * The honest limit: this finds a neighbour only where the handoff event
   * appears in a node's config. A node that emits from inside its own code
   * says so nowhere a query can reach, so that link stays invisible until the
   * node contract can declare what it emits.
   */
  /**
   * The workflows on either side of this one.
   *
   * Derived rather than stored — see `lib/derive-chain.ts` for how, and for
   * the one kind of link it cannot see.
   */
  /**
   * Screen 9 — the go-live checks, run before anybody asks for go-live.
   *
   * THE CHECKS ALREADY EXISTED. `evaluateGoLiveGate` has run on every agent
   * release for weeks; it was simply unreachable for a workflow, so an author
   * building one found out what the gate thought at the moment it refused
   * them. Showing the same verdicts while there is still time to act on them
   * costs one endpoint and no new logic.
   *
   * Read-only. It decides nothing and changes nothing — asking what the gate
   * would say must never be the thing that makes it say it.
   *
   * The gate refuses any key containing `.workflow`, deliberately: those are
   * runtime keys seeded by migration, and an authored workflow must not
   * collide with one. So this reports honestly on drafts and says why it
   * cannot judge a seeded workflow, rather than showing a wall of failures
   * that mean nothing.
   */
  /**
   * Screen 8 — what changed between two versions.
   *
   * Defaults to the two most recent, because that is the question actually
   * being asked nine times in ten: what did I just do. Any pair can be named
   * explicitly.
   *
   * The comparison is field-level rather than textual — see `diff-graphs.ts`
   * for why. Version numbers, checksums and timestamps are excluded on
   * purpose: they differ between any two versions by construction, so
   * reporting them is noise that trains people to skim.
   */
  app.get("/workflows/:graphKey/diff", async (req: any, reply: any) => {
    const graphKey = String(req.params.graphKey ?? "");
    const fromQ = req.query?.from ? Number(req.query.from) : null;
    const toQ = req.query?.to ? Number(req.query.to) : null;
    try {
      const { rows } = await pool.query(
        `SELECT version, status, definition FROM graph_definitions
          WHERE graph_key = $1 ORDER BY version DESC`,
        [graphKey],
      );
      if (rows.length === 0) {
        return reply.code(404).send({ error: "workflow_not_found", graphKey });
      }
      if (rows.length === 1 && fromQ === null && toQ === null) {
        return {
          graphKey,
          from: null,
          to: rows[0].version,
          versions: rows.map((r: any) => ({
            version: r.version,
            status: r.status,
          })),
          diff: null,
          note: "This is the first version — there is nothing to compare it with.",
        };
      }

      const pick = (want: number | null, fallbackIndex: number) =>
        want !== null
          ? rows.find((r: any) => Number(r.version) === want)
          : rows[fallbackIndex];

      const newer = pick(toQ, 0);
      const older = pick(fromQ, 1);
      if (!newer || !older) {
        return reply.code(400).send({
          error: "version_not_found",
          message: "One of the versions asked for does not exist.",
          available: rows.map((r: any) => r.version),
        });
      }

      const parse = (d: unknown) =>
        typeof d === "string" ? JSON.parse(d) : (d as Record<string, unknown>);

      return {
        graphKey,
        from: older.version,
        to: newer.version,
        versions: rows.map((r: any) => ({
          version: r.version,
          status: r.status,
        })),
        // Older first: passing them the other way round produces a diff that
        // is correct and backwards.
        diff: diffGraphs(parse(older.definition), parse(newer.definition)),
        note: null,
      };
    } catch (err: any) {
      req.log?.error?.(err);
      return reply.code(500).send({ error: "diff_failed", message: String(err) });
    }
  });

  app.get("/workflows/:graphKey/checks", async (req: any, reply: any) => {
    const graphKey = String(req.params.graphKey ?? "");
    const wanted = req.query?.version ? Number(req.query.version) : null;
    try {
      const { rows } = await pool.query(
        `SELECT version, status, definition, checksum
           FROM graph_definitions
          WHERE graph_key = $1
            AND ($2::int IS NULL OR version = $2::int)
          ORDER BY (status = 'draft') DESC, version DESC
          LIMIT 1`,
        [graphKey, wanted],
      );
      const row = rows[0];
      if (!row) {
        return reply.code(404).send({ error: "workflow_not_found", graphKey });
      }

      if (graphKey.includes(".workflow")) {
        return {
          graphKey,
          version: row.version,
          status: row.status,
          applicable: false,
          reason:
            "This is a runtime workflow key, seeded by migration. The go-live " +
            "gate only judges authored workflows — it refuses these by design, " +
            "so running it here would report failures that mean nothing.",
          checks: [],
        };
      }

      const artifactSource =
        typeof row.definition === "string"
          ? row.definition
          : JSON.stringify(row.definition);

      /**
       * The index fact, read rather than assumed. When it cannot be read the
       * gate is told nothing and reports "not checked" for it, which is the
       * honest answer — the alternative is a check that passes because a query
       * failed.
       */
      let oneActiveIndexPerGraphKey: boolean | undefined;
      try {
        const { rows: idx } = await pool.query(
          `SELECT indexdef FROM pg_indexes
            WHERE indexname = 'graph_definitions_one_active' LIMIT 1`,
        );
        if (idx[0]?.indexdef) {
          oneActiveIndexPerGraphKey = oneActiveIndexIsPerGraphKey(
            String(idx[0].indexdef),
          );
        }
      } catch {
        /* leave undefined — reported as not checked */
      }

      const evidence = await collectGateEvidence(pool, artifactSource, graphKey);

      const gate = evaluateGoLiveGate({
        artifactSource,
        storedChecksum: row.checksum ?? "",
        expectedGraphKey: graphKey,
        // Gaps are acknowledged when go-live is REQUESTED, not while looking.
        // Reporting the unacknowledged state is the point of looking early.
        gapAck: null,
        oneActiveIndexPerGraphKey,
        ...evidence,
      });

      return {
        graphKey,
        version: row.version,
        status: row.status,
        applicable: true,
        reason: null,
        ok: gate.ok,
        checks: gate.checks,
      };
    } catch (err: any) {
      req.log?.error?.(err);
      return reply
        .code(500)
        .send({ error: "checks_failed", message: String(err) });
    }
  });

  app.get("/workflows/:graphKey/chain", async (req: any, reply: any) => {
    const graphKey = String(req.params.graphKey ?? "");
    try {
      const { rows: bindings } = await pool.query(
        `SELECT event_type, graph_key FROM graph_event_bindings
          WHERE status = 'active'`,
      );
      // Drafts too: a chain accepted a minute ago has no bindings yet, and a
      // strip that appeared only after go-live would be missing exactly when
      // somebody is checking their work.
      const { rows: graphs } = await pool.query(
        `SELECT DISTINCT ON (graph_key) graph_key, definition
           FROM graph_definitions
          WHERE status IN ('active', 'draft')
          ORDER BY graph_key, (status = 'active') DESC, version DESC`,
      );
      return deriveChain({
        graphKey,
        graphs: graphs.map((g: any) => ({
          graphKey: String(g.graph_key),
          definition: g.definition,
        })),
        bindings: bindings.map((b: any) => ({
          eventType: String(b.event_type),
          graphKey: String(b.graph_key),
        })),
      });
    } catch (err) {
      req.log?.error?.(err);
      return reply
        .code(500)
        .send({ error: "chain_load_failed", message: String(err) });
    }
  });

  /**
   * PUT a draft's topology.
   *
   * Refuses anything that is not a draft. "No editing active versions in
   * place" is an anti-requirement in the spec, and the reason is that a
   * pinned run reads its topology back from this row — editing it rewrites
   * the history of runs that already happened.
   */
  app.put(
    "/workflows/:graphKey/versions/:version",
    async (req: any, reply: any) => {
      const graphKey = String(req.params?.graphKey ?? "");
      const version = Number(req.params?.version);
      const orgId = readOrgId(req.headers);
      const body = req.body ?? {};

      if (!graphKey || !Number.isFinite(version)) {
        return reply.code(400).send({ error: "graph_key_and_version_required" });
      }

      const parsed = GraphDefinitionSchema.safeParse(body.definition);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "definition_invalid",
          issues: parsed.error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
          })),
        });
      }
      try {
        validateGraphTopology(parsed.data);
      } catch (err) {
        return reply
          .code(400)
          .send({ error: "topology_invalid", message: String(err) });
      }

      try {
        return await withOrgScope(pool, orgId, async (client) => {
          const current = await client.query(
            `SELECT status FROM graph_definitions
              WHERE graph_key = $1 AND version = $2 AND org_id IS NULL`,
            [graphKey, version],
          );
          const row = current.rows[0] as any;
          if (!row) {
            return reply
              .code(404)
              .send({ error: "version_not_found", graphKey, version });
          }
          if (row.status !== "draft") {
            return reply.code(409).send({
              error: "not_a_draft",
              message:
                `${graphKey}@${version} is ${row.status}. An active version is ` +
                `never edited in place — runs are pinned to it and read their ` +
                `topology back from this row. Create a new draft instead.`,
            });
          }

          const definition = parsed.data;
          const checksum = checksumOf(definition);
          await client.query(
            `UPDATE graph_definitions
                SET definition = $3::jsonb, checksum = $4
              WHERE graph_key = $1 AND version = $2 AND org_id IS NULL`,
            [graphKey, version, JSON.stringify(definition), checksum],
          );

          return { graphKey, version, checksum, saved: true };
        });
      } catch (err) {
        req.log?.error?.(err);
        return reply
          .code(500)
          .send({ error: "draft_save_failed", message: String(err) });
      }
    },
  );
}
