import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  baseFieldsFor,
  buildPolicyFromForm,
  formFieldsFor,
  getPath,
  setPath,
  valuesFromPolicy,
  type PolicyFieldDesc,
} from "@tekisho/authoring/src/policy-ext-ui.js";
import {
  AGENT_CAPABILITIES_LINE,
  GENERATE_REQUEST_HINT,
} from "@tekisho/authoring/src/build-graph-prompt.js";
import {
  parseStoredGraphArtifact,
  summarizeGraphWorkflow,
} from "@tekisho/authoring/src/summarize-graph.js";
import { validateAgentPolicy } from "@tekisho/authoring/src/validate-policy.js";
import type { GraphDefinition } from "@tekisho/authoring/src/graph-definition.js";
import {
  generateAgent,
  getAgent,
  savePolicy,
  goLive,
  rollbackAgent,
  type FieldError,
} from "../api";

type EditorState =
  | "idle"
  | "saving"
  | "generating"
  | "accepting"
  | "going_live"
  | "requesting_go_live"
  | "compiling"
  | "publishing"
  | "activating"
  | "rolling_back"
  | "success"
  | "validation"
  | "server"
  | "stale"
  | "preview";

type PendingPreview = {
  definition: GraphDefinition;
  unsupported: string[];
  builtSummary: string | null;
  request: string;
  message?: string;
};

