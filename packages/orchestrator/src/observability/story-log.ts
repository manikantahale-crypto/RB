/**
 * Human-readable orchestration story lines for the worker (`npm start`).
 * One consistent prefix so terminals are easy to scan.
 */

const PREFIX = "[Orch]";

function trunc(v: unknown, max = 160): string {
  if (v === undefined || v === null) return "";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}

export function orchStory(phase: string, detail: string): void {
  console.log(`${PREFIX} ── ${phase.padEnd(6)} ${detail}`);
}

export function orchStoryDetail(detail: string): void {
  console.log(`${PREFIX}           ${detail}`);
}

export function formatEventLine(args: {
  eventType: string;
  eventId: string;
  orgId?: string | null;
  correlationId?: string | null;
  aggregateId?: string | null;
}): string {
  const parts = [
    args.eventType,
    `id=${args.eventId}`,
  ];
  if (args.orgId) parts.push(`org=${args.orgId}`);
  if (args.correlationId) parts.push(`corr=${args.correlationId}`);
  if (args.aggregateId) parts.push(`agg=${args.aggregateId}`);
  return parts.join("  ");
}

export function formatNodeOut(args: {
  result?: unknown;
  branchKey?: unknown;
  confidence?: unknown;
  isActionable?: unknown;
  emitted?: string[];
  error?: string;
}): string | null {
  const bits: string[] = [];
  if (args.result !== undefined && args.result !== null && args.result !== "") {
    bits.push(`result=${trunc(args.result, 80)}`);
  }
  if (typeof args.branchKey === "string" && args.branchKey) {
    bits.push(`branch=${args.branchKey}`);
  }
  if (args.confidence !== undefined && args.confidence !== null) {
    bits.push(`confidence=${trunc(args.confidence, 40)}`);
  }
  if (args.isActionable !== undefined && args.isActionable !== null) {
    bits.push(`actionable=${String(args.isActionable)}`);
  }
  if (args.emitted?.length) {
    bits.push(`emitted=[${args.emitted.join(", ")}]`);
  }
  if (args.error) {
    bits.push(`error=${trunc(args.error, 120)}`);
  }
  return bits.length ? bits.join("  ") : null;
}

export function formatNextPaths(args: {
  nodeId: string;
  edges: Array<[string, string]>;
  conditionalEdges?: Array<{
    from: string;
    map: Record<string, string>;
  }>;
  branchKey?: string | null;
}): string | null {
  const fixed = args.edges
    .filter(([from]) => from === args.nodeId)
    .map(([, to]) => to);
  const cond = (args.conditionalEdges ?? []).find(
    (ce) => ce.from === args.nodeId,
  );
  if (!fixed.length && !cond) return null;

  const parts: string[] = [];
  if (fixed.length) {
    parts.push(`→ ${fixed.join(" | ")}`);
  }
  if (cond) {
    const choices = Object.entries(cond.map)
      .map(([k, v]) => `${k}→${v}`)
      .join(", ");
    const taken =
      args.branchKey && cond.map[args.branchKey]
        ? ` (taken: ${args.branchKey}→${cond.map[args.branchKey]})`
        : "";
    parts.push(`branch{${choices}}${taken}`);
  }
  return parts.join("  ");
}
