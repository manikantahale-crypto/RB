/**
 * Evidence for the two go-live checks that ask about more than shape.
 *
 * `evaluateGoLiveGate` is a pure function: same input, same verdict, no
 * database, no clock. That is what makes it testable and what stops a check
 * quietly depending on the state of the machine it ran on. But checks 7 and 8
 * — can every step get what it needs, and is every step one this application
 * is allowed to use — need the node registry and the trigger's payload schema.
 *
 * So the lookups happen here and are handed in.
 *
 * WHEN A LOOKUP FAILS, THE BLOB IS LEFT OUT and the gate reports "not checked"
 * rather than passing. A check that goes quiet when it cannot see is worse than
 * no check, because it reads exactly like a pass.
 *
 * Extracted from `routes/agents.ts`, where it was reachable only by the agent
 * path. Nothing about it was agent-specific — it takes a definition and a
 * graph key — so the workflow checks screen could not use it purely because of
 * where it happened to live.
 */
import { MODULES } from "@tekisho/node-contract";

import { EVENT_SCHEMAS } from "./authoring-views.js";
export async function collectGateEvidence(
  client: { query: (t: string, p?: unknown[]) => Promise<{ rows: any[] }> },
  artifactSource: string,
  graphKey: string,
): Promise<{
  inputs?: {
    /** False when the event schema declares no payload properties. */
    triggerDeclared: boolean;
    triggerFields: readonly string[];
    requiredByImpl: Map<string, readonly string[]>;
  };
  ownership?: {
    /** Null when the graph key does not name a known application. */
    graphModule: string | null;
    moduleByImpl: Map<string, string>;
    shareableImpls: Set<string>;
  };
}> {
  try {
    const def = JSON.parse(artifactSource) as {
      entryInput?: string;
      nodes?: Array<{ impl?: string }>;
    };
    const impls = [
      ...new Set((def.nodes ?? []).map((n) => String(n.impl ?? ""))),
    ].filter(Boolean);
    if (impls.length === 0) return {};

    const { rows } = await client.query(
      `SELECT key, module, shareable, input_schema
         FROM authoring.node_registry WHERE key = ANY($1::text[])`,
      [impls],
    );

    const requiredByImpl = new Map<string, readonly string[]>();
    const moduleByImpl = new Map<string, string>();
    const shareableImpls = new Set<string>();
    for (const r of rows) {
      const key = String(r.key);
      moduleByImpl.set(key, String(r.module));
      if (r.shareable === true) shareableImpls.add(key);
      const required = r.input_schema?.required;
      requiredByImpl.set(key, Array.isArray(required) ? required : []);
    }

    /**
     * Which application owns this workflow.
     *
     * The first segment of the key IF it names a real application, and null
     * otherwise. Splitting on a dot and trusting the result read
     * `duplicate.review` as belonging to an application called "duplicate",
     * which made every SYNTRA step inside it look like a boundary crossing — a
     * check producing false findings is worse than no check.
     *
     * The known set comes from `node_registry`, which is materialized from the
     * module registry in git. That is the same authority the editor's palette
     * uses, reached the way this layer reaches everything else.
     */
    /**
     * FROM THE MODULE REGISTRY, NOT FROM `node_registry`.
     *
     * The obvious shortcut is `SELECT DISTINCT module FROM authoring.node_registry`, and
     * it is wrong: that column names the module a NODE belongs to, so an
     * application with no declared nodes never appears. RELAY has none — so
     * relay would not have counted as an application, and the one real
     * boundary crossing in production is `relay.intake.workflow` using a
     * private ASTRA node. The check would have stopped seeing the very thing
     * it was written for.
     */
    const head = graphKey.split(".")[0] ?? "";
    const graphModule = (MODULES as readonly string[]).includes(head)
      ? head
      : null;

    let triggerFields: string[] = [];
    let triggerDeclared = false;
    if (def.entryInput) {
      const ev = await client.query(
        `SELECT payload_schema FROM ${EVENT_SCHEMAS} WHERE event_type = $1 LIMIT 1`,
        [def.entryInput],
      );
      const props = ev.rows[0]?.payload_schema?.properties;
      triggerFields = Object.keys(props ?? {});
      // An empty schema is an event nobody described, not an event that
      // carries nothing. Eight are like that today.
      triggerDeclared = triggerFields.length > 0;
    }

    return {
      // Without a trigger there is nothing to check availability against, and
      // claiming every field is missing would be noise, not a finding.
      ...(def.entryInput
        ? { inputs: { triggerDeclared, triggerFields, requiredByImpl } }
        : {}),
      ownership: { graphModule, moduleByImpl, shareableImpls },
    };
  } catch {
    return {};
  }
}
