import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  baseFieldsFor,
  buildPolicyFromForm,
  extFieldsFor,
  formFieldsFor,
  getPath,
  setPath,
  valuesFromPolicy,
  type PolicyFieldDesc,
} from "@tekisho/authoring/src/policy-ext-ui.js";
import { listToolKeys } from "@tekisho/authoring/src/tool-registry.js";
import { validateAgentPolicy } from "@tekisho/authoring/src/validate-policy.js";
import {
  generateAgent,
  getAgent,
  savePolicy,
  compileAgent,
  publishAgent,
  activateAgent,
  rollbackAgent,
  type FieldError,
} from "../api";

type EditorState =
  | "idle"
  | "saving"
  | "generating"
  | "compiling"
  | "publishing"
  | "activating"
  | "rolling_back"
  | "success"
  | "validation"
  | "server"
  | "stale";

const TOOL_KEYS = listToolKeys();

function fieldMessage(fields: FieldError[], path: string): string | null {
  return (
    fields.find((f) => f.path === path || f.path.startsWith(`${path}.`))
      ?.message ?? null
  );
}

function SchemaField({
  field,
  value,
  locked,
  error,
  onChange,
}: {
  field: PolicyFieldDesc;
  value: unknown;
  locked: boolean;
  error: string | null;
  onChange: (next: unknown) => void;
}) {
  const id = field.key.replace(/\./g, "-");
  const options =
    field.kind === "tools" ? TOOL_KEYS : (field.options ?? []);

  function toggleMulti(option: string, on: boolean) {
    const cur = Array.isArray(value) ? [...(value as string[])] : [];
    const set = new Set(cur);
    if (on) set.add(option);
    else set.delete(option);
    onChange([...set]);
  }

  const wide =
    field.kind === "textarea" ||
    field.kind === "tools" ||
    field.kind === "multiEnum";
  const fieldClass = [
    "field",
    wide ? "field--wide" : "",
    field.kind === "boolean" ? "field--bool" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={fieldClass}>
      {field.kind !== "boolean" ? (
        <label htmlFor={id}>{field.label}</label>
      ) : null}
      {field.hint ? <div className="hint">{field.hint}</div> : null}

      {field.kind === "textarea" ? (
        <textarea
          id={id}
          disabled={locked}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : null}

      {field.kind === "text" || field.kind === "number" ? (
        <input
          id={id}
          disabled={locked}
          inputMode={field.kind === "number" ? "decimal" : "text"}
          value={value === undefined || value === null ? "" : String(value)}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : null}

      {field.kind === "boolean" ? (
        <label className="check-row">
          <input
            type="checkbox"
            disabled={locked}
            checked={Boolean(value)}
            onChange={(e) => onChange(e.target.checked)}
          />
          <span>{field.label}</span>
        </label>
      ) : null}

      {field.kind === "enum" ? (
        <select
          id={id}
          disabled={locked}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
        >
          {options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      ) : null}

      {field.kind === "multiEnum" || field.kind === "tools" ? (
        <div
          className={field.kind === "tools" ? "chip-grid" : "check-grid"}
          role="group"
          aria-label={field.label}
        >
          {options.map((opt) => {
            const on = Array.isArray(value) && value.includes(opt);
            if (field.kind === "tools") {
              return (
                <button
                  key={opt}
                  type="button"
                  className={`chip${on ? " on" : ""}`}
                  disabled={locked}
                  aria-pressed={on}
                  onClick={() => toggleMulti(opt, !on)}
                >
                  {opt}
                </button>
              );
            }
            return (
              <label key={opt} className="check-row">
                <input
                  type="checkbox"
                  disabled={locked}
                  checked={on}
                  onChange={(e) => toggleMulti(opt, e.target.checked)}
                />
                <span>{opt}</span>
              </label>
            );
          })}
        </div>
      ) : null}

      {error ? <div className="field-error">{error}</div> : null}
    </div>
  );
}

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

  const busy =
    ui === "saving" ||
    ui === "generating" ||
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
      const res = await getAgent(id);
      if (cancelled) return;
      if (!res.ok) {
        setLoadError(
          res.body.message ?? res.body.error ?? "Failed to load agent",
        );
        setLoading(false);
        return;
      }

      const pe = res.data.template?.policyExt ?? "";
      const catalog = formFieldsFor(pe);
      const base =
        (res.data.template?.baseFields as PolicyFieldDesc[] | undefined) ??
        catalog.base;
      const ext =
        (res.data.template?.policyExtFields as PolicyFieldDesc[] | undefined) ??
        (pe ? catalog.ext : extFieldsFor(pe));
      const resolvedBase = base.length ? base : baseFieldsFor();
      const resolvedExt = pe ? (ext.length ? ext : catalog.ext) : [];

      setName(res.data.name);
      setPurpose(res.data.purpose);
      setCanEdit(res.data.canEdit);
      setVersion(res.data.policy?.version);
      setStatus(res.data.policy?.status ?? null);
      setChecksum(res.data.policy?.checksum ?? null);
      setAgentKey(res.data.template?.agentKey ?? "");
      setPolicyExt(pe);
      setBaseFields(resolvedBase);
      setExtFields(resolvedExt);
      setValues(
        valuesFromPolicy(res.data.policy?.policy ?? null, [
          ...resolvedBase,
          ...resolvedExt,
        ]),
      );
      if (!res.data.template) {
        setLoadError("No agent template for this agent (agent_templates).");
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

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

  const generateDisabled =
    locked || loading || !clientValidation.ok || !policyExt;

  function setFieldValue(key: string, value: unknown) {
    setValues((prev) => setPath(prev, key, value));
    setUi("idle");
    setFields([]);
  }

  async function onSave() {
    const v = validateAgentPolicy(payload, { policyExt });
    if (!v.ok) {
      setUi("validation");
      setFields(v.fields);
      setBanner("Fix validation errors before saving.");
      return;
    }

    setUi("saving");
    setBanner(null);
    setFields([]);
    const res = await savePolicy(id, v.policy, version);
    if (!res.ok) {
      if (res.body.error === "STALE_POLICY") {
        setUi("stale");
        setBanner(
          `This agent was changed elsewhere (version ${res.body.currentVersion}). Reload and try again.`,
        );
        return;
      }
      if (res.body.error === "POLICY_INVALID") {
        setUi("validation");
        setFields(res.body.fields ?? []);
        setBanner("Policy invalid.");
        return;
      }
      setUi("server");
      setBanner(res.body.message ?? res.body.error ?? "Save failed.");
      return;
    }

    setVersion(res.data.version);
    setStatus(res.data.status);
    setUi("idle");
    setBanner(`Saved as draft (v${res.data.version}).`);
  }

  async function onGenerate() {
    const v = validateAgentPolicy(payload, { policyExt });
    if (!v.ok) {
      setUi("validation");
      setFields(v.fields);
      setBanner("Fix validation errors before generating.");
      return;
    }

    let expectedVersion = version;
    if (expectedVersion === undefined || status !== "draft") {
      setUi("saving");
      const saved = await savePolicy(id, v.policy, version);
      if (!saved.ok) {
        if (saved.body.error === "STALE_POLICY") {
          setUi("stale");
          setBanner(
            `This agent was changed elsewhere (version ${saved.body.currentVersion}). Reload and try again.`,
          );
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

    setUi("generating");
    setBanner(null);
    setFields([]);

    const res = await generateAgent(id, v.policy, expectedVersion);
    if (!res.ok) {
      if (res.body.error === "STALE_POLICY") {
        setUi("stale");
        setBanner(
          `This agent was changed elsewhere (version ${res.body.currentVersion}). Reload and try again.`,
        );
        return;
      }
      if (res.body.error === "POLICY_INVALID") {
        setUi("validation");
        setFields(res.body.fields ?? []);
        setBanner("Policy invalid — nothing written.");
        return;
      }
      setUi("server");
      setBanner(
        res.body.message ??
          res.body.error ??
          "Generation failed, try again. Draft preserved.",
      );
      return;
    }

    setVersion(res.data.version);
    setStatus(res.data.status);
    setChecksum(res.data.checksum);
    setUi("success");
    setBanner(
      `Generated v${res.data.version}${res.data.graphKey ? ` · ${res.data.graphKey}` : ""} · ${new Date(res.data.generatedAt).toLocaleString()}`,
    );
  }

  async function runStage(
    action: "compile" | "publish" | "activate",
    call: () => ReturnType<typeof compileAgent>,
  ) {
    setUi(
      action === "compile"
        ? "compiling"
        : action === "publish"
          ? "publishing"
          : "activating",
    );
    setBanner(null);
    const res = await call();
    if (!res.ok) {
      if (res.body.error === "STALE_POLICY") {
        setUi("stale");
        setBanner(
          `Version changed elsewhere (current ${res.body.currentVersion}). Reload.`,
        );
        return;
      }
      setUi("server");
      setBanner(res.body.message ?? res.body.error ?? `${action} failed.`);
      return;
    }
    setVersion(res.data.version);
    setStatus(res.data.status);
    setChecksum(res.data.checksum);
    setUi("success");
    setBanner(
      `${action[0]!.toUpperCase()}${action.slice(1)}d v${res.data.version}${
        res.data.graphKey ? ` · ${res.data.graphKey}` : ""
      } (authored key only — does not remount runtime *.workflow).`,
    );
  }

  async function onCompile() {
    await runStage("compile", () => compileAgent(id, version));
  }

  async function onPublish() {
    await runStage("publish", () => publishAgent(id, version));
  }

  async function onActivate() {
    await runStage("activate", () => activateAgent(id, version));
  }

  async function onRollback() {
    const target = Number(rollbackTarget);
    if (!Number.isFinite(target) || target <= 0) {
      setUi("validation");
      setBanner("Enter a prior published version number to roll back to.");
      return;
    }
    setUi("rolling_back");
    setBanner(null);
    const res = await rollbackAgent(id, target);
    if (!res.ok) {
      setUi("server");
      setBanner(res.body.message ?? res.body.error ?? "Rollback failed.");
      return;
    }
    setVersion(res.data.version);
    setStatus(res.data.status);
    setChecksum(res.data.checksum);
    setUi("success");
    setBanner(
      `Rolled back to authored v${res.data.rolledBackTo} · ${res.data.graphKey} (runtime *.workflow untouched).`,
    );
  }

  if (loading) {
    return <div className="loading">Loading policy…</div>;
  }

  if (loadError && !policyExt) {
    return (
      <section>
        <Link className="back-link" to="/">
          ← Agents
        </Link>
        <div className="banner err">{loadError}</div>
      </section>
    );
  }

  const bannerClass =
    ui === "success" || (ui === "idle" && banner?.startsWith("Saved"))
      ? "ok"
      : ui === "stale"
        ? "warn"
        : ui === "server" || ui === "validation"
          ? "err"
          : banner
            ? "ok"
            : "";

  const stageOrder = ["draft", "generated", "compiled", "published", "active"] as const;
  const stageIndex = Math.max(
    0,
    stageOrder.indexOf(
      (status === "draft" ||
      status === "generated" ||
      status === "compiled" ||
      status === "published" ||
      status === "active"
        ? status
        : "draft") as (typeof stageOrder)[number],
    ),
  );

  function pipelineClass(step: "generated" | "compiled" | "published" | "active") {
    const idx = stageOrder.indexOf(step);
    if (stageIndex > idx) return "done";
    if (stageIndex === idx && status === step) return "current";
    return "";
  }

  return (
    <section className="editor-page">
      <Link className="back-link" to="/">
        ← Agents
      </Link>

      <header className="editor-hero">
        <div className="editor-hero-text">
          <h1>{name}</h1>
          <p>{purpose}</p>
        </div>
        <div className="editor-hero-meta">
          <span className={`badge ${statusBadgeClass(status)}`}>
            {status ?? "no policy"}
          </span>
          <span className="meta-pill">v{version ?? "—"}</span>
          <span className="meta-pill mono">{agentKey || "—"}</span>
        </div>
      </header>

      {banner ? <div className={`banner ${bannerClass}`}>{banner}</div> : null}

      <div className="editor-layout">
        <div className="editor-main">
          <div className="section-card policy-card">
            <div className="section-head">
              <div>
                <h2>Policy</h2>
                <p className="muted">
                  Shared base + template fields. Save a draft, then generate the
                  graph.
                </p>
              </div>
            </div>

            <div className="form-block">
              <h3 className="form-block-title">Shared base</h3>
              <div className="field-grid">
                {baseFields.map((f) => (
                  <SchemaField
                    key={f.key}
                    field={f}
                    value={getPath(values, f.key)}
                    locked={locked}
                    error={fieldMessage(fields, f.key)}
                    onChange={(next) => setFieldValue(f.key, next)}
                  />
                ))}
              </div>
            </div>

            <div className="form-block">
              <h3 className="form-block-title">
                {policyExt || "Extension"}
              </h3>
              {extFields.length === 0 ? (
                <p className="muted">No extension fields for this template.</p>
              ) : (
                <div className="field-grid">
                  {extFields.map((f) => (
                    <SchemaField
                      key={f.key}
                      field={f}
                      value={getPath(values, f.key)}
                      locked={locked}
                      error={fieldMessage(fields, f.key)}
                      onChange={(next) => setFieldValue(f.key, next)}
                    />
                  ))}
                </div>
              )}
            </div>

            <div className="card-actions">
              <button
                type="button"
                className="btn secondary"
                disabled={locked || !policyExt}
                onClick={() => void onSave()}
              >
                {ui === "saving" ? "Saving…" : "Save draft"}
              </button>
              <button
                type="button"
                className="btn"
                disabled={generateDisabled}
                onClick={() => void onGenerate()}
              >
                {ui === "generating" ? "Generating…" : "Generate"}
              </button>
            </div>
          </div>

          <div className="section-card">
            <div className="section-head">
              <div>
                <h2>Release</h2>
                <p className="muted">
                  Authored graph key only — does not remount runtime{" "}
                  <code>*.workflow</code>.
                </p>
              </div>
            </div>

            <ol className="pipeline" aria-label="Release stages">
              {(
                [
                  ["generated", "Generate"],
                  ["compiled", "Compile"],
                  ["published", "Publish"],
                  ["active", "Activate"],
                ] as const
              ).map(([key, label], i) => (
                <li key={key} className={`pipeline-step ${pipelineClass(key)}`}>
                  <span className="step-num">{String(i + 1).padStart(2, "0")}</span>
                  <span className="step-label">{label}</span>
                </li>
              ))}
            </ol>

            <div className="release-toolbar">
              <div className="btn-row tight">
                <button
                  type="button"
                  className="btn secondary"
                  disabled={locked || status !== "generated"}
                  onClick={() => void onCompile()}
                >
                  {ui === "compiling" ? "Compiling…" : "Compile"}
                </button>
                <button
                  type="button"
                  className="btn secondary"
                  disabled={locked || status !== "compiled"}
                  onClick={() => void onPublish()}
                >
                  {ui === "publishing" ? "Publishing…" : "Publish"}
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={locked || status !== "published"}
                  onClick={() => void onActivate()}
                >
                  {ui === "activating" ? "Activating…" : "Activate"}
                </button>
              </div>
              <div className="rollback-row">
                <input
                  className="rollback-input"
                  type="number"
                  min={1}
                  placeholder="Rollback to v#"
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
                  {ui === "rolling_back" ? "Rolling back…" : "Rollback"}
                </button>
              </div>
            </div>
          </div>
        </div>

        <aside className="panel">
          <h2>Details</h2>
          <dl className="panel-list">
            <div className="panel-stat">
              <dt>Template</dt>
              <dd>
                <code>{policyExt || "—"}</code>
              </dd>
            </div>
            <div className="panel-stat">
              <dt>Agent key</dt>
              <dd>
                <code>{agentKey || "—"}</code>
              </dd>
            </div>
            <div className="panel-stat">
              <dt>Checksum</dt>
              <dd className="mono">
                {checksum ? `${checksum.slice(0, 12)}…` : "—"}
              </dd>
            </div>
            <div className="panel-stat">
              <dt>Fields</dt>
              <dd>
                {baseFields.length} + {extFields.length}
              </dd>
            </div>
            <div className="panel-stat">
              <dt>Validation</dt>
              <dd>
                {clientValidation.ok ? (
                  <span className="ok-text">ready</span>
                ) : (
                  <span className="err-text">
                    {"fields" in clientValidation
                      ? clientValidation.fields[0]?.message
                      : "invalid"}
                  </span>
                )}
              </dd>
            </div>
          </dl>
          {!canEdit ? (
            <p className="banner warn">You do not have edit entitlement.</p>
          ) : null}
        </aside>
      </div>
    </section>
  );
}

function statusBadgeClass(status: string | null | undefined): string {
  if (status === "generated") return "generated";
  if (status === "active") return "active";
  if (status === "published") return "published";
  if (status === "compiled") return "compiled";
  return "";
}
