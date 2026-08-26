/**
 * Screen 2 — describe a workflow, get one proposal.
 *
 * Two endpoints: `/workflows/propose` produces something to review, and
 * `/workflows/accept` turns it into a draft.
 *
 * WHAT THE MODEL DOES AND DOES NOT DO.
 * The graph shape comes from the LLM, constrained to the node registry and
 * validated against a strict schema before anyone sees it. The TRIGGER MATCH
 * does not: it is term overlap against the catalogue's own sentences, scored
 * here. That is a deliberate choice — matching is the one step where a wrong
 * answer is silent (the workflow simply never fires), and a deterministic
 * match can cite the exact words it matched on. Every ledger line below points
 * at something a person can go and check.
 *
 * A DRAFT BINDING CANNOT BE STORED.
 * The spec says accepting creates a draft graph and a draft binding together,
 * so an orphan is unrepresentable. `graph_event_bindings` has a CHECK
 * constraint permitting only 'active' and 'retired' — a draft binding has no
 * representation, and making one active would put an unreviewed workflow into
 * production. So the chosen trigger travels INSIDE the draft definition and the
 * binding is created at go-live. The link survives; it just lives in one row
 * rather than two. Changing that means widening the constraint, which is a
 * decision about a live shared table.
 */
import type { Pool } from "pg";
import { withOrgScope } from "../with-org-scope.js";
import { checksumOf } from "@tekisho/graph-contract";

type FastifyLike = { post: (path: string, handler: any) => void };

function readOrgId(headers: Record<string, unknown>): string | null {
  const raw = headers["x-org-id"];
  if (raw === undefined || raw === null || raw === "" || raw === "~global~") {
    return null;
  }
  return String(raw);
}

const STOP = new Set([
  "when","a","an","the","and","or","it","is","to","for","of","in","on","at","by",
  "with","that","this","then","from","as","be","are","was","our","we","if","its",
  "new","should","must","will","would","can","into","after","before","against",
  "match","matched","matches", // too common in this domain to discriminate
]);

function terms(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s._-]/g, " ")
    .split(/[\s._-]+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
}

/**
 * Score an event against the request, using the catalogue's own words.
 *
 * The score is not a probability and is not presented as one — it orders
 * candidates and nothing more. What matters is `matchedOn`: the actual words
 * that made this event rank, which is what the ledger cites and what a person
 * checks the suggestion against.
 */
function scoreEvent(
  requestTerms: string[],
  ev: { eventType: string; description: string },
): { score: number; matchedOn: string[] } {
  const haystack = new Set([...terms(ev.description), ...terms(ev.eventType)]);
  const matchedOn = requestTerms.filter((t) => haystack.has(t));
  const unique = [...new Set(matchedOn)];
  // Name matches count double: an event called `requirement.published` matching
  // the word "requirement" is a stronger signal than the same word appearing
  // somewhere in a sentence.
  const nameTerms = new Set(terms(ev.eventType));
  const score =
    unique.reduce((n, t) => n + (nameTerms.has(t) ? 2 : 1), 0) /
    Math.max(requestTerms.length, 1);
  return { score: Math.round(score * 100) / 100, matchedOn: unique };
}

/** Numbers a person wrote, and what they most likely meant. */
function extractConfig(description: string): Array<{
  field: string;
  value: number;
  phrase: string;
}> {
  const out: Array<{ field: string; value: number; phrase: string }> = [];
  // "accept at 92", "threshold of 0.88", "at least 75%"
  const re = /(accept(?:ance)?|threshold|confidence|score)\D{0,12}(\d+(?:\.\d+)?)\s*%?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(description))) {
    const raw = Number(m[2]);
    if (!Number.isFinite(raw)) continue;
    // 92 and 0.92 mean the same thing to a person; the schema wants 0–1.
    const value = raw > 1 ? Math.round((raw / 100) * 100) / 100 : raw;
    out.push({ field: "matchThreshold", value, phrase: m[0].trim() });
  }
  return out;
}