export function PolicyEditorPage() {
  const { id = "" } = useParams();
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [canEdit, setCanEdit] = useState(false);
  const [version, setVersion] = useState<number | undefined>(undefined);
  const [status, setStatus] = useState<string | null>(null);
  const [checksum, setChecksum] = useState<string | null>(null);
  const [agentKey, setAgentKey] = useState("");
  const [policyExt, setPolicyExt] = useState("");
  const [baseFields, setBaseFields] = useState<PolicyFieldDesc[]>([]);
  const [extFields, setExtFields] = useState<PolicyFieldDesc[]>([]);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [ui, setUi] = useState<EditorState>("idle");
  const [banner, setBanner] = useState<string | null>(null);
  const [fields, setFields] = useState<FieldError[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rollbackTarget, setRollbackTarget] = useState("");
  const [generateRequest, setGenerateRequest] = useState("");
  const [workflowDef, setWorkflowDef] = useState<GraphDefinition | null>(null);
  const [pendingPreview, setPendingPreview] = useState<PendingPreview | null>(
    null,
  );

  const busy =
    ui === "saving" ||
    ui === "generating" ||
    ui === "accepting" ||
    ui === "going_live" ||
    ui === "requesting_go_live" ||
    ui === "compiling" ||
    ui === "publishing" ||
    ui === "activating" ||
    ui === "rolling_back";
  const locked = busy || !canEdit;
  const allFields = useMemo(
    () => [...baseFields, ...extFields],
    [baseFields, extFields],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const ok = await syncFromServer();
      if (cancelled) return;
      if (!ok) {
        setLoading(false);
        return;
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load on agent id change
  }, [id]);

  async function syncFromServer(): Promise<boolean> {
    const res = await getAgent(id);
    if (!res.ok) {
      setLoadError(
        res.body.message ?? res.body.error ?? "Failed to load agent",
      );
      return false;
    }

    const pe = res.data.template?.policyExt ?? "";
    const catalog = formFieldsFor(pe);
    const resolvedBase = catalog.base.length ? catalog.base : baseFieldsFor();
    const resolvedExt = pe ? catalog.ext : [];

    setName(res.data.template?.displayName ?? res.data.name);
    setPurpose(res.data.purpose);
    setCanEdit(res.data.canEdit);
    setVersion(res.data.policy?.version);
    setStatus(res.data.policy?.status ?? null);
    setChecksum(res.data.policy?.checksum ?? null);
    setAgentKey(res.data.template?.agentKey ?? "");
    setPolicyExt(pe);
    setBaseFields(resolvedBase);
    setExtFields(resolvedExt);
    setValues(() => {
      const vals = valuesFromPolicy(res.data.policy?.policy ?? null, [
        ...resolvedBase,
        ...resolvedExt,
      ]);
      const cleaned = adminFacingPrompt(
        String(getPath(vals, "prompt") ?? ""),
      );
      return setPath(vals, "prompt", cleaned);
    });
    const rawWf = res.data.workflow?.definition;
    const parsed =
      rawWf && typeof rawWf === "object"
        ? (rawWf as GraphDefinition)
        : parseStoredGraphArtifact(
            typeof rawWf === "string" ? rawWf : null,
          );
    setWorkflowDef(
      parsed && Array.isArray(parsed.nodes) && parsed.nodes.length > 0
        ? parsed
        : null,
    );
    if (!res.data.template) {
      setLoadError("This agent is missing a template. Ask an engineer for help.");
    } else {
      setLoadError(null);
    }
    return true;
  }

  async function handleStale(currentVersion?: number): Promise<void> {
    await syncFromServer();
    setPendingPreview(null);
    setUi("stale");
    setBanner(
      currentVersion != null
        ? `This page was out of date (latest is v${currentVersion}). Weâ€™ve refreshed â€” try your action again.`
        : "This page was out of date. Weâ€™ve refreshed â€” try your action again.",
    );
  }

  const payload = useMemo(
    () => buildPolicyFromForm(id, agentKey, values, allFields),
    [id, agentKey, values, allFields],
  );

  const clientValidation = useMemo(() => {
    if (!policyExt || !agentKey) {
      return {
        ok: false as const,
        fields: [{ path: "policyExt", message: "Missing template policyExt" }],
      };
    }
    return validateAgentPolicy(payload, { policyExt });
  }, [policyExt, agentKey, payload]);

  const workflowSummary = useMemo(
    () => summarizeGraphWorkflow(workflowDef),
    [workflowDef],
  );

  const generateDisabled =
    locked ||
    loading ||
    !clientValidation.ok ||
    !policyExt ||
    !generateRequest.trim() ||
    pendingPreview !== null;

  function discardPreview() {
    setPendingPreview(null);
    setUi("idle");
    setBanner(null);
  }

  async function onGenerate() {
    const requestText = generateRequest.trim();
    if (!requestText) {
      setUi("validation");
      setBanner("Describe the workflow in plain English before generating.");
      return;
    }

    const v = validateAgentPolicy(payload, { policyExt });
    if (!v.ok) {
      setUi("validation");
      setFields(v.fields);
      setBanner("Fix validation errors before generating.");
      return;
    }

    let expectedVersion = version;
    // Regenerate while already generated / pending review â€” no new draft required.
    // Otherwise ensure a draft exists (save first).
    if (status !== "generated" && status !== "pending_go_live") {
      if (expectedVersion === undefined || status !== "draft") {
        setUi("saving");
        const saved = await savePolicy(id, v.policy, version);
        if (!saved.ok) {
          if (saved.body.error === "STALE_POLICY") {
            await handleStale(saved.body.currentVersion);
            return;
          }
          setUi("server");
          setBanner(
            saved.body.message ??
              saved.body.error ??
              "Save before generate failed.",
          );
          return;
        }
        expectedVersion = saved.data.version;
        setVersion(saved.data.version);
        setStatus(saved.data.status);
      }
    }

    setUi("generating");
    setBanner(null);
    setFields([]);
    setPendingPreview(null);

    const res = await generateAgent(id, v.policy, expectedVersion, {
      request: requestText,
      mode: "llm",
      preview: true,
    });
    if (!res.ok) {
      if (res.body.error === "STALE_POLICY") {
        await handleStale(res.body.currentVersion);
        return;
      }
      if (res.body.error === "POLICY_INVALID") {
        setUi("validation");
        setFields(res.body.fields ?? []);
        setBanner("Policy invalid â€” nothing written.");
        return;
      }
      if (res.body.error === "LLM_NOT_CONFIGURED") {
        setUi("server");
        setBanner(
          res.body.message ??
            "LLM is not set up. Ask an engineer to configure the language model.",
        );
        return;
      }
      setUi("server");
      setBanner(friendlyGenerateError(res.body.message, res.body.error));
      return;
    }

    const def = res.data.definition;
    if (!def || typeof def !== "object") {
      setUi("server");
      setBanner("Preview returned no workflow â€” nothing stored. Try again.");
      return;
    }

    const unsupported = Array.isArray(res.data.unsupported)
      ? res.data.unsupported
      : [];
    const builtSummary =
      typeof res.data.builtSummary === "string" ? res.data.builtSummary : null;
    setPendingPreview({
      definition: def as GraphDefinition,
      unsupported,
      builtSummary,
      request: requestText,
      message: res.data.message,
    });
    setUi("preview");
    setBanner(
      unsupported.length > 0
        ? "Review the gap report, then Accept to save â€” or Discard to keep the current workflow."
        : "Review the proposed workflow, then Accept to save â€” or Discard to keep the current one.",
    );
  }

  async function onAcceptPreview() {
    if (!pendingPreview || !id) return;

    const v = validateAgentPolicy(payload, { policyExt });
    if (!v.ok) {
      setUi("validation");
      setFields(v.fields);
      setBanner("Fix validation errors before accepting.");
      return;
    }

    setUi("accepting");
    setBanner(null);
    setFields([]);

    const res = await generateAgent(id, v.policy, version, {
      mode: "llm",
      accept: true,
      definition: pendingPreview.definition,
      unsupported: pendingPreview.unsupported,
      request: pendingPreview.request,
    });
    if (!res.ok) {
      if (res.body.error === "STALE_POLICY") {
        await handleStale(res.body.currentVersion);
        return;
      }
      setUi("preview");
      setBanner(
        friendlyGenerateError(res.body.message, res.body.error) ||
          "Accept failed â€” nothing stored. You can try Accept again or Discard.",
      );
      return;
    }

    setVersion(res.data.version);
    setStatus(res.data.status);
    setChecksum(res.data.checksum ?? null);
    if (res.data.definition && typeof res.data.definition === "object") {
      setWorkflowDef(res.data.definition as GraphDefinition);
    } else {
      setWorkflowDef(pendingPreview.definition);
    }
    setPendingPreview(null);
    setUi("success");
    setBanner(
      "Workflow saved. When youâ€™re happy with it, make it live below.",
    );
  }

  async function onGoLive() {
    if (
      status !== "generated" &&
      status !== "pending_go_live" &&
      status !== "compiled" &&
      status !== "published"
    ) {
      setUi("validation");
      setBanner(
        workflowSummary.empty
          ? "Create a workflow first, then you can make it live."
          : "Accept & save a workflow first, then you can make it live.",
      );
      return;
    }

    const confirmed = window.confirm(
      "Make this workflow live?\n\nWe'll run safety checks first. If anything isn't ready, nothing will change in production.",
    );
    if (!confirmed) return;

    setUi("going_live");
    setBanner("Making it liveâ€¦");
    const res = await goLive(id, version);
    if (!res.ok) {
      if (res.body.error === "STALE_POLICY") {
        await handleStale(res.body.currentVersion);
        return;
      }
      if (res.body.error === "GO_LIVE_BLOCKED") {
        setUi("validation");
        setBanner(
          res.body.message ??
            "Can't go live yet: one or more safety checks failed.",
        );
        return;
      }
      setUi("server");
      setBanner(
        res.body.message ??
          res.body.error ??
          "Couldn't make this live. Production was not changed.",
      );
      return;
    }

    setStatus(res.data.status);
    if (res.data.version != null) setVersion(res.data.version);
    if (res.data.checksum != null) setChecksum(res.data.checksum);
    setUi("success");
    const liveVer = res.data.version ?? version;
    setBanner(
      res.data.message ??
        (liveVer != null
          ? `This agent is now live (version ${liveVer}).`
          : "This agent is now live."),
    );
  }

  async function onRollback() {
    const target = Number(rollbackTarget);
    if (!Number.isFinite(target) || target <= 0) {
      setUi("validation");
      setBanner("Enter an earlier version number to restore.");
      return;
    }
    const confirmed = window.confirm(
      `Restore version ${target} and make it live again?`,
    );
    if (!confirmed) return;

    setUi("rolling_back");
    setBanner(null);
    const res = await rollbackAgent(id, target);
    if (!res.ok) {
      setUi("server");
      setBanner(
        res.body.message ?? res.body.error ?? "Couldnâ€™t restore that version.",
      );
      return;
    }
    setVersion(res.data.version);
    setStatus(res.data.status);
    setChecksum(res.data.checksum);
    setUi("success");
    setBanner(`Restored version ${res.data.rolledBackTo}. Itâ€™s live again.`);
  }

  if (loading) {
    return <div className="loading">Loading policyâ€¦</div>;
  }

  if (loadError && !policyExt) {
    return (
      <section>
        <Link className="back-link" to="/">
          â† Agents
        </Link>
        <div className="banner err">{loadError}</div>
      </section>
    );
  }

  const bannerClass =
    ui === "success" || (ui === "idle" && banner?.startsWith("Saved"))
      ? "ok"
      : ui === "preview"
        ? "warn"
        : ui === "stale"
          ? "warn"
          : ui === "server" || ui === "validation"
            ? "err"
            : banner
              ? "ok"
              : "";

  const statusLabel = friendlyStatus(status, version);
  const canGoLive =
    status === "generated" ||
    status === "pending_go_live" ||
    status === "compiled" ||
    status === "published";
  const displayTitle = friendlyAgentTitle(name);
  const displayPurpose = adminFacingPrompt(purpose) || purpose;

  return (
    <section className="editor-page">
      <Link className="back-link" to="/">
        â† All agents
      </Link>

      <header className="editor-hero">
        <div className="editor-hero-text">
          <h1>{displayTitle}</h1>
          <p>{displayPurpose}</p>
        </div>
        <div className="editor-hero-meta">
          <span className={`badge ${statusBadgeClass(status)}`}>
            {statusLabel}
          </span>
        </div>
      </header>

      {banner ? <div className={`banner ${bannerClass}`}>{banner}</div> : null}

      <div className="editor-layout editor-layout--simple">
        <div className="editor-main">
          <div className="section-card workflow-card">
            <div className="section-head">
              <div>
                <h2>What this agent does</h2>
                <p className="muted">
                  Read how it works today. To change it, write what you want in
                  plain English â€” we design the steps for you.
                </p>
              </div>
            </div>

            <div className="form-block">
              <h3 className="form-block-title">How it works today</h3>
              {workflowSummary.empty ? (
                <p className="muted workflow-empty">
                  Nothing set up yet. Describe what you want below and click{" "}
                  <strong>Create workflow</strong>.
                </p>
              ) : (
                <div className="workflow-summary">
                  <ol className="workflow-steps workflow-steps--plain">
                    {workflowSummary.steps.map((s) => (
                      <li key={s.id}>
                        <span className="workflow-step-label">{s.label}</span>
                        {s.detail ? (
                          <span className="workflow-step-detail">{s.detail}</span>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </div>

            <div className="form-block">
              <h3 className="form-block-title">Tell us what you want</h3>
              <p className="capability-line" role="note">
                {AGENT_CAPABILITIES_LINE}
              </p>
              <label className="field field--wide">
                <span className="field-label">Your description</span>
                <textarea
                  className="generate-request"
                  rows={5}
                  value={generateRequest}
                  disabled={locked || pendingPreview !== null}
                  placeholder={GENERATE_REQUEST_HINT}
                  onChange={(e) => {
                    setGenerateRequest(e.target.value);
                    setUi("idle");
                  }}
                />
                <span className="hint">
                  Write like you would explain it to a coworker. Include any
                  rules (location, score, visa, and so on).
                </span>
              </label>
            </div>

            {pendingPreview ? (
              <div className="gap-report" role="status">
                <h3 className="form-block-title">Review before saving</h3>
                <p className="gap-report-built">
                  <strong>Built:</strong>{" "}
                  {pendingPreview.builtSummary ??
                    summarizeGraphWorkflow(pendingPreview.definition).line}
                </p>
                {pendingPreview.unsupported.length > 0 ? (
                  <p className="gap-report-unsupported">
                    <strong>Could NOT add:</strong>{" "}
                    {pendingPreview.unsupported.join(", ")} (no tool available
                    yet).
                  </p>
                ) : (
                  <p className="muted">
                    Everything in your request maps to available steps.
                  </p>
                )}
                <ol className="workflow-steps workflow-steps--plain gap-report-steps">
                  {summarizeGraphWorkflow(pendingPreview.definition).steps.map(
                    (s) => (
                      <li key={s.id}>
                        <span className="workflow-step-label">{s.label}</span>
                        {s.detail ? (
                          <span className="workflow-step-detail">{s.detail}</span>
                        ) : null}
                      </li>
                    ),
                  )}
                </ol>
                <div className="card-actions">
                  <button
                    type="button"
                    className="btn"
                    disabled={busy || !canEdit}
                    onClick={() => void onAcceptPreview()}
                  >
                    {ui === "accepting" ? "Savingâ€¦" : "Accept & save"}
                  </button>
                  <button
                    type="button"
                    className="btn secondary"
                    disabled={busy}
                    onClick={discardPreview}
                  >
                    Discard
                  </button>
                </div>
              </div>
            ) : (
              <div className="card-actions">
                <button
                  type="button"
                  className="btn"
                  disabled={generateDisabled}
                  onClick={() => void onGenerate()}
                >
                  {ui === "generating"
                    ? "Creatingâ€¦"
                    : status === "generated" || !workflowSummary.empty
                      ? "Update workflow"
                      : "Create workflow"}
                </button>
              </div>
            )}
          </div>

          <div className="section-card">
            <div className="section-head">
              <div>
                <h2>Make this live</h2>
                <p className="muted">
                  When the workflow looks right, make it live. We run automatic
                  safety checks first â€” if anything isnâ€™t ready, nothing changes
                  in production.
                </p>
              </div>
            </div>

            <div className="go-live-panel">
              <p className="go-live-status">
                {status === "active"
                  ? "This agent is live."
                  : canGoLive
                    ? "Your saved workflow is ready. Make it live when you want it to take effect."
                    : workflowSummary.empty
                      ? "Create a workflow above before making it live."
                      : "Accept & save a workflow above before making it live."}
              </p>
              <div className="release-toolbar">
                <div className="btn-row tight">
                  <button
                    type="button"
                    className="btn"
                    disabled={locked || !canGoLive}
                    onClick={() => void onGoLive()}
                  >
                    {ui === "going_live"
                      ? "Making it liveâ€¦"
                      : status === "active"
                        ? "Already live"
                        : "Make this live"}
                  </button>
                </div>
                <div className="rollback-row">
                  <span className="rollback-label">
                    Undo â€” go back to the previous version
                  </span>
                  <input
                    className="rollback-input"
                    type="number"
                    min={1}
                    placeholder="Version #"
                    aria-label="Previous version number"
                    disabled={
                      locked || (status !== "active" && status !== "published")
                    }
                    value={rollbackTarget}
                    onChange={(e) => setRollbackTarget(e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn secondary"
                    disabled={
                      locked ||
                      (status !== "active" && status !== "published") ||
                      !rollbackTarget
                    }
                    onClick={() => void onRollback()}
                  >
                    {ui === "rolling_back" ? "Undoingâ€¦" : "Undo"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <aside className="panel panel--simple">
          <h2>At a glance</h2>
          <dl className="panel-list">
            <div className="panel-stat">
              <dt>Status</dt>
              <dd>{statusLabel}</dd>
            </div>
            <div className="panel-stat">
              <dt>Version</dt>
              <dd>{version != null ? `v${version}` : "â€”"}</dd>
            </div>
            <div className="panel-stat">
              <dt>Workflow</dt>
              <dd>
                {workflowSummary.empty
                  ? "Not set up yet"
                  : `${workflowSummary.steps.length} step${workflowSummary.steps.length === 1 ? "" : "s"}`}
              </dd>
            </div>
            <div className="panel-stat">
              <dt>Ready to edit?</dt>
              <dd>
                {clientValidation.ok ? (
                  <span className="ok-text">Yes</span>
                ) : (
                  <span className="err-text">Fix the highlighted fields</span>
                )}
              </dd>
            </div>
          </dl>
          {!canEdit ? (
            <p className="banner warn">
              You can view this agent, but you donâ€™t have permission to edit it.
            </p>
          ) : null}
        </aside>
      </div>
    </section>
  );
}

function friendlyStatus(
  status: string | null | undefined,
  version?: number,
): string {
  const ver = version != null ? ` Â· v${version}` : "";
  switch (status) {
    case "draft":
      return `Draft â€” not live${ver}`;
    case "generated":
    case "compiled":
    case "published":
    case "pending_go_live":
      return `Ready to make live${ver}`;
    case "active":
      return `Live${ver}`;
    default:
      return "Not set up yet";
  }
}

/** Prefer product display names; never show raw keys like matching-agent / SYNTRA. */
function friendlyAgentTitle(raw: string): string {
  let t = raw.trim();
  if (!t) return "Agent";
  t = t.replace(/^SYNTRA\s*[â€”â€“-]\s*/i, "");
  t = t.replace(/^matching-agent$/i, "Candidate matching");
  t = t.replace(/^intake-agent$/i, "Intake");
  t = t.replace(/^copilot$/i, "Recruiter assistant");
  t = t.replace(/-agent$/i, "");
  return t.trim() || "Agent";
}

/**
 * Strip design-doc / seed / engineer phrases from admin-visible prompt text.
 * Returns "" if nothing human-meaningful remains.
 */
function adminFacingPrompt(raw: string): string {
  let text = raw.trim();
  if (!text) return "";

  // Drop known seed / design leftovers.
  text = text
    .replace(/You are SYNTRA\.?\s*/gi, "")
    .replace(/Â§\d+(?:\.\d+)*(?:\s+[A-Za-z][\w\s-]*)?/g, "")
    .replace(/\bdesign\s+Â§\d+(?:\.\d+)*/gi, "")
    .replace(/\bintegration\.?\s*/gi, "")
    .replace(/\bsyntra\.[a-z0-9._-]+/gi, "")
    .replace(/\b[a-z]+\.authored\b/gi, "")
    .replace(/\bgraphKey\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  // If almost nothing left (or only punctuation), treat as blank.
  if (text.length < 8 || /^[.\-â€”,\s]+$/.test(text)) return "";
  return text;
}

function friendlyGenerateError(
  message?: string,
  error?: string,
): string {
  const raw = `${message ?? ""} ${error ?? ""}`.toLowerCase();
  if (
    raw.includes("402") ||
    raw.includes("credits") ||
    raw.includes("can only afford") ||
    raw.includes("insufficient")
  ) {
    return "The language-model account is out of credits (OpenRouter). Add credits, or switch LLM_PROVIDER in .env to groq / gemini / openai, then restart admin-api.";
  }
  if (raw.includes("401") || raw.includes("unauthorized") || raw.includes("invalid api")) {
    return "The language-model API key looks invalid. Check LLM_API_KEY in .env and restart admin-api.";
  }
  if (raw.includes("404") && (raw.includes("model") || raw.includes("no longer available"))) {
    return "That Gemini model name is retired. Set LLM_MODEL=gemini-2.5-flash in .env and restart admin-api.";
  }
  if (
    raw.includes("cannot build yet") ||
    raw.includes("unsupported_request") ||
    raw.includes("capabilities we cannot") ||
    (raw.includes("email") && raw.includes("slack"))
  ) {
    const trimmed = (message ?? "").replace(/^GENERATION_FAILED:\s*/i, "").trim();
    return (
      trimmed ||
      "That request needs steps we cannot build yet. Stick to process JD, process resume, and match."
    );
  }
  if (raw.includes("unclosed json") || raw.includes("max_tokens") || raw.includes("mid-response")) {
    return "The modelâ€™s answer was cut off before the workflow JSON finished. Try Update workflow again â€” we raised the output limit.";
  }
  if (message?.trim()) {
    // Keep it short for the banner
    const trimmed = message.replace(/^GENERATION_FAILED:\s*/i, "").trim();
    return trimmed.length > 220 ? `${trimmed.slice(0, 220)}â€¦` : trimmed;
  }
  return "Couldnâ€™t create the workflow. Your settings were kept â€” try again.";
}

function statusBadgeClass(status: string | null | undefined): string {
  if (status === "generated" || status === "compiled" || status === "published") {
    return "generated";
  }
  if (status === "pending_go_live") return "published";
  if (status === "active") return "active";
  if (status === "compiled") return "compiled";
  return "";
}
