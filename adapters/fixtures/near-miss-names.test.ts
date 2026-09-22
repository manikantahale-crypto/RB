/**
 * A field one node produces and another reads, spelled two ways.
 *
 * Input maps are worked out from declared names: a step needing `thread_id`
 * gets wired to an upstream step whose declared output has that name. The
 * matching is exact and refuses to guess, because a rename it guessed wrong
 * sends the wrong candidate's profile to a vendor.
 *
 * Which leaves one failure mode, and it is silent. `prism.consent.record`
 * reads `thread_id`; `relay.consent.remind` returns `threadId`. Same thing,
 * two spellings, so nothing wires, no check complains, and the workflow simply
 * cannot be built — you find out when a step fails its own input schema on the
 * first real event.
 *
 * Seven of these existed when this was written, and they were not obscure —
 * `threadId`/`thread_id`, `messageId`/`message_id` and
 * `maskedProfile`/`masked_profile` are the whole RELAY-to-PRISM submission
 * path.
 *
 * THE FIX IS TO DECLARE, NOT TO GUESS. A node that will accept both spellings
 * says so, as an optional sibling field, and reads it through its module's
 * `fields.ts` helper — the convention `jobId`/`requirement_id`/`requirementId`
 * has followed all along. Then the wiring is earned by a declaration and the
 * definition still says exactly where every value came from.
 */
import { describe, expect, it } from "vitest";
import { declaredNodes, nodeContracts } from "../index.js";

/** The property names of a zod object, through whatever wraps it. */
function fieldsOf(schema: unknown): string[] {
  let s = schema as any;
  for (let i = 0; i < 10 && s; i++) {
    if (s.shape) return Object.keys(s.shape);
    s = s._def?.schema ?? s._def?.innerType ?? s.innerType ?? null;
  }
  return [];
}

/** `masked_profile` and `maskedProfile` are the same name written twice. */
const sameName = (field: string) => field.toLowerCase().replace(/_/g, "");

type Spelling = { field: string; key: string };

function collect(pick: (c: any) => unknown): Map<string, Spelling[]> {
  const out = new Map<string, Spelling[]>();
  for (const contract of [...nodeContracts, ...declaredNodes] as any[]) {
    for (const field of fieldsOf(pick(contract))) {
      const bucket = out.get(sameName(field)) ?? [];
      bucket.push({ field, key: contract.key });
      out.set(sameName(field), bucket);
    }
  }
  return out;
}

describe("a produced field and a read field that are the same name spelled two ways", () => {
  it("is always declared by somebody, so the wiring can be made", () => {
    const produced = collect((c) => c.output);
    const read = collect((c) => c.input);

    const nearMisses: string[] = [];
    for (const [name, producers] of produced) {
      const readers = read.get(name);
      if (!readers) continue;

      const producedAs = new Set(producers.map((p) => p.field));
      const readAs = new Set(readers.map((r) => r.field));
      // One node somewhere accepts a spelling some node produces: declared.
      if ([...producedAs].some((f) => readAs.has(f))) continue;

      nearMisses.push(
        `${name}: produced as ${[...producedAs].join("/")} by ` +
          `${[...new Set(producers.map((p) => p.key))].join(", ")}; ` +
          `read as ${[...readAs].join("/")} by ` +
          `${[...new Set(readers.map((r) => r.key))].join(", ")}`,
      );
    }

    expect(
      nearMisses,
      "These can never be wired — the names do not match and inference will " +
        "not guess a rename. Declare the other spelling as an optional field " +
        "on the reading node and read it through its module's fields.ts:\n  " +
        nearMisses.join("\n  "),
    ).toEqual([]);
  });
});
