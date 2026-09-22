/**
 * The declarations behind the inference, fetched.
 *
 * `inferInputMaps` is pure — it takes what each node produces, what each node
 * reads, and what the trigger carries, and works out the maps. This is where
 * those three come from: `authoring.node_registry`, which is materialized from
 * the contracts in git, and the event catalogue. Exactly the sources
 * `collectGateEvidence` reads for check 7, so the inference and the check that
 * judges it are looking at the same facts.
 *
 * ON FAILURE THE DEFINITION IS RETURNED UNCHANGED. This runs on the path that
 * saves a working copy, and a save must not fail because a lookup did. The
 * cost of returning early is that the author sees unmapped fields — the state
 * they were in before this existed — and the gate says so in their words at
 * go-live. The cost of throwing is losing what somebody just typed.
 */
import { inferInputMaps, type WiredInput } from "@tekisho/authoring";
import type { GraphDefinition } from "@tekisho/graph-contract";

import { EVENT_SCHEMAS } from "./authoring-views.js";
import { triggerEventFor } from "./trigger-event.js";

type Client = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
};

/** Property names a JSON Schema object declares, in declaration order. */
function propertiesOf(schema: unknown): string[] {
  const props = (schema as { properties?: Record<string, unknown> } | null)
    ?.properties;
  return props && typeof props === "object" ? Object.keys(props) : [];
}

export async function inferInputsForGraph(
  client: Client,
  definition: unknown,
  graphKey: string,
  orgId?: string | null,
): Promise<{ definition: unknown; wired: WiredInput[] }> {
  const unchanged = { definition, wired: [] as WiredInput[] };
  try {
    const def = definition as GraphDefinition & {
      entryInput?: string;
      triggerEventType?: string;
    };
    if (!Array.isArray(def?.nodes) || !Array.isArray(def?.edges)) return unchanged;

    const impls = [...new Set(def.nodes.map((n) => String(n.impl ?? "")))].filter(
      Boolean,
    );
    if (impls.length === 0) return unchanged;

    const { rows } = await client.query(
      `SELECT key, input_schema, output_schema
         FROM authoring.node_registry WHERE key = ANY($1::text[])`,
      [impls],
    );

    const inputsByImpl = new Map<string, readonly string[]>();
    const outputsByImpl = new Map<string, readonly string[]>();
    for (const r of rows) {
      const key = String(r.key);
      inputsByImpl.set(key, propertiesOf(r.input_schema));
      outputsByImpl.set(key, propertiesOf(r.output_schema));
    }
    // Nothing declares an output: there is nothing to wire from, and running
    // the inference would only churn the checksum.
    if ([...outputsByImpl.values()].every((o) => o.length === 0)) return unchanged;

    /**
     * From the binding when the definition does not say, which is eleven of
     * the twelve live workflows. It matters here as much as at the gate:
     * without it, inference cannot tell "the trigger already carries this"
     * from "nothing provides this", and maps a field that was going to arrive
     * anyway.
     */
    const trigger = await triggerEventFor(client, {
      graphKey,
      orgId,
      definition: def,
    });
    let triggerFields: string[] = [];
    if (trigger) {
      const ev = await client.query(
        `SELECT payload_schema FROM ${EVENT_SCHEMAS} WHERE event_type = $1 LIMIT 1`,
        [trigger],
      );
      triggerFields = propertiesOf(ev.rows[0]?.payload_schema);
    }

    const out = inferInputMaps({
      def,
      inputsByImpl,
      outputsByImpl,
      triggerFields,
    });
    return { definition: out.def, wired: out.wired };
  } catch {
    return unchanged;
  }
}
