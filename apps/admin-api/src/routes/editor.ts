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
import { runnableImpls } from "../lib/runnable-impls.js";
import {
  GraphDefinitionSchema,
  validateGraphTopology,
  checksumOf,
} from "@tekisho/graph-contract";
import { upsertActiveEventBinding } from "@tekisho/authoring";
import { withOrgScope } from "../with-org-scope.js";
import { deriveChain } from "../lib/derive-chain.js";
import { collectGateEvidence } from "../lib/gate-evidence.js";
import { diffGraphs } from "../lib/diff-graphs.js";
import { EVENT_SCHEMAS, GRAPH_DEFINITIONS, GRAPH_EVENT_BINDINGS } from "../lib/authoring-views.js";
import { versionForDraft } from "../lib/version-for-draft.js";
import {
  activateVersion,
  approveGoLive,
  compileDraft,
  cancelGoLiveRequest,
  requestGoLive,
  saveDraft,
} from "../lib/authoring-writes.js";
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
          ? `SELECT *, application AS module FROM authoring.node_registry
              WHERE application = $1 OR shareable = true
              ORDER BY (application = $1) DESC, application, key`
          : `SELECT *, application AS module FROM authoring.node_registry ORDER BY application, key`,
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
   * Start editing: copy the active version's topology into the workflow's
   * draft. The active row is not touched.
   *
   * The draft sits at version 0 — the reserved working-copy slot — because a
   * draft is not a version. Versions are allocated when a workflow is
   * published, which is the only point at which the number means something: it
   * is what a run pins and what a rollback returns to.
   *
   * If a draft already exists, that one is returned instead of stacking a
   * second — one draft per workflow keeps "which draft am I looking at" from
   * becoming a question.
   */
  app.post("/workflows/:graphKey/draft", async (req: any, reply: any) => {
    const graphKey = String(req.params?.graphKey ?? "");
    const orgId = readOrgId(req.headers);
    if (!graphKey) return reply.code(400).send({ error: "graph_key_required" });

    try {
      return await withOrgScope(pool, orgId, async (client) => {
        // Newest, not highest-numbered. Drafts created from here on carry
        // version 0 (see below), so ordering by version would keep returning a
        // stale draft from before that change.
        const existing = await client.query(
          `SELECT version FROM ${GRAPH_DEFINITIONS}
            WHERE graph_key = $1 AND status = 'draft' AND org_id IS NULL
            ORDER BY created_at DESC LIMIT 1`,
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
          `SELECT version, definition FROM ${GRAPH_DEFINITIONS}
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

        /**
         * A DRAFT IS NOT A VERSION.
         *
         * This used to allocate max(version) + 1, so merely opening the editor
         * consumed a version number. `syntra.authored` reached version 124
         * with one active version and 32 abandoned drafts — 123 numbers spent
         * on editing sessions, and a binding pointing at a number that means
         * nothing.
         *
         * Drafts now sit at version 0, the reserved "working copy" slot. A
         * version is allocated when the workflow is PUBLISHED, which is the
         * only moment a version means anything: it is what a run pins and what
         * a rollback goes back to.
         *
         * This is also what makes the row map onto authoring.graph_drafts,
         * which holds exactly one draft per workflow and has no version column
         * at all.
         */
        const version = 0;
        const definition = source.rows[0].definition;

        await saveDraft(client, {
          graphKey,
          orgId: null,
          definition,
          checksum: checksumOf(definition),
          by: String(req.headers["x-admin-id"] ?? "admin-local"),
        });

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
               FROM ${GRAPH_DEFINITIONS}
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
            `SELECT event_type FROM ${GRAPH_EVENT_BINDINGS}
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
          /**
           * TWO NAMES FOR THE CHOSEN TRIGGER, AND THIS READ ONLY ONE.
           *
           * `entryInput` is what the seeds and older definitions carry;
           * `triggerEventType` is what the graph contract added and what
           * `/workflows/accept` writes. Neither name appears in both sets, so
           * reading `entryInput` alone showed "no trigger bound" on the canvas
           * for every workflow created through the current create path — the
           * exact workflows somebody is most likely to be editing.
           */
          const chosenInDefinition =
            row.definition?.triggerEventType ?? row.definition?.entryInput;
          const pending =
            bound.length === 0 && chosenInDefinition
              ? [String(chosenInDefinition)]
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
              `SELECT payload_schema FROM ${EVENT_SCHEMAS}
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
  /**
   * Take a workflow offline — stop it running, without deleting anything.
   *
   * Retires the ACTIVE BINDING and nothing else. The definition stays active,
   * the versions stay where they are, and the workflow is still there to look
   * at; it simply has no door. That is the smallest reversible act that means
   * "stop", and putting it back is one binding.
   *
   * The agent equivalent also retires the definition. That conflates two
   * decisions — "stop this running" and "un-publish this version" — and makes
   * coming back a two-step recovery instead of a one-line one.
   *
   * `expectedEventType` is optimistic concurrency: a screen that has been open
   * a while may be looking at a binding that has since changed, and taking the
   * wrong event offline is not something to discover afterwards.
   */
  /**
   * Turn the working copy into a numbered version.
   *
   * The editor could create a draft and save it, and nothing could turn one
   * into a version — `compileVersion` was reachable only from the agent path.
   * So `request-go-live` had nothing to act on for a workflow authored here,
   * and the lifecycle stopped one step short of being usable.
   *
   * It validates first. A version that cannot compile is worse than no
   * version: it sits in the list looking promotable, and fails at the moment
   * somebody puts it live.
   */
  app.post("/workflows/:graphKey/compile", async (req: any, reply: any) => {
    const graphKey = String(req.params?.graphKey ?? "");
    if (!graphKey) return reply.code(400).send({ error: "graph_key_required" });

    try {
      const { rows: draft } = await pool.query(
        `SELECT definition FROM ${GRAPH_DEFINITIONS} gd
          WHERE gd.graph_key = $1 AND gd.version = 0`,
        [graphKey],
      );
      if (!draft[0]) {
        return reply.code(409).send({
          error: "no_draft",
          message:
            `${graphKey} has no working copy to compile. Open it in the ` +
            `editor and save something first.`,
        });
      }

      try {
        validateGraphTopology(draft[0].definition);
      } catch (err: any) {
        return reply.code(422).send({
          error: "definition_invalid",
          message: String(err?.message ?? err),
          note:
            "Nothing was compiled. A version that cannot run is worse than " +
            "no version — it looks promotable until somebody puts it live.",
        });
      }

      const built = await compileDraft(pool, {
        graphKey,
        orgId: null,
        by: String(req.headers["x-admin-id"] ?? "admin-local"),
      });
      if (!built) {
        return reply.code(409).send({ error: "no_draft" });
      }

      return {
        graphKey,
        version: built.version,
        checksum: built.checksum,
        status: "compiled",
        note:
          "The draft is untouched — compiling takes a copy. Nothing runs " +
          "until this version is requested and approved.",
      };
    } catch (err: any) {
      req.log?.error?.(err);
      return reply
        .code(500)
        .send({ error: "compile_failed", message: String(err) });
    }
  });

  /**
   * Ask, decide, withdraw.
   *
   * The agent side has had these three since `agent_policies.status` grew
   * `pending_go_live`. The workflow side could not until V20260909.48 gave
   * `authoring.graph_versions.status` the same state — a build somebody had
   * asked to promote and a build nobody had looked at were both `compiled`,
   * so the request left no trace in the table that decides what runs.
   *
   * Requesting is offered to anyone who can edit, because it changes nothing
   * about what runs. Approving is the act with consequences, and it is the one
   * that records a name.
   */
  /**
   * FREEZE AND ASK, AS ONE ACT — and without minting a version per press.
   *
   * The screen did this as two client calls: compile, then request. Compiling
   * always INSERTS, so withdrawing and sending again produced v2, v3, v4 of an
   * identical definition — and the panel that said "v1" sent v2. The version
   * the author reviewed was not the version the approver got.
   *
   * `versionForDraft` answers with the version that IS the working copy,
   * compiling only when the checksum has moved. The same function answers for
   * a test pin, so the version you tested and the version you send are the
   * same one by construction rather than by luck.
   *
   * Two writes rather than one transaction, deliberately: a compile that
   * succeeds and a request that fails leaves a compiled version and the button
   * back at "Send" — recoverable and visible. Wrapping them would need the
   * write helpers to share a client, which is a bigger change than the fault
   * justifies.
   */
  /**
   * Everything a person needs before asking somebody else to put this live.
   *
   * WHY ONE ENDPOINT RATHER THAN THE PAGE ASSEMBLING IT.
   *
   * The facts have to agree. The version being described must be the version
   * that gets requested, and the runs shown must be runs OF that version —
   * `versionForDraft` decides it once here, and everything else is read
   * against that answer.
   *
   * READ-ONLY, INCLUDING THE VERSION. `preview` means "what would happen",
   * so this never compiles: opening a review must not mint a version, or
   * looking at the request twice leaves two behind. When the working copy has
   * moved on, it reports the version that WOULD be created rather than
   * creating it.
   */
  app.get("/workflows/:graphKey/approval-request", async (req: any, reply: any) => {
    const graphKey = String(req.params.graphKey ?? "");
    if (!graphKey) return reply.code(400).send({ error: "graph_key_required" });

    try {
      const preview = await versionForDraft(pool, {
        graphKey,
        orgId: null,
        // Never compiles: answers null and the caller reports "a new version".
        compileDraft: async () => null,
      });

      const { rows: rowsV } = await pool.query(
        `SELECT v.version, v.status, v.definition,
                (SELECT max(v2.version) FROM authoring.graph_versions v2
                  WHERE v2.graph_id = v.graph_id AND v2.status = 'live') AS live_version
           FROM authoring.graph_versions v
           JOIN authoring.graphs g ON g.id = v.graph_id
          WHERE g.graph_key = $1
          ORDER BY v.version DESC LIMIT 1`,
        [graphKey],
      );
      const newest = rowsV[0];
      const version = preview.ok ? preview.version : null;

      /**
       * Whether this VERSION has been run, not whether this browser tab has
       * seen a run. The panel used in-session state, so testing and then
       * reloading reported "nothing yet" for a version with three runs.
       */
      const { rows: runs } = version
        ? await pool.query(
            `SELECT status, count(*)::int AS n, max(started_at) AS last,
                    (array_agg(id::text ORDER BY started_at DESC))[1] AS latest_id
               FROM orch.runs
              WHERE graph_key = $1 AND graph_version = $2
              GROUP BY status`,
            [graphKey, version],
          )
        : { rows: [] as any[] };

      const definition: any = newest?.definition ?? {};
      return {
        graphKey,
        version,
        /** True when raising would freeze a NEW version rather than reuse one. */
        wouldCompile: !preview.ok,
        liveVersion: newest?.live_version ?? null,
        alreadyPending: newest?.status === "pending_go_live",
        trigger: definition.triggerEventType ?? definition.entryInput ?? null,
        steps: (definition.nodes ?? []).map((n: any) => ({
          id: String(n.id),
          impl: String(n.impl),
        })),
        tested: {
          total: runs.reduce((sum: number, r: any) => sum + Number(r.n), 0),
          byStatus: runs.map((r: any) => ({
            status: String(r.status),
            count: Number(r.n),
            last: r.last,
            latestRunId: r.latest_id ? String(r.latest_id) : null,
          })),
        },
      };
    } catch (err: any) {
      req.log?.error?.(err);
      return reply
        .code(500)
        .send({ error: "review_failed", message: String(err?.message ?? err) });
    }
  });

  app.post("/workflows/:graphKey/send-for-approval", async (req: any, reply: any) => {
    const graphKey = String(req.params.graphKey ?? "");
    if (!graphKey) return reply.code(400).send({ error: "graph_key_required" });

    try {
      const by = String(req.headers["x-admin-id"] ?? "admin-local");
      const chosen = await versionForDraft(pool, {
        graphKey,
        orgId: null,
        by,
        compileDraft: (a) => compileDraft(pool, a),
      });
      if (!chosen.ok) {
        return reply.code(409).send({
          error: "nothing_to_send",
          message: chosen.message,
        });
      }

      const asked = await requestGoLive(pool, {
        graphKey,
        orgId: null,
        version: chosen.version,
        by,
        note: req.body?.note ? String(req.body.note) : null,
      });
      if (!asked) {
        return reply.code(409).send({
          error: "request_refused",
          message:
            `v${chosen.version} was taken but could not be sent. It may ` +
            `already be live, or already waiting for approval.`,
        });
      }

      return {
        graphKey,
        version: asked.version,
        status: asked.status,
        /** True when this press created the version rather than reusing one. */
        compiled: chosen.compiled,
        note:
          `v${asked.version} is waiting for approval. Somebody else has to put ` +
          `it live.`,
      };
    } catch (err: any) {
      req.log?.error?.(err);
      return reply
        .code(500)
        .send({ error: "send_failed", message: String(err?.message ?? err) });
    }
  });

  app.post("/workflows/:graphKey/request-go-live", async (req: any, reply: any) => {
    const graphKey = String(req.params?.graphKey ?? "");
    if (!graphKey) return reply.code(400).send({ error: "graph_key_required" });
    const version = req.body?.version != null ? Number(req.body.version) : undefined;

    try {
      const asked = await requestGoLive(pool, {
        graphKey,
        orgId: null,
        version,
        by: String(req.headers["x-admin-id"] ?? "admin-local"),
        note: req.body?.note ? String(req.body.note) : null,
      });

      if (!asked) {
        return reply.code(409).send({
          error: "nothing_to_request",
          message:
            version != null
              ? `${graphKey}@${version} is not a compiled version waiting to be ` +
                `promoted. A version that is already live, retired, or already ` +
                `requested cannot be requested again.`
              : `${graphKey} has no compiled version to promote. Save and ` +
                `compile a draft first.`,
        });
      }

      return {
        graphKey,
        version: asked.version,
        status: asked.status,
        note:
          "Nothing runs differently yet. Somebody has to approve it, and the " +
          "approval is what puts it on the air.",
      };
    } catch (err: any) {
      req.log?.error?.(err);
      return reply
        .code(500)
        .send({ error: "request_failed", message: String(err) });
    }
  });

  app.post("/workflows/:graphKey/approve-go-live", async (req: any, reply: any) => {
    const graphKey = String(req.params?.graphKey ?? "");
    if (!graphKey) return reply.code(400).send({ error: "graph_key_required" });
    const version = req.body?.version != null ? Number(req.body.version) : undefined;

    const client = await pool.connect();
    try {
      // Standing one version down and another up is one act: the one-live
      // index refuses the pair in the wrong order, and a half-applied
      // promotion leaves the workflow off the air entirely.
      await client.query("BEGIN");

      /**
       * THE GATE RUNS HERE, AND UNTIL NOW IT DID NOT RUN AT ALL.
       *
       * `evaluateGoLiveGate` was wired into exactly one write path — the
       * agent one, in routes/agents.ts. On the workflow path it was advisory:
       * the checks screen displayed it, and approving ignored it. So every
       * check in it, including the self-trigger rule that stops a workflow
       * restarting itself for ever, could be read and then walked straight
       * past by pressing Approve.
       *
       * That is the gap this screen exists to close. A console that shows
       * evidence beside a button which does not consult it is theatre.
       *
       * INSIDE THE TRANSACTION, before anything is promoted, so a refusal
       * leaves the version exactly where it was.
       *
       * WHEN THE EVIDENCE CANNOT BE GATHERED the gate reports "not checked"
       * rather than passing — that is `collectGateEvidence`'s contract — so a
       * database that cannot answer produces a visible gap, not a silent
       * approval.
       */
      const { rows: candidate } = await client.query(
        `SELECT v.version, v.definition, v.checksum
           FROM authoring.graph_versions v
           JOIN authoring.graphs g ON g.id = v.graph_id
          WHERE g.graph_key = $1
            AND v.status = 'pending_go_live'
            AND ($2::int IS NULL OR v.version = $2)
          ORDER BY v.requested_at ASC NULLS LAST
          LIMIT 1`,
        [graphKey, version ?? null],
      );

      if (candidate[0]) {
        const artifactSource = `${JSON.stringify(candidate[0].definition, null, 2)}\n`;
        const evidence = await collectGateEvidence(
          client,
          artifactSource,
          graphKey,
        );
        const gate = evaluateGoLiveGate({
          runnableImpls: runnableImpls(),
          artifactSource,
          storedChecksum: candidate[0].checksum ?? "",
          expectedGraphKey: graphKey,
          artifactKind: "workflow",
          gapAck: null,
          ...evidence,
        });

        if (!gate.ok) {
          await client.query("ROLLBACK");
          return reply.code(409).send({
            error: "blocked_by_checks",
            blockedBy: gate.blockedBy,
            message: gate.message,
            // Every check, not only the failures: the approver needs to see
            // what was examined, or a refusal reads as the platform being
            // arbitrary.
            checks: gate.checks.map((c) => ({
              id: c.id,
              ok: c.ok,
              message: c.message,
            })),
          });
        }
      }

      const promoted = await approveGoLive(client, {
        graphKey,
        orgId: null,
        version,
        by: String(req.headers["x-admin-id"] ?? "admin-local"),
      });

      if (!promoted) {
        await client.query("ROLLBACK");
        return reply.code(409).send({
          error: "nothing_to_approve",
          message:
            version != null
              ? `${graphKey}@${version} is not waiting for approval.`
              : `${graphKey} has no version waiting for approval.`,
        });
      }
      /**
       * The two-person rule, refused in words rather than by a constraint.
       *
       * The database refuses it too (V20260909.53), but a constraint violation
       * arrives here as a 500 naming a column. Whoever hit this needs to know
       * that somebody else has to approve it, not that
       * `graph_versions_two_person_ck` failed.
       */
      if ("refused" in promoted) {
        await client.query("ROLLBACK");
        return reply.code(409).send({
          error: "same_person",
          message:
            `${graphKey}@${promoted.version} was requested by ${promoted.requestedBy}, ` +
            `so ${promoted.requestedBy} cannot approve it. Somebody else has to. ` +
            `Nothing was changed.`,
        });
      }
      /**
       * The binding, created here and nowhere else.
       *
       * A draft binding cannot be stored — an active one would put an
       * unreviewed workflow into production — so the trigger waits in the
       * definition from the moment the workflow is accepted until somebody
       * approves it. This is that moment. Without this the version went live
       * and nothing routed to it: live, and unreachable.
       *
       * In the same transaction as the promotion, because a promoted version
       * with no binding and a binding onto an unpromoted version are both
       * worse than neither.
       */
      const { rows: def } = await client.query(
        `SELECT definition FROM ${GRAPH_DEFINITIONS} gd
          WHERE gd.graph_key = $1 AND gd.version = $2`,
        [graphKey, promoted.version],
      );
      const trigger = def[0]?.definition?.triggerEventType
        ? String(def[0].definition.triggerEventType)
        : null;

      let boundTo: string | null = null;
      if (trigger) {
        await upsertActiveEventBinding(client, {
          eventType: trigger,
          orgId: null,
          graphKey,
          version: promoted.version,
          // Approving IS the confirmation. The takeover guard exists so that
          // taking an event is never accidental, and somebody has just been
          // shown this workflow and said yes to it.
          allowTakeover: true,
        });
        boundTo = trigger;
      }

      await client.query("COMMIT");

      return {
        graphKey,
        version: promoted.version,
        previousLive: promoted.previousLive,
        boundTo,
        live: true,
        note:
          (boundTo
            ? `${boundTo} now starts this workflow. `
            : "This workflow names no trigger, so nothing routes to it yet. ") +
          (promoted.previousLive != null
            ? `v${promoted.previousLive} was retired, not deleted — rolling ` +
              `back is the same call with the other version number.`
            : "This is the first version of this workflow to go live."),
      };
    } catch (err: any) {
      await client.query("ROLLBACK").catch(() => {});
      req.log?.error?.(err);
      return reply
        .code(500)
        .send({ error: "approve_failed", message: String(err) });
    } finally {
      client.release();
    }
  });

  app.post(
    "/workflows/:graphKey/cancel-go-live-request",
    async (req: any, reply: any) => {
      const graphKey = String(req.params?.graphKey ?? "");
      if (!graphKey) return reply.code(400).send({ error: "graph_key_required" });
      const version = req.body?.version != null ? Number(req.body.version) : undefined;

      try {
        const withdrawn = await cancelGoLiveRequest(pool, {
          graphKey,
          orgId: null,
          version,
        });

        if (!withdrawn) {
          return reply.code(409).send({
            error: "nothing_to_cancel",
            message: `${graphKey} has no go-live request outstanding.`,
          });
        }

        return {
          graphKey,
          version: withdrawn.version,
          status: "compiled",
          note:
            "The version is untouched and can be requested again. Withdrawing " +
            "means not yet, not never.",
        };
      } catch (err: any) {
        req.log?.error?.(err);
        return reply
          .code(500)
          .send({ error: "cancel_failed", message: String(err) });
      }
    },
  );

  app.post("/workflows/:graphKey/take-offline", async (req: any, reply: any) => {
    const graphKey = String(req.params?.graphKey ?? "");
    const expected = req.body?.expectedEventType
      ? String(req.body.expectedEventType)
      : null;
    if (!graphKey) return reply.code(400).send({ error: "graph_key_required" });

    try {
      const { rows: bindings } = await pool.query(
        `SELECT event_type, module_queue FROM ${GRAPH_EVENT_BINDINGS}
          WHERE graph_key = $1 AND status = 'active'`,
        [graphKey],
      );

      if (bindings.length === 0) {
        return reply.code(409).send({
          error: "not_bound",
          message:
            "This workflow has no active binding, so it is already offline. " +
            "Nothing was changed.",
        });
      }

      if (expected && !bindings.some((b: any) => b.event_type === expected)) {
        return reply.code(409).send({
          error: "binding_changed",
          message: `This workflow is no longer bound to ${expected}.`,
          boundTo: bindings.map((b: any) => b.event_type),
        });
      }

      /**
       * THE BINDING AND THE VERSION GO TOGETHER, IN BOTH DIRECTIONS.
       *
       * This used to retire the binding and leave the version `live`, and said
       * so: "The workflow and all its versions are untouched." That made
       * "live" mean two different things depending on which table you asked —
       * and the two drifted, because nothing kept them in step.
       *
       * `syntra.authored` v124 is the evidence: 262 runs, last on 1 September,
       * still marked live, and nothing has been able to reach it since its
       * binding was retired. Nobody decided that; the halves just came apart.
       * Thirteen workflows are in that state.
       *
       * Approving already does both together (approve-go-live activates the
       * version and creates the binding in one transaction). This is the other
       * direction, and without it the invariant only held on the way up.
       *
       * ONE TRANSACTION, because a workflow that is unbound but still live is
       * exactly the state being removed — producing it halfway through would
       * be the bug rather than the fix.
       *
       * The version is RETIRED, not deleted. Rollback re-activates a retired
       * version, so nothing here is one-way.
       */
      const client = await pool.connect();
      let retiredVersion: number | null = null;
      let rowsChanged = 0;
      try {
        await client.query("BEGIN");

        const { rowCount } = await client.query(
          `UPDATE authoring.event_bindings b
              SET status = 'retired', updated_at = now()
             FROM authoring.graphs g
            WHERE g.id = b.graph_id
              AND g.graph_key = $1
              AND b.status = 'active'`,
          [graphKey],
        );
        rowsChanged = rowCount ?? 0;

        const { rows: stepped } = await client.query(
          `UPDATE authoring.graph_versions v
              SET status = 'retired'
             FROM authoring.graphs g
            WHERE g.id = v.graph_id
              AND g.graph_key = $1
              AND v.status = 'live'
            RETURNING v.version`,
          [graphKey],
        );
        retiredVersion = stepped[0] ? Number(stepped[0].version) : null;

        await client.query(
          `UPDATE authoring.graphs SET status = 'retired', updated_at = now()
            WHERE graph_key = $1 AND status = 'active'`,
          [graphKey],
        );

        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }

      return {
        graphKey,
        offline: true,
        retired: bindings.map((b: any) => b.event_type),
        retiredVersion,
        rowsChanged,
        note:
          retiredVersion !== null
            ? `Binding retired and v${retiredVersion} stepped down. Nothing of ` +
              `this workflow is live now, which is what offline means — the ` +
              `version is retired, not deleted, so rolling it back puts it ` +
              `straight back.`
            : "The binding was retired. No version was live, so nothing stepped down.",
      };
    } catch (err: any) {
      req.log?.error?.(err);
      return reply
        .code(500)
        .send({ error: "take_offline_failed", message: String(err) });
    }
  });

  /**
   * Roll back to an earlier version.
   *
   * A binding names a workflow, not a version — the active version is resolved
   * at routing time — so rolling back means changing WHICH version is active,
   * not re-pointing the binding.
   *
   * One transaction, because `graph_versions_one_live_idx` permits exactly one
   * active version per key: retiring the current one and activating the target
   * must happen together or the workflow is briefly unroutable.
   *
   * Nothing is deleted. The version rolled away from is retired, not removed,
   * so rolling forward again is the same call with the other number.
   */
  app.post("/workflows/:graphKey/rollback", async (req: any, reply: any) => {
    const graphKey = String(req.params?.graphKey ?? "");
    const to = req.body?.toVersion != null ? Number(req.body.toVersion) : null;
    if (!graphKey) return reply.code(400).send({ error: "graph_key_required" });

    const client = await pool.connect();
    try {
      const { rows: versions } = await client.query(
        `SELECT version, status FROM ${GRAPH_DEFINITIONS}
          WHERE graph_key = $1 ORDER BY version DESC`,
        [graphKey],
      );
      if (versions.length === 0) {
        return reply.code(404).send({ error: "workflow_not_found", graphKey });
      }

      const current = versions.find((v: any) => v.status === "active");
      if (!current) {
        return reply.code(409).send({
          error: "nothing_active",
          message:
            "No version of this workflow is active, so there is nothing to roll " +
            "back from.",
        });
      }

      /**
       * Default to the version below the active one — not `active - 1`, which
       * assumes numbers are contiguous. They are not: syntra.authored has 80
       * versions and gaps where drafts were never published.
       */
      const target =
        to !== null
          ? versions.find((v: any) => Number(v.version) === to)
          : versions.find((v: any) => Number(v.version) < Number(current.version));

      if (!target) {
        return reply.code(400).send({
          error: "no_target_version",
          message:
            to !== null
              ? `Version ${to} does not exist for this workflow.`
              : "There is no earlier version to roll back to.",
          available: versions.map((v: any) => Number(v.version)),
        });
      }
      if (Number(target.version) === Number(current.version)) {
        return reply.code(409).send({
          error: "already_active",
          message: `Version ${target.version} is already the active one.`,
        });
      }

      await client.query("BEGIN");
      // Retiring the live one and promoting the target are one act, not two:
      // `graph_versions_one_live_idx` refuses a second live version, so the
      // order matters and both belong in the same transaction.
      await activateVersion(client, {
        graphKey,
        orgId: null,
        version: Number(target.version),
      });
      await client.query("COMMIT");

      return {
        graphKey,
        from: Number(current.version),
        to: Number(target.version),
        note:
          `v${current.version} was retired, not deleted — rolling forward again ` +
          `is the same call with the other version number.`,
      };
    } catch (err: any) {
      await client.query("ROLLBACK").catch(() => {});
      req.log?.error?.(err);
      return reply
        .code(500)
        .send({ error: "rollback_failed", message: String(err) });
    } finally {
      client.release();
    }
  });

  app.get("/workflows/:graphKey/diff", async (req: any, reply: any) => {
    const graphKey = String(req.params.graphKey ?? "");
    const fromQ = req.query?.from ? Number(req.query.from) : null;
    const toQ = req.query?.to ? Number(req.query.to) : null;
    try {
      const { rows } = await pool.query(
        `SELECT version, status, definition FROM ${GRAPH_DEFINITIONS}
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
           FROM ${GRAPH_DEFINITIONS}
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

      /**
       * THE SECOND COPY OF A RULE THAT WAS WRONG IN BOTH PLACES.
       *
       * This short-circuited to `applicable: false` for any key containing
       * `.workflow`, on the grounds that such keys are seeded by migration and
       * the gate refuses them by design. The gate did refuse them — see
       * `checkNoRuntimeKeyCollision`, where the same agent-era rule lived — and
       * both were removed together.
       *
       * The unit of authorship is a workflow and the proposer generates
       * `${module}.${word}.workflow`, so between them these two made the gate
       * unusable on every workflow this platform can author: the editor's rail
       * said "not applicable" and approval refused outright.
       *
       * Collisions are prevented by `graphs_key_per_org_idx`, which is unique
       * on (org, graph_key). A name cannot take a key that already exists.
       */

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
            WHERE indexname = 'graph_versions_one_live_idx' LIMIT 1`,
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
          runnableImpls: runnableImpls(),
        artifactSource,
        storedChecksum: row.checksum ?? "",
        expectedGraphKey: graphKey,
        /**
         * A workflow, not an agent artifact.
         *
         * Without this, three checks fail on every workflow for reasons that
         * are about the agent model rather than about the workflow: a key that
         * does not end `.authored`, a checksum that cannot be recomputed from
         * jsonb, and a gap record only the agent flow writes. This screen has
         * been showing those three reds since it was built.
         */
        artifactKind: "workflow",
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
        `SELECT event_type, graph_key FROM ${GRAPH_EVENT_BINDINGS}
          WHERE status = 'active'`,
      );
      // Drafts too: a chain accepted a minute ago has no bindings yet, and a
      // strip that appeared only after go-live would be missing exactly when
      // somebody is checking their work.
      const { rows: graphs } = await pool.query(
        `SELECT DISTINCT ON (graph_key) graph_key, definition
           FROM ${GRAPH_DEFINITIONS}
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
            `SELECT status FROM ${GRAPH_DEFINITIONS}
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
          await saveDraft(client, {
            graphKey,
            orgId: null,
            definition,
            checksum,
            by: String(req.headers["x-admin-id"] ?? "admin-local"),
          });

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
