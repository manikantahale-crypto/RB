import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  contractFilePath,
  adminExposedFields,
  checksumOf,
  defineNode,
  fixtureMatchMode,
  isEditorTestable,
  registryKey,
  requiresAllowlist,
  resolveEmits,
  toRegistryRow,
  type AnyNodeContract,
} from "./node-contract.js";

/**
 * A minimal valid contract. Each test spreads this and breaks exactly one
 * thing, so the assertion is about that one rule.
 */
const valid = () => ({
  key: "platform.test.node",
  version: "1.0.0",
  module: "platform" as const,
  shareable: false,
  title: "Test node",
  description: "A deliberately boring node used to exercise the contract.",
  tags: [],
  input: z.object({ id: z.string() }),
  output: z.object({ ok: z.boolean() }),
  config: z.object({ threshold: z.number() }),
  emits: [],
  sideEffect: "read" as const,
  idempotency: { strategy: "pure" as const },
  execution: {
    timeoutMs: 1000,
    retry: { limit: 0, backoff: "none" as const, baseMs: 1 },
    classifyError: () => "permanent_system" as const,
    locks: [],
  },
  dependencies: [],
  persistence: {
    storeInput: "full" as const,
    storeOutput: "full" as const,
    redactPaths: [],
  },
  fixtures: [
    { name: "ok", input: { id: "a" }, config: { threshold: 1 }, expectedOutput: { ok: true } },
  ],
  run: async () => ({ ok: true }),
});

const define = (patch: Record<string, unknown>) =>
  defineNode({ ...valid(), ...patch } as never);

describe("a valid contract", () => {
  it("is accepted and returned unchanged", () => {
    const node = defineNode(valid());
    expect(node.key).toBe("platform.test.node");
  });
});

describe("rule 1 — an llm dependency and a budget travel together", () => {
  it("rejects an llm dependency with no budget", () => {
    expect(() => define({ dependencies: ["llm"], stub: () => ({ ok: true }) })).toThrow(
      /a token\/USD budget is mandatory/,
    );
  });

  it("rejects a budget with no llm dependency", () => {
    expect(() =>
      define({ llm: { budget: { maxTokensPerRun: 1000, maxUSDPerRun: 0.5 } } }),
    ).toThrow(/declares an llm budget but not the "llm" dependency/);
  });

  it("accepts both together", () => {
    expect(() =>
      define({
        dependencies: ["llm"],
        llm: { budget: { maxTokensPerRun: 1000, maxUSDPerRun: 0.5 } },
        stub: () => ({ ok: true }),
      }),
    ).not.toThrow();
  });
});

describe("rule 2 — anything CI must stub needs a stub", () => {
  it("rejects an llm node with no stub", () => {
    expect(() =>
      define({
        dependencies: ["llm"],
        llm: { budget: { maxTokensPerRun: 1000, maxUSDPerRun: 0.5 } },
      }),
    ).toThrow(/a stub is required so CI never calls it for real/);
  });

  it("rejects an external-api node with no stub", () => {
    expect(() => define({ dependencies: ["external-api"] })).toThrow(
      /a stub is required so CI never calls it for real/,
    );
  });

  it("does not demand a stub for db or http", () => {
    expect(() => define({ dependencies: ["db", "http"] })).not.toThrow();
  });
});

describe("rule 3 — a node that changes the world cannot be pure", () => {
  it.each(["internal_write", "external", "financial"] as const)(
    "rejects sideEffect %s with idempotency pure",
    (sideEffect) => {
      expect(() => define({ sideEffect })).toThrow(
        /it cannot be "pure". The node boundary is the retry boundary/,
      );
    },
  );

  it("accepts a writing node that names its natural key", () => {
    expect(() =>
      define({
        sideEffect: "internal_write",
        idempotency: { strategy: "natural_key", keyPaths: ["id"] },
      }),
    ).not.toThrow();
  });

  it("rejects a natural_key strategy that names no key", () => {
    expect(() =>
      define({
        sideEffect: "internal_write",
        idempotency: { strategy: "natural_key", keyPaths: [] },
      }),
    ).toThrow(/NODE_CONTRACT_INVALID/);
  });

  it("leaves read and control alone", () => {
    expect(() => define({ sideEffect: "control" })).not.toThrow();
  });
});

