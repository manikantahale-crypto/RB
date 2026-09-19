/**
 * The rules of an `orch.switch` step, edited one line at a time.
 *
 * A rule is "when <field> <op> <value>, take <path>". The generic settings
 * form renders arrays as a comma-separated box, which cannot hold a rule, so
 * this field takes over for that one key. It reads and writes the same
 * `config.rules` the node runs on — the shape is `@tekisho/graph-contract`'s,
 * so what is typed here means the same thing at run time.
 *
 * WHAT IT DOES NOT DO. A rule with `all` / `any` groups is shown as one
 * line per condition under its path and can be removed but not edited in
 * place; writing a group means editing the JSON below. That is a limit of
 * this first version, stated rather than hidden.
 */
import { useState } from "react";
import {
  SWITCH_OPS,
  switchConfigProblems,
  type SwitchOp,
  type SwitchRule,
} from "@tekisho/graph-contract";

const OP_WORDS: Record<SwitchOp, string> = {
  eq: "is",
  ne: "is not",
  in: "is one of",
  nin: "is none of",
  gt: ">",
  gte: "≥",
  lt: "<",
  lte: "≤",
  contains: "contains",
  exists: "is present",
  true: "is true",
  false: "is false",
};

const NO_VALUE: readonly SwitchOp[] = ["exists", "true", "false"];

function simple(rule: SwitchRule): { field: string; op: SwitchOp; value: unknown } | null {
  const w = rule.when as Record<string, unknown>;
  if ("all" in w || "any" in w) return null;
  return w as { field: string; op: SwitchOp; value: unknown };
}

function showValue(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (Array.isArray(v)) return v.map(String).join(", ");
  return String(v);
}

/** "a, b" → ["a","b"] for list operators; a number when it reads as one. */
function readValue(text: string, op: SwitchOp): unknown {
  const t = text.trim();
  if (op === "in" || op === "nin") {
    return t.split(",").map((s) => s.trim()).filter(Boolean);
  }
  if (["gt", "gte", "lt", "lte"].includes(op) && t !== "" && !Number.isNaN(Number(t))) {
    return Number(t);
  }
  return t;
}

export function SwitchRulesField({
  rules,
  onChange,
}: {
  rules: unknown;
  onChange: (rules: SwitchRule[] | undefined) => void;
}) {
  const list = (Array.isArray(rules) ? rules : []) as SwitchRule[];
  const [json, setJson] = useState<string | null>(null);
  const problems = switchConfigProblems({ rules: list });

  const write = (next: SwitchRule[]) => onChange(next.length ? next : undefined);
  const patch = (i: number, change: Partial<{ output: string; field: string; op: SwitchOp; value: unknown }>) => {
    const next = list.map((r, k) => {
      if (k !== i) return r;
      const s = simple(r);
      if (!s) return change.output ? { ...r, output: change.output } : r;
      const merged = { ...s, ...change };
      const when: Record<string, unknown> = { field: merged.field, op: merged.op };
      if (!NO_VALUE.includes(merged.op)) when.value = merged.value;
      return { output: change.output ?? r.output, when } as SwitchRule;
    });
    write(next);
  };

  return (
    <div className="ge-rules">
      {list.length === 0 ? (
        <p className="ge-muted">No rules yet — every run takes the default path.</p>
      ) : null}
      {list.map((rule, i) => {
        const s = simple(rule);
        return (
          <div className="ge-rule" key={i}>
            <span className="ge-rule-n">{i + 1}</span>
            {s ? (
              <>
                <span>when</span>
                <input
                  className="ge-input ge-rule-field"
                  value={s.field}
                  placeholder="field"
                  onChange={(e) => patch(i, { field: e.target.value })}
                />
                <select
                  className="ge-input ge-rule-op"
                  value={s.op}
                  onChange={(e) => patch(i, { op: e.target.value as SwitchOp })}
                >
                  {SWITCH_OPS.map((op) => (
                    <option key={op} value={op}>
                      {OP_WORDS[op]}
                    </option>
                  ))}
                </select>
                {NO_VALUE.includes(s.op) ? null : (
                  <input
                    className="ge-input ge-rule-value"
                    value={showValue(s.value)}
                    placeholder={s.op === "in" || s.op === "nin" ? "a, b, c" : "value"}
                    onChange={(e) => patch(i, { value: readValue(e.target.value, s.op) })}
                  />
                )}
              </>
            ) : (
              <span className="ge-muted">
                when {"all" in rule.when ? "all" : "any"} of{" "}
                {(("all" in rule.when ? rule.when.all : (rule.when as { any: unknown[] }).any) as Array<{ field: string; op: string }>)
                  .map((c) => `${c.field} ${OP_WORDS[c.op as SwitchOp] ?? c.op}`)
                  .join(", ")}
              </span>
            )}
            <span>→</span>
            <input
              className="ge-input ge-rule-output"
              value={rule.output}
              placeholder="path"
              onChange={(e) => patch(i, { output: e.target.value })}
            />
            <button
              type="button"
              className="wf-btn ge-rule-quiet"
              title="Remove this rule"
              onClick={() => write(list.filter((_, k) => k !== i))}
            >
              ×
            </button>
          </div>
        );
      })}
      <div className="ge-rule-actions">
        <button
          type="button"
          className="wf-btn"
          onClick={() =>
            write([...list, { output: "matched", when: { field: "", op: "exists" } }])
          }
        >
          Add a rule
        </button>
        <button
          type="button"
          className="wf-btn ge-rule-quiet"
          onClick={() => setJson(json === null ? JSON.stringify(list, null, 2) : null)}
        >
          {json === null ? "Edit as JSON" : "Close JSON"}
        </button>
      </div>
      {json !== null ? (
        <textarea
          className="ge-input ge-rule-json"
          rows={8}
          value={json}
          onChange={(e) => {
            setJson(e.target.value);
            try {
              const parsed = JSON.parse(e.target.value);
              if (Array.isArray(parsed)) write(parsed as SwitchRule[]);
            } catch {
              // Half-typed JSON is normal; the last good value stands.
            }
          }}
        />
      ) : null}
      {problems.length > 0 ? (
        <ul className="ge-rule-problems">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
