/**
 * Describe a node to a model using the schema the RUNTIME enforces.
 *
 * WHY THIS REPLACES THE HAND-WRITTEN CATALOGUE.
 *
 * `tool-registry.ts` describes each node in prose that somebody typed. The
 * node contract declares the same thing in a schema the bridge parses on every
 * run. They have drifted, and the drift is not cosmetic — for
 * `syntra.match.process` the prose says `jobId` is required when it is
 * optional, and never mentions `requirement_id`, which is the field the live
 * ASTRA handoff actually carries.
 *
 * A model told the wrong field names produces a graph that is structurally
 * valid, passes every check, and cannot carry data between its steps. So the
 * description it reads is generated from `node_registry` — the same rows the
 * editor's palette and settings panel are projections of — and the prose
 * catalogue is left to supply only what a contract cannot yet express.
 */

/**
 * A JSON Schema, only as far as anything here looks into one.
 *
 * Open on purpose. A stored schema carries plenty this does not read —
 * `$schema`, `additionalProperties`, `minLength`, `format` — and a closed type
 * would mean a real registry row could not even be written down as a literal.
 * The named fields are the ones that reach the prompt; the rest travel
 * untouched.
 */
export type SchemaLike = {
  [keyword: string]: unknown;
  type?: string;
  properties?: Record<string, SchemaLike>;
  required?: string[];
  items?: SchemaLike;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  default?: unknown;
  description?: string;
  label?: string;
  adminExposed?: boolean;
  anyOf?: SchemaLike[];
};

export type PromptNode = {
  key: string;
  title: string;
  description: string;
  module: string;
  sideEffect: string | null;
  input: SchemaLike | null;
  output: SchemaLike | null;
  config: SchemaLike | null;
  /**
   * What publishes work to this node, and what it publishes back. Neither is
   * expressible in a node contract yet, so both come from the prose catalogue
   * when it happens to know — never overriding a schema, only adding to it.
   */
  triggeredBy?: string | null;
  emits?: string | null;
  /** Default path names, for a node that branches. */
  paths?: readonly string[];
};

/** `string`, `number | null`, `string[]` — as much as a reader needs. */
function typeOf(s: SchemaLike): string {
  if (s.enum?.length) return s.enum.map((v) => JSON.stringify(v)).join(" | ");
  if (s.anyOf?.length) {
    const parts = s.anyOf.map(typeOf).filter((t, i, a) => a.indexOf(t) === i);
    return parts.join(" | ");
  }
  if (s.type === "array") return `${s.items ? typeOf(s.items) : "value"}[]`;
  return s.type ?? "value";
}

/** `0–1`, `at least 1` — a range only where the schema states one. */
function rangeOf(s: SchemaLike): string {
  if (typeof s.minimum === "number" && typeof s.maximum === "number") {
    return ` ${s.minimum}–${s.maximum}`;
  }
  if (typeof s.minimum === "number") return ` at least ${s.minimum}`;
  if (typeof s.maximum === "number") return ` at most ${s.maximum}`;
  return "";
}

/**
 * One line per field, required ones first.
 *
 * Ordering is not cosmetic: a model reading a long alphabetical list gives the
 * first names it sees the most weight, and the fields that must be present are
 * the ones it most needs to get right.
 */
export function describeSchema(schema: SchemaLike | null): string[] {
  const props = schema?.properties;
  if (!props || Object.keys(props).length === 0) return [];
  const required = new Set(schema?.required ?? []);
  const names = Object.keys(props).sort((a, b) => {
    const ra = required.has(a) ? 0 : 1;
    const rb = required.has(b) ? 0 : 1;
    return ra - rb || a.localeCompare(b);
  });

  return names.map((name) => {
    const f = props[name]!;
    const bits = [`${name}: ${typeOf(f)}${rangeOf(f)}`];
    if (required.has(name)) bits.push("required");
    if (f.default !== undefined) bits.push(`default ${JSON.stringify(f.default)}`);
    const note = f.description ?? f.label;
    return `    - ${bits.join(", ")}${note ? ` — ${note}` : ""}`;
  });
}

/** The whole catalogue entry for one node. */
export function describeNode(n: PromptNode): string {
  const takes = describeSchema(n.input);
  const returns = describeSchema(n.output);
  const settings = describeSchema(n.config);

  const lines: string[] = [`### ${n.key}`, n.description];

  const facts = [`owned by ${n.module}`];
  if (n.sideEffect) facts.push(n.sideEffect.replace("_", " "));
  if (n.triggeredBy) facts.push(`usually follows ${n.triggeredBy}`);
  if (n.emits) facts.push(`publishes ${n.emits}`);
  lines.push(facts.join(" · "));

  // A node with no declared schema says so. Silence would read as "takes
  // nothing", and the model would wire it up with no inputs at all.
  lines.push("Takes:");
  lines.push(
    takes.length > 0
      ? takes.join("\n")
      : "    - not declared — this node has no contract yet",
  );

  if (returns.length > 0) {
    lines.push("Returns:");
    lines.push(returns.join("\n"));
  }
  if (settings.length > 0) {
    lines.push("Settings (node.config):");
    lines.push(settings.join("\n"));
  }
  if (n.paths?.length) {
    lines.push(
      `Branching labels (use on outgoing edges from this node): ${n.paths.join(", ")}`,
    );
  }
  return lines.join("\n");
}

export function describeNodesForPrompt(nodes: readonly PromptNode[]): string {
  return nodes.map(describeNode).join("\n\n");
}
