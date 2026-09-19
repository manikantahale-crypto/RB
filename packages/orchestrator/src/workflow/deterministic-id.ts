/**
 * An emitted event's id is a function of where it was emitted from.
 *
 * WHY. A step that emits and is then run again — pg-boss retrying the job
 * after a later step failed, an event delivered twice, a node whose
 * idempotency guard could not reach its store — emits again. With a random
 * id each time, the outbox takes both, the relay publishes both, and two
 * workflows start where one was meant. `human.gate` was the live case: a
 * re-run gate asked for approval twice.
 *
 * With the id derived from (run, step, event type, position), the second
 * emission is the SAME event, the outbox's UNIQUE (event_id) refuses it, and
 * `persistEvents` says so instead of failing (runner.ts, ON CONFLICT DO
 * NOTHING). Nothing else changes: the id is still a UUID, still unique across
 * runs, still unguessable without the inputs.
 *
 * The "run" here is the LangGraph thread — `org:trigger_event_id` — not the
 * orch.runs row, because a run may have no row (audit tables unreachable) and
 * the thread is what a retry shares with its first attempt.
 *
 * RFC 4122 version 5: SHA-1 of a namespace plus the name, with the version
 * and variant bits set. The namespace is fixed and ours; it only has to be
 * stable.
 */
import { createHash } from 'node:crypto';

/** Fixed namespace for this platform's emitted events. Never change it. */
const EVENT_NAMESPACE = '5b2e6f1c-3d0a-4c7e-9a8b-0e1f2a3b4c5d';

function uuidToBytes(uuid: string): Buffer {
  return Buffer.from(uuid.replace(/-/g, ''), 'hex');
}

function bytesToUuid(b: Buffer): string {
  const hex = b.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** UUID v5 of `name` under our namespace. */
export function uuidV5(name: string): string {
  const hash = createHash('sha1')
    .update(uuidToBytes(EVENT_NAMESPACE))
    .update(name, 'utf8')
    .digest();
  const b = Buffer.from(hash.subarray(0, 16));
  b[6] = (b[6]! & 0x0f) | 0x50; // version 5
  b[8] = (b[8]! & 0x3f) | 0x80; // RFC 4122 variant
  return bytesToUuid(b);
}

/**
 * The id for the `index`-th event of `eventType` that step `nodeId` emits in
 * run `runKey`. Same inputs, same id — that is the whole point.
 */
export function deterministicEventId(args: {
  runKey: string;
  nodeId: string;
  eventType: string;
  index: number;
}): string {
  return uuidV5(`${args.runKey}|${args.nodeId}|${args.eventType}|${args.index}`);
}
