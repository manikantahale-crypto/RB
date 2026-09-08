/**
 * Platform health — the faults the system cannot report itself.
 *
 * Every check here finds something that fails without failing. A binding whose
 * queue nobody works, a step in no registry, an event nothing answers: none of
 * them raise an error, because nothing errors. Work just stops.
 *
 * So the screen's job is not to reassure. It is to make absence visible — and
 * to be honest about the difference between "we looked and it is fine" and "we
 * could not look", which is why `not checked` is a state of its own and never
 * dressed up as a pass.
 */
import { useEffect, useState } from "react";
import { loadPlatformChecks, type PlatformChecks } from "../api/platform-health";

const LABEL: Record<string, string> = {
  bindings_routable: "Work is being collected",
  impls_permitted: "Every step is one its workflow may use",
  emitted_events_answered: "Every published event is answered",
  routing_hazards: "Nothing routes twice",
};

export function PlatformHealthPage() {
  const [data, setData] = useState<PlatformChecks | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    void (async () => {
      const res = await loadPlatformChecks();
      if (!live) return;
      if (res.ok) setData(res.data);
      else setError(res.body.message ?? res.body.error ?? "Could not run the checks");
      setLoading(false);
    })();
    return () => {
      live = false;
    };
  }, []);

  if (loading) return <p className="wf-empty">Checking…</p>;
  if (error) {
    return (
      <div className="ph-page">
        <div className="ph-error" role="alert">
          {error}
        </div>
      </div>
    );
  }
  if (!data) return null;

  const failed = data.findings.filter((f) => f.status === "fail").length;
  const unchecked = data.findings.filter((f) => f.status === "unchecked").length;

  return (
    <div className="ph-page" data-testid="platform-health">
      <header className="ph-head">
        <div>
          <p className="ph-crumb">platform</p>
          <h1 className="ph-title">Health</h1>
        </div>
        <span className="ph-counts">
          {data.counts.bindings} bindings · {data.counts.activeGraphs} active
          workflows · {data.counts.registeredNodes} registered steps
        </span>
      </header>

      {/* The summary says what was NOT looked at, not just what passed. A
          screen that reports "all clear" while two checks could not run is
          the same lie the checks exist to stop. */}
      <p
        className={failed > 0 ? "ph-verdict ph-verdict--bad" : "ph-verdict"}
        role="status"
      >
        {failed === 0
          ? "Nothing is silently failing."
          : `${failed} of ${data.findings.length} checks found something.`}
        {unchecked > 0
          ? ` ${unchecked} could not be checked — see below for why.`
          : ""}
      </p>

      {data.findings.map((f) => (
        <section key={f.id} className={`ph-card ph-card--${f.status}`}>
          <h2 className="ph-card-title">
            <span className="ph-mark">
              {f.status === "pass" ? "✓" : f.status === "fail" ? "!" : "–"}
            </span>
            <span>{LABEL[f.id] ?? f.id}</span>
            <code className="ph-id">{f.id}</code>
          </h2>

          <p className="ph-message">{f.message}</p>

          {f.detail.length > 0 ? (
            <ul className="ph-detail">
              {f.detail.map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ul>
          ) : null}
        </section>
      ))}

      <p className="ph-foot">
        Read-only — four queries, no writes. The same checks run from a terminal
        with <code>npm run check:platform</code>.
      </p>
    </div>
  );
}
