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
