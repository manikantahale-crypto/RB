import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  adminExposedFields,
  checksumOf,
  defineNode,
  fixtureMatchMode,
  isEditorTestable,
  registryKey,
  requiresAllowlist,
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
