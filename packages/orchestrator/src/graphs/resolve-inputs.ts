/**
 * Resolving a step's declared input sources against the run context.
 *
 * A step may say where each of its inputs comes from:
 *
 *     { "jobId": "trigger.requirement_id", "resumeId": "process.resumeId" }
 *
 * `trigger.<field>` reads the event that started the run. `<step>.<field>`
 * reads an earlier step's declared output out of `state.steps`. Either may be
 * followed by a path into the value — `send.consent_threads.0.thread_id` —
 * which is the only thing a map can do beyond naming a field, and deliberately
 * so: the moment a map can transform, it is code, and the definition stops
 * being readable and checkable, which is the whole reason it exists.
 *
 * MERGED INTO THE PAYLOAD, NOT SUBSTITUTED FOR IT.
 *
 * Every node in this system builds its input from the trigger payload, and 29
 * live workflows depend on that. If a map replaced the payload, the first
 * workflow to gain a partial map would break — it would lose the trigger
 * fields it never thought to declare, having worked for months. So the map
 * ADDS: the trigger is the floor, and a source names something extra, or
 * renames a trigger field into what the node actually calls it.
 *
 * The cost is worth naming: a step whose map omits a field can still receive
 * that field from the trigger by luck. So the viability check must count
 * availability as "trigger fields PLUS mapped fields" rather than treating the
 * map as the whole truth. That is the honest sum either way, and it is what
 * makes this safe to turn on for graphs that already exist.
 */
import { parseInputSource } from '@tekisho/graph-contract';
import type { SyntraGraphState } from '../nodes/types.js';

export type ResolvedInputs = {
  /** Field name → the value found for it. Only fields that resolved. */
  values: Record<string, unknown>;
  /**
   * Fields whose source did not resolve — a step on a branch that was not
   * taken, or a field the producing step left out.
   *
   * Not an error here. A node declaring the field optional can cope, and one
   * declaring it required will fail its own input schema a moment later with a
   * better message than this file could write. Reported so the caller can log
   * it rather than have it vanish.
   */
  unresolved: string[];
};

/**
 * Walk the segments after the field, if there are any.
 *
 * Array indices are the same syntax as keys — `consent_threads.0.thread_id` —
 * because a JSON array indexed by a string works, and inventing a bracket
 * syntax would mean a second thing to parse for no gain.
 *
 * Anything missing on the way down returns undefined, which the caller reports
 * as unresolved rather than writing in. A step cannot tell the difference
 * between a field nobody mapped and one mapped to nothing, and neither can its
 * schema.
 */
function walk(value: unknown, path: readonly string[]): unknown {
  let at = value;
  for (const segment of path) {
    if (at === null || typeof at !== 'object') return undefined;
    at = (at as Record<string, unknown>)[segment];
  }
  return at;
}

/** Read one source path out of the run context. */
function valueAt(state: SyntraGraphState, path: string): unknown {
  const parsed = parseInputSource(path);
  if (!parsed.ok) return undefined;

  if (parsed.source.kind === 'trigger') {
    const payload = (state.trigger_event?.payload ?? {}) as Record<string, unknown>;
    return walk(payload[parsed.source.field], parsed.source.path);
  }

  const step = (state.steps ?? {})[parsed.source.stepId];
  if (!step || typeof step !== 'object') return undefined;
  return walk((step as Record<string, unknown>)[parsed.source.field], parsed.source.path);
}

/**
 * Resolve a step's map. Returns only what was found — a source that resolved
 * to `undefined` is left out rather than written as `undefined`, so a node
 * cannot tell the difference between "not mapped" and "mapped to nothing",
 * and neither can its schema.
 */
export function resolveInputs(
  state: SyntraGraphState,
  inputs: Record<string, string> | undefined,
): ResolvedInputs {
  const values: Record<string, unknown> = {};
  const unresolved: string[] = [];
  for (const [field, path] of Object.entries(inputs ?? {})) {
    const v = valueAt(state, path);
    if (v === undefined) unresolved.push(`${field} ← ${path}`);
    else values[field] = v;
  }
  return { values, unresolved };
}

/**
 * The state a step actually runs against: the same one, with its resolved
 * inputs merged into the trigger payload.
 *
 * Returned as a new object. Mutating the state LangGraph handed us would leak
 * one step's mapping into the next, which is the opposite of what a per-step
 * map is for.
 */
export function withResolvedInputs(
  state: SyntraGraphState,
  inputs: Record<string, string> | undefined,
): { state: SyntraGraphState; unresolved: string[] } {
  if (!inputs || Object.keys(inputs).length === 0) {
    return { state, unresolved: [] };
  }
  const { values, unresolved } = resolveInputs(state, inputs);
  if (Object.keys(values).length === 0) return { state, unresolved };

  return {
    unresolved,
    state: {
      ...state,
      trigger_event: state.trigger_event
        ? {
            ...state.trigger_event,
            payload: { ...(state.trigger_event.payload ?? {}), ...values },
          }
        : state.trigger_event,
    },
  };
}
