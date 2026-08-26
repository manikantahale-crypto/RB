/**
 * Screen 4 — TEST THIS NODE.
 *
 * The loop the wireframe is about: change a setting, run, see the output,
 * change again. Every attempt is kept with the config that produced it, so
 * "what did I change between #3 and #4" is answerable rather than remembered.
 *
 * THREE HONESTY RULES, all visible in this component:
 *
 *   Results are advisory. No badge here gates anything — a green run does not
 *   unlock saving, releasing or anything else. The live trial (screen 5) is
 *   what proves the flow.
 *
 *   The run uses the panel's CURRENT config, unsaved edits included. That is
 *   the point of the loop, and it is why an "unsaved" chip appears the moment
 *   what was tested stops matching what is saved.
 *
 *   It is real. No stub, no fake mode. The node hits the real service; the
 *   server gives it throwaway records so nothing a person owns is touched.
 */
import { useState } from "react";
import { runNodeTest, type NodeTestResult, type RegistryNode } from "../api/editor";

type Attempt = {
  n: number;
  result: NodeTestResult;
  config: Record<string, unknown>;
  at: Date;
};

/**
 * Field-level difference between two outputs — the wireframe's "Δ vs #3".
 *
 * Values that are only the throwaway record ids are dropped. Each attempt
 * provisions fresh records, so `jobId`, `resumeId` and `candidateId` differ on
 * every single run — reporting them buries the one line that matters (the
 * threshold that changed) under three uuids that always change and never mean
 * anything.
 */
function diffOutputs(
  a: unknown,
  b: unknown,
  ignoreValues: Set<string> = new Set(),
): Array<{ field: string; from: unknown; to: unknown }> {
  const out: Array<{ field: string; from: unknown; to: unknown }> = [];
  const ao = (a ?? {}) as Record<string, unknown>;
  const bo = (b ?? {}) as Record<string, unknown>;
  for (const key of new Set([...Object.keys(ao), ...Object.keys(bo)])) {
    if (JSON.stringify(ao[key]) === JSON.stringify(bo[key])) continue;
    const bothAreScratchIds =
      typeof ao[key] === "string" &&
      typeof bo[key] === "string" &&
      ignoreValues.has(ao[key] as string) &&
      ignoreValues.has(bo[key] as string);
    if (bothAreScratchIds) continue;
    out.push({ field: key, from: ao[key], to: bo[key] });
  }
  return out;
}

/** The throwaway ids used by an attempt, so a diff can ignore them. */
function scratchValues(...results: Array<NodeTestResult | undefined>): Set<string> {
  const set = new Set<string>();
  for (const r of results) {
    for (const v of Object.values(r?.scratch ?? {})) {
      if (typeof v === "string") set.add(v);
    }
    for (const v of Object.values(r?.input ?? {})) {
      if (typeof v === "string") set.add(v);
    }
  }
  return set;
}

