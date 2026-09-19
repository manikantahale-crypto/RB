/**
 * The worked examples, actually run.
 *
 * Every contract carries fixtures, and until now nothing executed them — the
 * August branch report listed "nothing runs the worked examples" and it
 * stayed true. This is the runner.
 *
 * Two levels, decided by what the node declares (the contract says
 * comparison is derived from `dependencies`, never declared):
 *
 *   - a node with NO dependencies is run for real and its output must equal
 *     `expectedOutput` exactly — there is nothing to stub and no excuse
 *   - a node with dependencies is not run here (its `http` call would leave
 *     the machine); instead each fixture's input and config must satisfy the
 *     node's own declared schemas, and its expectedOutput the output schema.
 *     A fixture that does not fit its own contract proves nothing.
 *
 * A contract in `declaredNodes` is a declaration whose `run` throws on
 * purpose; only its shapes are checked.
 */
import { describe, expect, it } from "vitest";
import type { NodeRunCtx } from "@tekisho/node-contract";
import { declaredNodes, nodeContracts } from "../index.js";

const quiet: NodeRunCtx = {
  orgId: "00000000-0000-0000-0000-000000000001",
  logger: { info: () => {}, error: () => {} },
  emit: () => {},
};

type AnyContract = (typeof nodeContracts)[number] | (typeof declaredNodes)[number];

function parse(schema: { safeParse: (v: unknown) => any }, value: unknown, where: string) {
  const r = schema.safeParse(value);
  if (!r.success) {
    const issues = (r.error?.issues ?? []) as Array<{ path: unknown[]; message: string }>;
    throw new Error(
      `${where}: ${issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`,
    );
  }
  return r.data;
}

for (const contract of [...nodeContracts, ...declaredNodes] as AnyContract[]) {
  const runnable =
    (contract.dependencies ?? []).length === 0 &&
    (nodeContracts as readonly AnyContract[]).includes(contract);

  describe(`${contract.key} — ${contract.fixtures.length} worked example(s)`, () => {
    for (const fixture of contract.fixtures) {
      it(fixture.name, async () => {
        const input = parse(contract.input, fixture.input, `${contract.key} fixture input`);
        const config = parse(contract.config, fixture.config, `${contract.key} fixture config`);
        parse(contract.output, fixture.expectedOutput, `${contract.key} fixture expectedOutput`);

        if (!runnable) return;

        const output = await contract.run(quiet, input as never, config as never);
        expect(output).toEqual(fixture.expectedOutput);
      });
    }
  });
}
