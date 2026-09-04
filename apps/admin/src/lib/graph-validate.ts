/**
 * Screen 4 — what the validation rail reports about a draft.
 *
 * Pure, and separate from the editor screen, because these are the checks that
 * decide whether a person may save. Two of them exist specifically to catch
 * corruptions the SERVER does not: `validateGraphTopology` is happy with a
 * decision that also has a plain outgoing edge, and at runtime the compiler
 * registers both the edge and the arms, so both fire.
 */
import type { GraphDefinition, RegistryNode } from "../api/editor";
import { readBands } from "./graph-edit";

export type Finding = {
  level: "error" | "warning" | "ok";
  text: string;
  detail?: string;
};

/**
 * Re-run on every edit. Errors block saving; warnings advise.
 *
 * The split matters: a workflow with no fixtures is worth flagging but is not
 * broken, while a workflow with a step nothing can run IS broken and must not
 * be saved as if it were fine.
 */
export function validate(
  def: GraphDefinition,
  registry: RegistryNode[],
): Finding[] {
  const findings: Finding[] = [];
  const byKey = new Map(registry.map((n) => [n.key, n]));
  const ids = new Set(def.nodes.map((n) => n.id));

  // 1 — every step resolves to something the runtime can run
  const unknown = def.nodes.filter((n) => !byKey.has(n.impl));
  findings.push(
    unknown.length === 0
      ? { level: "ok", text: "Every step resolves" }
      : {
          level: "error",
          text: `${unknown.length} step${unknown.length === 1 ? "" : "s"} the runtime cannot run`,
          detail: unknown.map((n) => `${n.id} → ${n.impl}`).join(", "),
        },
  );

  // 2 — edges point at steps that exist, through BOTH edge lists
  const known = (end: string) =>
    end === "__start__" || end === "__end__" || ids.has(end);
  const dangling: string[] = [];
  for (const [from, to] of def.edges) {
    if (!known(from) || !known(to)) dangling.push(`${from} → ${to}`);
  }
  // Branch arms live in their own list. Leaving them out is how deleting a
  // step that an arm pointed at used to sail past here and fail on save.
  for (const ce of def.conditionalEdges ?? []) {
    if (!known(ce.from)) dangling.push(`${ce.from} → (branches)`);
    for (const [label, target] of Object.entries(ce.map)) {
      if (!known(target)) dangling.push(`${ce.from} –${label}→ ${target}`);
    }
  }
  findings.push(
    dangling.length === 0
      ? { level: "ok", text: "Edges connect real steps" }
      : {
          level: "error",
          text: `${dangling.length} edge${dangling.length === 1 ? "" : "s"} point nowhere`,
          detail: dangling.join(", "),
        },
  );

  // 2a — a step cannot both continue and branch.
  //
  // The runtime registers the plain edge AND the arms on the same node, and
  // then every one of them runs. Nothing server-side rejects this, so it is
  // caught here or not at all.
  const forks = new Set((def.conditionalEdges ?? []).map((ce) => ce.from));
  const bothWays = [...forks].filter((id) =>
    def.edges.some(([a]) => a === id),
  );
  if (bothWays.length > 0) {
    findings.push({
      level: "error",
      text: `${bothWays.length} step${bothWays.length === 1 ? "" : "s"} both continue and branch`,
      detail: `${bothWays.join(", ")} — at run time every one of those paths fires at once`,
    });
  }

  // 2c — a path the decision can never return.
  //
  // The arm exists, the canvas draws it, and nothing ever takes it: the
  // runtime matches on the name the deciding step produced, so a path whose
  // name is not among that step's outcomes is dead. No error, no failed run.
  const deadArms: string[] = [];
  for (const ce of def.conditionalEdges ?? []) {
    const node = def.nodes.find((n) => n.id === ce.from);
    const bands = readBands(node);
    if (!bands) continue; // not a score decision — its names are fixed elsewhere
    const produced = new Set(bands.map((b) => b.name));
    for (const label of Object.keys(ce.map)) {
      if (!produced.has(label)) deadArms.push(`${ce.from} –${label}→`);
    }
  }
  if (deadArms.length > 0) {
    findings.push({
      level: "error",
      text: `${deadArms.length} path${deadArms.length === 1 ? "" : "s"} nothing can ever take`,
      detail: `${deadArms.join(", ")} — the step never returns that name, so the path is dead`,
    });
  }

  // 2b — a fork with no arms routes nowhere and rejects everything.
  const emptyForks = (def.conditionalEdges ?? []).filter(
    (ce) => Object.keys(ce.map).length === 0,
  );
  if (emptyForks.length > 0) {
    findings.push({
      level: "error",
      text: `${emptyForks.length} branch${emptyForks.length === 1 ? "" : "es"} with no outcomes`,
      detail: emptyForks.map((ce) => ce.from).join(", "),
    });
  }

  // 3 — nothing stranded: every step is reachable from the start
  const reachable = new Set<string>();
  const walk = (from: string) => {
    for (const [a, b] of def.edges) {
      if (a === from && b !== "__end__" && !reachable.has(b)) {
        reachable.add(b);
        walk(b);
      }
    }
    for (const ce of def.conditionalEdges ?? []) {
      if (ce.from !== from) continue;
      for (const target of Object.values(ce.map)) {
        if (!reachable.has(target)) {
          reachable.add(target);
          walk(target);
        }
      }
    }
  };
  walk("__start__");
  const orphaned = def.nodes.filter((n) => !reachable.has(n.id));
  findings.push(
    orphaned.length === 0
      ? { level: "ok", text: "No stranded steps" }
      : {
          level: "error",
          text: `${orphaned.length} step${orphaned.length === 1 ? "" : "s"} nothing leads to`,
          detail: orphaned.map((n) => n.id).join(", "),
        },
  );

  // 4 — anything that leaves the building needs written justification
  const external = def.nodes.filter((n) => byKey.get(n.impl)?.requiresAllowlist);
  if (external.length > 0) {
    findings.push({
      level: "warning",
      text: `${external.length} step${external.length === 1 ? "" : "s"} reach outside the company`,
      detail: `${external.map((n) => n.id).join(", ")} — each needs a written justification before release`,
    });
  }

  // 5 — a step with no worked example cannot be checked automatically
  const noFixture = def.nodes.filter((n) => {
    const c = byKey.get(n.impl);
    return (
      (c?.source === "contract" || c?.source === "declared") &&
      c.fixtureNames.length === 0
    );
  });
  if (noFixture.length > 0) {
    findings.push({
      level: "warning",
      text: `${noFixture.length} step${noFixture.length === 1 ? "" : "s"} have no worked example`,
      detail: noFixture.map((n) => n.id).join(", "),
    });
  }

  // 6 — undeclared steps cannot be checked at all
  const legacy = def.nodes.filter((n) => byKey.get(n.impl)?.source === "legacy");
  if (legacy.length > 0) {
    findings.push({
      level: "warning",
      text: `${legacy.length} step${legacy.length === 1 ? "" : "s"} have no contract`,
      detail: `${legacy.map((n) => n.id).join(", ")} — settings and data cannot be checked`,
    });
  }

  return findings;
}
