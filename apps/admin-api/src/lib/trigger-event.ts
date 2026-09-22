/**
 * What event starts this workflow — asked of the thing that actually decides.
 *
 * A definition may name its trigger in `triggerEventType`, and the workflows
 * created through `/workflows/accept` do. ELEVEN OF THE TWELVE LIVE TODAY DO
 * NOT, and the twelfth says `entryInput: "ResumeReceivedPayload"` — a payload
 * TYPE name, not an event type, so it matches nothing in the catalogue.
 *
 * Nothing broke, because the runtime never reads it: the ingress router routes
 * by binding, and the binding is what really decides which workflow an event
 * starts. But two of the go-live checks read it, and both go quiet without it:
 *
 *   7  can every step get what it needs — skipped entirely, because without a
 *      trigger there is nothing to check availability against
 *   9  does any step publish the event that starts this workflow — the guard
 *      against a workflow restarting itself for ever, blind for the same reason
 *
 * So the one check about data and the one check about runaway loops have never
 * run on anything live. And the input maps are now worked out against the
 * trigger's fields, so inference could not tell "the trigger already carries
 * this" from "nothing provides this" either.
 *
 * THE BINDING IS THE AUTHORITY, not a fallback. `authoring.event_bindings`
 * says which event reaches which graph, and that is the definition of what
 * starts a workflow. A field in the definition repeating it is a copy that can
 * drift — and has, in eleven of twelve rows. So the declared value is used
 * only when it names a real event, and otherwise the binding is asked.
 */
import { EVENT_SCHEMAS } from "./authoring-views.js";

type Client = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
};

export async function triggerEventFor(
  client: Client,
  args: { graphKey: string; orgId?: string | null; definition?: unknown },
): Promise<string | null> {
  const def = args.definition as
    | { triggerEventType?: string; entryInput?: string }
    | null
    | undefined;
  const declared = def?.triggerEventType ?? def?.entryInput ?? null;

  if (declared) {
    const { rows } = await client.query(
      `SELECT 1 FROM ${EVENT_SCHEMAS} WHERE event_type = $1 LIMIT 1`,
      [declared],
    );
    if (rows[0]) return declared;
    // Named something the catalogue does not have — `ResumeReceivedPayload`
    // is the live example. Fall through rather than trust it.
  }

  const { rows } = await client.query(
    `SELECT b.event_type
       FROM authoring.event_bindings b
       JOIN authoring.graphs g ON g.id = b.graph_id
      WHERE g.graph_key = $1
        AND b.status = 'active'
        AND ($2::uuid IS NULL OR b.org_id IS NOT DISTINCT FROM $2::uuid)
      ORDER BY b.updated_at DESC NULLS LAST
      LIMIT 1`,
    [args.graphKey, args.orgId ?? null],
  );
  return rows[0]?.event_type ? String(rows[0].event_type) : null;
}