describe("rule 4 — redact mode and redactPaths travel together", () => {
  it("rejects redact mode with no paths", () => {
    expect(() =>
      define({
        persistence: { storeInput: "redact", storeOutput: "full", redactPaths: [] },
      }),
    ).toThrow(/run detail would render everything/);
  });

  it("rejects paths with no redact mode", () => {
    expect(() =>
      define({
        persistence: { storeInput: "full", storeOutput: "full", redactPaths: ["id"] },
      }),
    ).toThrow(/neither store mode is "redact"/);
  });

  it("accepts them together", () => {
    expect(() =>
      define({
        persistence: {
          storeInput: "redact",
          storeOutput: "full",
          redactPaths: ["resumeText"],
        },
      }),
    ).not.toThrow();
  });
});

describe("fixtures", () => {
  it("requires at least one", () => {
    expect(() => define({ fixtures: [] })).toThrow(/at least one fixture is required/);
  });

  it("names the node, the fixture and the field when one does not match", () => {
    expect(() =>
      define({
        fixtures: [
          {
            name: "broken",
            input: { id: 42 },
            config: { threshold: 1 },
            expectedOutput: { ok: true },
          },
        ],
      }),
    ).toThrow(/platform\.test\.node fixture\[0\] "broken" input/);
  });

  it("checks expectedOutput against the output schema too", () => {
    expect(() =>
      define({
        fixtures: [
          {
            name: "broken output",
            input: { id: "a" },
            config: { threshold: 1 },
            expectedOutput: { ok: "yes" },
          },
        ],
      }),
    ).toThrow(/expectedOutput/);
  });
});

