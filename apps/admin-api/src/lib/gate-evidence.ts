/**
 * Evidence for the go-live checks that ask about more than shape.
 *
 * `evaluateGoLiveGate` is a pure function: same input, same verdict, no
 * database, no clock. That is what makes it testable and what stops a check
 * quietly depending on the state of the machine it ran on. But three of its
 * checks need the node registry and the event catalogue:
 *
 *   7  can every step get what it needs
 *   8  is every step one this application may use
 *   9  does any step publish the event that starts this workflow
 *
 * The last is the one that keeps a workflow from restarting itself for ever,
 * and it needs each node's declared `emits`.
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
import { triggerEventFor } from "./trigger-event.js";
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
  selfTrigger?: {
    triggerEventType: string | null;
    emitsByImpl: Map<string, readonly string[]>;
  };
}> {
  try {
    const def = JSON.parse(artifactSource) as {
      entryInput?: string;
      triggerEventType?: string;
      nodes?: Array<{ impl?: string }>;
    };
    /**
     * TWO NAMES FOR THE TRIGGER, AND THIS READ ONLY ONE.
     *
     * `entryInput` is what the seeds and older definitions carry;
     * `triggerEventType` is what the graph contract added and what
     * `/workflows/accept` writes. Neither name appears in both sets, so
     * reading `entryInput` alone meant check 7 reported "not checked" for
     * every workflow created through the current path — the ones most likely
     * to be going live.
     */
    /**
     * NOT `def.triggerEventType ?? def.entryInput`, which is what this read
     * before. Eleven of the twelve live workflows declare neither, so both
     * checks that depend on a trigger — 7, can every step get what it needs,
     * and 9, does a step publish the event that starts this — reported "not
     * checked" on everything in production. `triggerEventFor` asks the active
     * binding, which is what actually decides.
     */
    const trigger = await triggerEventFor(client, { graphKey, definition: def });
    const impls = [
      ...new Set((def.nodes ?? []).map((n) => String(n.impl ?? ""))),
    ].filter(Boolean);
    if (impls.length === 0) return {};

    const { rows } = await client.query(
      `SELECT key, application AS module, shareable, input_schema, emits
         FROM authoring.node_registry WHERE key = ANY($1::text[])`,
      [impls],
    );

    const requiredByImpl = new Map<string, readonly string[]>();
    const moduleByImpl = new Map<string, string>();
    const shareableImpls = new Set<string>();
    /** Node key -> the events it declares it publishes. Check 9 reads this. */
    const emitsByImpl = new Map<string, readonly string[]>();
    for (const r of rows) {
      const key = String(r.key);
      moduleByImpl.set(key, String(r.module));
      if (r.shareable === true) shareableImpls.add(key);
      const required = r.input_schema?.required;
      requiredByImpl.set(key, Array.isArray(required) ? required : []);
      /**
       * `emits` is jsonb and holds either plain strings or declarations with
       * a conditional shape. Only the unconditional ones are a certainty, and
       * a check that blocks go-live has to rest on certainties.
       */
      const emits = Array.isArray(r.emits) ? r.emits : [];
      emitsByImpl.set(
        key,
        emits
          .map((e: unknown) =>
            typeof e === "string" ? e : String((e as any)?.event_type ?? ""),
          )
          .filter(Boolean),
      );
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
    if (trigger) {
      const ev = await client.query(
        `SELECT payload_schema FROM ${EVENT_SCHEMAS} WHERE event_type = $1 LIMIT 1`,
        [trigger],
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
      ...(trigger
        ? { inputs: { triggerDeclared, triggerFields, requiredByImpl } }
        : {}),
      ownership: { graphModule, moduleByImpl, shareableImpls },
      selfTrigger: { triggerEventType: trigger, emitsByImpl },
    };
  } catch {
    return {};
  }
}