export type LedgerEntry = {
  kind: "READ" | "MATCHED" | "CHOSE" | "SET" | "SKIPPED";
  text: string;
  /** What this claim rests on — a catalogue entry, a registry node, a phrase. */
  citation?: string;
  /** Which control to jump to. */
  action?: "trigger" | "config" | "graph";
};

export function registerProposeRoutes(app: FastifyLike, pool: Pool): void {
  /**
   * POST /workflows/propose  { module, description }
   *
   * Returns a proposal to review — never anything saved. Nothing here writes.
   */
  app.post("/workflows/propose", async (req: any, reply: any) => {
    const body = req.body ?? {};
    const module = String(body.module ?? "syntra");
    const description = String(body.description ?? "").trim();

    if (description.length < 15) {
      return reply.code(400).send({
        error: "description_too_short",
        message:
          "Describe what should happen, starting with when. For example: " +
          '"When a requirement finishes intake, match it against our candidates."',
      });
    }

    try {
      return await withOrgScope(pool, readOrgId(req.headers), async (client) => {
        const requestTerms = terms(description);

        // ── trigger candidates, from the catalogue's own sentences ──────
        const { rows: eventRows } = await client.query(
          `SELECT event_type, description FROM event_schemas ORDER BY event_type`,
        );
        const ranked = eventRows
          .map((e: any) => {
            const { score, matchedOn } = scoreEvent(requestTerms, {
              eventType: e.event_type,
              description: e.description ?? "",
            });
            return {
              eventType: e.event_type,
              description: e.description ?? "",
              score,
              matchedOn,
            };
          })
          .filter((c) => c.matchedOn.length > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, 5);

        const best = ranked[0] ?? null;
        const runnerUp = ranked[1] ?? null;

        // ── what the module may use ─────────────────────────────────────
        const { rows: nodeRows } = await client.query(
          `SELECT key, title, description, side_effect, source, input_schema,
                  output_schema, config_schema
             FROM node_registry
            WHERE module = $1 OR shareable = true
            ORDER BY (module = $1) DESC, key`,
          [module],
        );

        // ── routing: what already answers this event ────────────────────
        const routing = best
          ? await client.query(
              `SELECT graph_key, module_queue, status FROM graph_event_bindings
                WHERE event_type = $1 AND status = 'active'`,
              [best.eventType],
            )
          : { rows: [] as any[] };

        // ── config a person actually wrote down ─────────────────────────
        const extracted = extractConfig(description);

        // ── the ledger: every line points at something checkable ────────
        const ledger: LedgerEntry[] = [
          {
            kind: "READ",
            text: description,
          },
        ];

        if (best) {
          ledger.push({
            kind: "MATCHED",
            text: `trigger → ${best.eventType} (${best.score})`,
            citation:
              `matched on ${best.matchedOn.map((w) => `"${w}"`).join(", ")} ` +
              `in the catalogue entry: "${best.description}"` +
              (runnerUp
                ? ` · runner-up: ${runnerUp.eventType} (${runnerUp.score})`
                : ""),
            action: "trigger",
          });
        } else {
          ledger.push({
            kind: "SKIPPED",
            text: "No event in the catalogue matches this description",
            citation:
              "Nothing scored above zero against the catalogue's sentences. " +
              "Pick a trigger by hand, or register a new event.",
            action: "trigger",
          });
        }

        for (const c of extracted) {
          ledger.push({
            kind: "SET",
            text: `${c.field} = ${c.value}`,
            citation: `from your words: "${c.phrase}"`,
            action: "config",
          });
        }

        return {
          module,
          description,
          triggerCandidates: ranked,
          suggestedTrigger: best?.eventType ?? null,
          availableNodes: nodeRows.map((n: any) => ({
            key: n.key,
            title: n.title,
            description: n.description,
            sideEffect: n.side_effect,
            source: n.source,
            hasSchemas: Boolean(n.input_schema),
          })),
          extractedConfig: extracted,
          routing: {
            existing: routing.rows.map((r: any) => ({
              graphKey: r.graph_key,
              moduleQueue: r.module_queue,
            })),
            /**
             * Fan-out is not available. A unique index permits one active
             * binding per event, so "also run mine" cannot be written down
             * today — offering it would produce a choice that fails on save.
             */
            fanoutPossible: false,
          },
          ledger,
        };
      });
    } catch (err) {
      req.log?.error?.(err);
      return reply
        .code(500)
        .send({ error: "propose_failed", message: String(err) });
    }
  });

  /**
   * POST /workflows/accept
   * { graphKey, module, triggerEventType, nodes:[{id, impl, config}], description }
   *
   * Creates the DRAFT. It cannot run — the router reads active only — and the
   * trigger travels inside the definition until go-live creates the binding.
   */
  app.post("/workflows/accept", async (req: any, reply: any) => {
    const body = req.body ?? {};
    const graphKey = String(body.graphKey ?? "").trim();
    const triggerEventType = String(body.triggerEventType ?? "").trim();
    const nodes = Array.isArray(body.nodes) ? body.nodes : [];

    if (!/^[a-z0-9]+(\.[a-z0-9-]+)+$/.test(graphKey)) {
      return reply.code(400).send({
        error: "graph_key_convention",
        message: `"${graphKey}" should look like module.thing.workflow — lowercase, dotted.`,
      });
    }
    if (!triggerEventType) {
      return reply.code(400).send({
        error: "trigger_required",
        message:
          "A workflow with no trigger can never run. Choose one, or register a new event.",
      });
    }
    if (nodes.length === 0) {
      return reply
        .code(400)
        .send({ error: "no_steps", message: "A workflow needs at least one step." });
    }

    try {
      return await withOrgScope(pool, readOrgId(req.headers), async (client) => {
        const exists = await client.query(
          `SELECT 1 FROM graph_definitions WHERE graph_key = $1 LIMIT 1`,
          [graphKey],
        );
        if (exists.rowCount) {
          return reply.code(409).send({
            error: "graph_key_taken",
            message: `${graphKey} already exists. Choose another name, or edit the existing workflow.`,
          });
        }

        const edges: Array<[string, string]> = [];
        edges.push(["__start__", nodes[0].id]);
        for (let i = 0; i < nodes.length - 1; i++) {
          edges.push([nodes[i].id, nodes[i + 1].id]);
        }
        edges.push([nodes[nodes.length - 1].id, "__end__"]);

        const definition = {
          graphKey,
          // The trigger lives here because a draft binding cannot be stored —
          // see the header. Go-live reads it to create the binding.
          entryInput: triggerEventType,
          nodes: nodes.map((n: any) => ({
            id: String(n.id),
            impl: String(n.impl),
            config: n.config ?? {},
          })),
          edges,
        };

        await client.query(
          `INSERT INTO graph_definitions
             (id, org_id, graph_key, version, definition, checksum, status, created_by)
           VALUES ($1, NULL, $2, 1, $3::jsonb, $4, 'draft', $5)`,
          [
            `${graphKey}@1`,
            graphKey,
            JSON.stringify(definition),
            checksumOf(definition),
            req.headers["x-admin-id"] ?? "admin-local",
          ],
        );

        return {
          graphKey,
          version: 1,
          status: "draft",
          triggerEventType,
          bindingCreated: false,
          note:
            "Draft created. The binding that makes it run is created at go-live — " +
            "a draft binding cannot be stored, and an active one would put an " +
            "unreviewed workflow into production.",
        };
      });
    } catch (err) {
      req.log?.error?.(err);
      return reply
        .code(500)
        .send({ error: "accept_failed", message: String(err) });
    }
  });
}