describe("error messages", () => {
  it("names the node and every offending field at once", () => {
    let message = "";
    try {
      define({ dependencies: ["llm"], sideEffect: "external" });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain("NODE_CONTRACT_INVALID: platform.test.node");
    expect(message).toContain("llm:");
    expect(message).toContain("stub:");
    expect(message).toContain("idempotency.strategy:");
  });
});

describe("projections", () => {
  it("derives the registry key from the major version only", () => {
    expect(registryKey({ key: "human.gate", version: "2.4.1" })).toBe("human.gate@2");
  });

  it("derives editor testability and the allowlist from sideEffect", () => {
    expect(isEditorTestable({ sideEffect: "read" })).toBe(true);
    expect(isEditorTestable({ sideEffect: "external" })).toBe(false);
    expect(requiresAllowlist({ sideEffect: "financial" })).toBe(true);
    expect(requiresAllowlist({ sideEffect: "internal_write" })).toBe(false);
  });

  it("derives fixture match mode from the llm dependency", () => {
    expect(fixtureMatchMode({ dependencies: [] })).toBe("exact");
    expect(fixtureMatchMode({ dependencies: ["llm"] })).toBe("shape");
  });

  it("reads adminExposed from the config field, not a parallel list", () => {
    const node = defineNode({
      ...valid(),
      config: z.object({
        threshold: z.number().meta({ adminExposed: true }),
        internalRetryHint: z.number(),
      }),
      fixtures: [
        {
          name: "ok",
          input: { id: "a" },
          config: { threshold: 1, internalRetryHint: 2 },
          expectedOutput: { ok: true },
        },
      ],
    });
    expect(adminExposedFields(node as AnyNodeContract)).toEqual(["threshold"]);
  });
});

describe("the serializable half", () => {
  it("drops the functions and keeps the shapes", () => {
    const row = toRegistryRow(defineNode(valid()) as AnyNodeContract);
    expect(row.registry_key).toBe("platform.test.node@1");
    expect(row.has_stub).toBe(false);
    expect(row.fixture_names).toEqual(["ok"]);
    expect(row.input_schema).toMatchObject({ type: "object" });
    expect(row.execution).not.toHaveProperty("classifyError");
    expect(JSON.stringify(row)).toBeTypeOf("string");
  });

  it("checksums stably regardless of key order", () => {
    expect(checksumOf({ a: 1, b: { c: 2, d: 3 } })).toBe(
      checksumOf({ b: { d: 3, c: 2 }, a: 1 }),
    );
  });

  it("changes the checksum when a declared value changes", () => {
    const base = toRegistryRow(defineNode(valid()) as AnyNodeContract);
    const bumped = toRegistryRow(
      defineNode({ ...valid(), title: "Renamed" }) as AnyNodeContract,
    );
    expect(checksumOf(base)).not.toBe(checksumOf(bumped));
  });

  it("does not change the checksum when only behaviour changes", () => {
    const a = toRegistryRow(defineNode(valid()) as AnyNodeContract);
    const b = toRegistryRow(
      defineNode({
        ...valid(),
        execution: {
          ...valid().execution,
          classifyError: () => "transient" as const,
        },
      }) as AnyNodeContract,
    );
    expect(checksumOf(a)).toBe(checksumOf(b));
  });
});

describe("emits — what a node says it may publish", () => {
  it("is required, because silence and no answer are different things", () => {
    // `[]` means "publishes nothing". An absent field means nobody has said.
    // A default would collapse the two, and every legacy node would start
    // claiming it publishes nothing — which is exactly the false negative
    // this field exists to remove.
    const { emits, ...withoutEmits } = valid();
    expect(() => defineNode(withoutEmits as never)).toThrow();
  });

  it("accepts a fixed event type", () => {
    const node = define({ emits: ["syntra.jd.parsed"] });
    expect(node.emits).toEqual(["syntra.jd.parsed"]);
  });

  it("accepts an event named by a config field", () => {
    // How `astra.route.decision` works: the author picks the event at design
    // time, so the node knows the setting's name but not the value.
    const node = define({ emits: [{ fromConfig: "onActionable" }] });
    expect(node.emits).toEqual([{ fromConfig: "onActionable" }]);
  });

  it("rejects an empty event type", () => {
    expect(() => define({ emits: [""] })).toThrow();
  });
});

describe("resolveEmits", () => {
  it("returns fixed events as they are", () => {
    expect(resolveEmits(["syntra.jd.parsed"], {})).toEqual(["syntra.jd.parsed"]);
  });

  it("reads a config-named event from the settings", () => {
    expect(
      resolveEmits([{ fromConfig: "onActionable" }], {
        onActionable: "syntra.jd.normalized",
      }),
    ).toEqual(["syntra.jd.normalized"]);
  });

  it("drops a config-named event whose setting is unset", () => {
    // An optional exit nobody wired is ordinary, not an error — and must not
    // contribute an empty event type that would match nothing or everything.
    expect(resolveEmits([{ fromConfig: "onRejected" }], {})).toEqual([]);
    expect(resolveEmits([{ fromConfig: "onRejected" }], { onRejected: "" })).toEqual([]);
  });

  it("ignores a setting that is not a string", () => {
    expect(resolveEmits([{ fromConfig: "passMin" }], { passMin: 0.6 })).toEqual([]);
  });

  it("does not report the same event twice", () => {
    // A node can reach the same event two ways — a fixed emit and a config
    // pointing at it. Callers ask "can this publish X", so once is enough.
    expect(
      resolveEmits(["syntra.match.completed", { fromConfig: "onDone" }], {
        onDone: "syntra.match.completed",
      }),
    ).toEqual(["syntra.match.completed"]);
  });

  it("treats an undeclared node as publishing nothing knowable", () => {
    expect(resolveEmits(undefined, { onActionable: "x" })).toEqual([]);
  });
});

describe("contractFilePath", () => {
  it("derives the path from module and the last two key segments", () => {
    expect(
      contractFilePath({ key: "syntra.duplicate.detect", module: "syntra" }),
    ).toBe("syntra/nodes/duplicate-detect.node.ts");
  });

  it("uses `module`, not the key's first segment", () => {
    // orch.branch.decision lives in platform/ and drops `orch` entirely. A rule
    // written from the SYNTRA nodes alone — "key minus its module" — rejects it.
    expect(
      contractFilePath({ key: "orch.branch.decision", module: "platform" }),
    ).toBe("platform/nodes/branch-decision.node.ts");
  });

  it("handles a two-segment key", () => {
    expect(contractFilePath({ key: "human.gate", module: "platform" })).toBe(
      "platform/nodes/human-gate.node.ts",
    );
  });

  it("agrees with every contract currently in the tree", () => {
    // The nine SYNTRA nodes, where the last two segments and "key minus
    // module" happen to coincide.
    expect(contractFilePath({ key: "syntra.run.retry", module: "syntra" })).toBe(
      "syntra/nodes/run-retry.node.ts",
    );
    expect(
      contractFilePath({ key: "syntra.shortlist.notify", module: "syntra" }),
    ).toBe("syntra/nodes/shortlist-notify.node.ts");
  });
});