function show(v: unknown): string {
  if (v === undefined) return "—";
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

export function NodeTestPanel({
  contract,
  config,
  configIsSaved,
}: {
  contract: RegistryNode;
  config: Record<string, unknown>;
  /** False once the settings differ from what is stored in the draft. */
  configIsSaved: boolean;
}) {
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [running, setRunning] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [compareWith, setCompareWith] = useState<number | null>(null);

  if (!contract.editorTestable) {
    return (
      <div className="nt-blocked">
        <strong>Not testable here.</strong>{" "}
        {contract.requiresAllowlist
          ? `This step is declared "${contract.sideEffect}" — something leaves the building. A test that reaches a real person is not a test.`
          : "This step has no contract, so there is nothing to run against."}
      </div>
    );
  }

  const run = async () => {
    setRunning(true);
    const snapshot = structuredClone(config);
    const res = await runNodeTest({ nodeKey: contract.key, config: snapshot });
    setRunning(false);
    if (!res.ok) {
      setAttempts((prev) => [
        ...prev,
        {
          n: prev.length + 1,
          at: new Date(),
          config: snapshot,
          result: {
            ok: false,
            stage: "run",
            nodeKey: contract.key,
            error: res.body.message ?? res.body.error ?? "Could not run",
            ms: 0,
          },
        },
      ]);
      return;
    }
    setAttempts((prev) => {
      const next = [
        ...prev,
        { n: prev.length + 1, at: new Date(), config: snapshot, result: res.data },
      ];
      setSelected(next.length);
      setCompareWith(next.length > 1 ? next.length - 1 : null);
      return next;
    });
  };

  const current = attempts.find((a) => a.n === selected) ?? attempts.at(-1) ?? null;
  const previous = attempts.find((a) => a.n === compareWith) ?? null;
  const ignore = scratchValues(current?.result, previous?.result);
  const delta =
    current && previous
      ? diffOutputs(previous.result.output, current.result.output, ignore)
      : [];
  const configDelta =
    current && previous ? diffOutputs(previous.config, current.config) : [];
  const onlyIdsChanged =
    current && previous && delta.length === 0 && configDelta.length === 0;

  return (
    <div className="nt" data-testid="node-test">
      <div className="nt-head">
        <h3 className="rd-detail-h">Test this step</h3>
        {!configIsSaved ? (
          <span className="nt-unsaved" title="What you are testing is not what is saved.">
            settings edited — unsaved
          </span>
        ) : null}
      </div>

      <p className="ge-muted nt-note">
        Runs the real step against throwaway records the server creates and
        deletes. Uses the settings shown above, saved or not.
      </p>

      <div className="nt-controls">
        <button
          type="button"
          className="wf-btn wf-btn--primary"
          onClick={() => void run()}
          disabled={running}
          data-testid="node-test-run"
        >
          {running ? "Running…" : `▶ Run${attempts.length ? " again" : ""}`}
        </button>
        {attempts.length > 0 ? (
          <span className="ge-muted">
            {attempts.length} attempt{attempts.length === 1 ? "" : "s"} this
            session
          </span>
        ) : null}
      </div>

      {attempts.length > 0 ? (
        <div className="nt-history" role="list" aria-label="Attempts">
          {attempts.map((a) => (
            <button
              key={a.n}
              type="button"
              role="listitem"
              className={`nt-chip${a.n === selected ? " nt-chip--on" : ""}${
                a.result.ok ? " nt-chip--ok" : " nt-chip--bad"
              }`}
              onClick={() => setSelected(a.n)}
              title={`${a.at.toLocaleTimeString()} · ${a.result.ms}ms`}
            >
              #{a.n} {a.result.ok ? "✓" : "✗"}
            </button>
          ))}
        </div>
      ) : null}

      {current ? (
        <div className="nt-result">
          <div className="nt-result-head">
            <span className="nt-attempt">attempt #{current.n}</span>
            <span className="ge-muted">{current.result.ms}ms</span>
            {current.result.ok ? (
              <span className="nt-verdict nt-verdict--ok">
                ✓ output matches the declared shape
              </span>
            ) : current.result.stage === "output" ? (
              <span className="nt-verdict nt-verdict--bad">
                ✗ output does not match the declared shape
              </span>
            ) : (
              <span className="nt-verdict nt-verdict--bad">
                ✗ failed at {current.result.stage}
              </span>
            )}
          </div>

          {current.result.error ? (
            <p className="nt-error">
              {current.result.error}
              {current.result.errorClass ? (
                <span className="rd-errclass">{current.result.errorClass}</span>
              ) : null}
            </p>
          ) : null}

          {current.result.issues?.length ? (
            <ul className="nt-issues">
              {current.result.issues.map((i, k) => (
                <li key={k}>
                  <code>{i.path}</code> {i.message}
                </li>
              ))}
            </ul>
          ) : null}

          {current.result.output !== undefined && current.result.output !== null ? (
            <pre className="nt-output">
              {JSON.stringify(current.result.output, null, 2)}
            </pre>
          ) : null}

          {current.result.emitted?.length ? (
            <p className="ge-muted">
              would announce:{" "}
              {current.result.emitted.map((e) => e.event_type).join(", ")}{" "}
              <span className="nt-not-published">
                — collected, not published
              </span>
            </p>
          ) : null}

          {previous && onlyIdsChanged ? (
            <div className="nt-delta">
              <span className="nt-delta-title">Δ vs #{previous.n}</span>
              <span className="nt-delta-row nt-delta-row--config">
                nothing changed but the throwaway record ids
              </span>
            </div>
          ) : null}

          {previous && (delta.length > 0 || configDelta.length > 0) ? (
            <div className="nt-delta">
              <span className="nt-delta-title">
                Δ vs #{previous.n}
              </span>
              {delta.map((d) => (
                <span key={d.field} className="nt-delta-row">
                  <code>{d.field}</code> {show(d.from)} → {show(d.to)}
                </span>
              ))}
              {configDelta.map((d) => (
                <span key={`c-${d.field}`} className="nt-delta-row nt-delta-row--config">
                  <code>{d.field}</code> setting {show(d.from)} → {show(d.to)}
                </span>
              ))}
            </div>
          ) : null}

          {current.result.scratch &&
          Object.keys(current.result.scratch).length > 0 ? (
            <p className="ge-muted nt-scratch">
              ran against throwaway records, deleted afterwards
            </p>
          ) : null}

          <div className="nt-actions">
            <button type="button" className="wf-btn" disabled title="Not built yet">
              Save as example
            </button>
            <span className="ge-muted">
              advisory only — the live trial proves the whole flow
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
