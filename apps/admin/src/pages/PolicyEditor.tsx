import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import {
  buildPolicyFromForm,
  enrichPolicyFromDefaults,
  formFieldsFor,
  getPath,
  policyMainFieldsFor,
  setPath,
  valuesFromPolicy,
  type PolicyFieldDesc,
} from "@tekisho/authoring/src/policy-ext-ui.js";
import { validateAgentPolicy } from "@tekisho/authoring/src/validate-policy.js";
import {
  parseStoredGraphArtifact,
  summarizeGraphWorkflow,
} from "@tekisho/authoring/src/summarize-graph.js";
import {
  mergeWorkflowIntoPolicyValues,
  stripWorkflowSectionFromPrompt,
} from "@tekisho/authoring/src/sync-policy-from-workflow.js";
import type { GraphDefinition } from "@tekisho/authoring/src/graph-definition.js";
import {
  readGenerationMeta,
  generationMetaToTrace,
} from "@tekisho/authoring/src/generation-meta.js";
import {
  generateAgent,
  getAgent,
  getBuilderOverview,
  savePolicy,
  goLive,
  takeOffline,
  rollbackAgent,
  type AgentDetail,
  type FieldError,
} from "../api";
import type { GenerationTrace } from "@tekisho/authoring/src/generation-meta.js";
import { outOfScopeLabels } from "@tekisho/authoring/src/request-scope.js";
import {
  friendlyUnsupportedGap,
  friendlyUnsupportedSummary,
} from "../lib/friendly-labels";
import { WorkflowPreviewSummary } from "../components/WorkflowPreviewSummary";
import { GraphArtifactsPanel } from "../components/GraphArtifactsPanel";
import {
  WorkflowCanvas,
  stepsToLinearGraph,
  workflowStepsFromDefinition,
  type WorkflowStep,
} from "../components/WorkflowCanvas";
import { AdminHelpPanel } from "../components/AdminHelpPanel";
import { PolicyGraphExplainer } from "../components/PolicyGraphExplainer";
import { WorkflowStatusStepper } from "../components/WorkflowStatusStepper";
import {
  deriveWorkflowPhase,
  friendlyBindingConflict,
} from "../lib/policy-workflow-guide";
import { policyEditorIngressLabel } from "../lib/agent-status";
import { friendlyEventLabel } from "../lib/platform-narrative";

type PolicyEditorProps = {
  agentId?: string;
  embedded?: boolean;
  onAgentUpdated?: () => void;
};

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
  generationTrace?: GenerationTrace | null;
};

export function PolicyEditorPage({
  agentId: agentIdProp,
  embedded = false,
  onAgentUpdated,
}: PolicyEditorProps = {}) {
  const { id: routeId = "" } = useParams();
  const id = agentIdProp ?? routeId;
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [canEdit, setCanEdit] = useState(false);
  const [version, setVersion] = useState<number | undefined>(undefined);
  const [status, setStatus] = useState<string | null>(null);
  const [checksum, setChecksum] = useState<string | null>(null);
  const [agentKey, setAgentKey] = useState("");
  const [policyExt, setPolicyExt] = useState("");
  const [mainPolicyFields, setMainPolicyFields] = useState<PolicyFieldDesc[]>([]);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [toolCatalog, setToolCatalog] = useState<
    Array<{ key: string; description: string }>
  >([]);
  const [goLiveChecks, setGoLiveChecks] = useState<
    Array<{ id: string; ok: boolean; message: string }> | null
  >(null);
  const [bindingConflictHint, setBindingConflictHint] = useState<string | null>(
    null,
  );
  const [ui, setUi] = useState<EditorState>("idle");
  const [banner, setBanner] = useState<string | null>(null);
  const [fields, setFields] = useState<FieldError[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rollbackTarget, setRollbackTarget] = useState("");
  const [workflowDef, setWorkflowDef] = useState<GraphDefinition | null>(null);
  const [pendingPreview, setPendingPreview] = useState<PendingPreview | null>(
    null,
  );
  const [runtime, setRuntime] = useState<AgentDetail["runtime"] | null>(null);
  const [agentTemplate, setAgentTemplate] = useState<Record<string, unknown> | null>(
    null,
  );
  const [savedPolicyPrompt, setSavedPolicyPrompt] = useState("");
  const [activityLog, setActivityLog] = useState<string[]>([]);
  const [lastGenerationTrace, setLastGenerationTrace] =
    useState<GenerationTrace | null>(null);
  const [editingPolicy, setEditingPolicy] = useState(false);
  const [workflowOutOfDate, setWorkflowOutOfDate] = useState(false);
  const [editingWorkflow, setEditingWorkflow] = useState(false);
  const [workflowSteps, setWorkflowSteps] = useState<WorkflowStep[]>([]);
  const [lastUnsupported, setLastUnsupported] = useState<string[]>([]);
  const policySectionRef = useRef<HTMLDivElement>(null);

  function pushActivity(message: string) {
    const line = `${new Date().toLocaleTimeString()} — ${message}`;
    setActivityLog((prev) => [line, ...prev].slice(0, 12));
  }

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

  useEffect(() => {
    if (!id.trim()) {
      setLoading(false);
      setLoadError(null);
      return;
    }
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

  useEffect(() => {
    if (embedded) setEditingPolicy(false);
  }, [id, embedded]);

  useEffect(() => {
    setWorkflowOutOfDate(false);
    setPendingPreview(null);
    setEditingWorkflow(false);
  }, [id]);

  useEffect(() => {
    if (!editingWorkflow) {
      const def = pendingPreview?.definition ?? workflowDef;
      setWorkflowSteps(workflowStepsFromDefinition(def));
    }
  }, [workflowDef, pendingPreview, editingWorkflow]);

  useEffect(() => {
    void getBuilderOverview().then((res) => {
      if (res.ok) {
        setToolCatalog(
          res.data.tools.map((t) => ({
            key: t.key,
            description: t.description,
          })),
        );
      }
    });
  }, []);

  async function syncFromServer(): Promise<boolean> {
    const res = await getAgent(id);
    if (!res.ok) {
      setLoadError(
        res.body.message ?? res.body.error ?? "Failed to load agent",
      );
      return false;
    }

    const pe = res.data.template?.policyExt ?? "";
    const mainFields = policyMainFieldsFor(pe);
    const enrichFields = formFieldsFor(pe).all;

    setName(res.data.template?.displayName ?? res.data.name);
    setPurpose(res.data.purpose);
    setCanEdit(res.data.canEdit);
    setVersion(res.data.policy?.version);
    setStatus(res.data.policy?.status ?? null);
    setChecksum(res.data.policy?.checksum ?? null);
    setAgentKey(res.data.template?.agentKey ?? "");
    setPolicyExt(pe);
    setMainPolicyFields(mainFields);
    const tmpl = res.data.template?.template ?? null;
    setAgentTemplate(tmpl && typeof tmpl === "object" ? tmpl : null);
    let cleanedPrompt = "";
    setValues(() => {
      const vals = valuesFromPolicy(res.data.policy?.policy ?? null, enrichFields);
      const rawPrompt = String(getPath(vals, "prompt") ?? "");
      cleanedPrompt = adminFacingPrompt(stripWorkflowSectionFromPrompt(rawPrompt));
      return setPath(vals, "prompt", cleanedPrompt);
    });
    setSavedPolicyPrompt(cleanedPrompt);
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
    setRuntime(res.data.runtime ?? null);
    const genMeta = res.data.generation
      ? readGenerationMeta(res.data.generation)
      : null;
    if (genMeta) {
      setLastGenerationTrace(
        generationMetaToTrace(genMeta, parsed ?? workflowDef),
      );
      setLastUnsupported(genMeta.unsupported ?? []);
    } else {
      setLastUnsupported([]);
    }
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

  const allPolicyFields = useMemo(
    () => (policyExt ? formFieldsFor(policyExt).all : []),
    [policyExt],
  );

  const payload = useMemo(
    () =>
      enrichPolicyFromDefaults(
        buildPolicyFromForm(id, agentKey, values, allPolicyFields),
        policyExt,
      ),
    [id, agentKey, values, allPolicyFields, policyExt],
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

  const displayWorkflowSummary = useMemo(() => {
    const def = pendingPreview?.definition ?? workflowDef;
    return summarizeGraphWorkflow(def);
  }, [pendingPreview, workflowDef]);

  const policyText = String(getPath(values, "prompt") ?? "").trim();
  const displayPolicyText = stripWorkflowSectionFromPrompt(policyText);
  const policyDirty =
    savedPolicyPrompt.trim() !== policyText &&
    policyText.length > 0 &&
    !workflowSummary.empty;

  const workflowPhase = deriveWorkflowPhase({
    policyText,
    status,
    ui,
    hasGraph: !workflowSummary.empty,
    policyDirty,
    hasUnsavedPreview: pendingPreview !== null,
  });

  const explainerDefinition = pendingPreview?.definition ?? workflowDef;
  const explainerMode: "planned" | "generated" | "preview" = pendingPreview
    ? "preview"
    : workflowSummary.empty
      ? "planned"
      : "generated";

  const generateDisabledReason = useMemo(() => {
    if (loading) return "Loading agent…";
    if (!canEdit) return "You do not have permission to edit this agent.";
    if (pendingPreview) return "Accept or discard the preview first.";
    if (!policyExt) return "Missing template configuration.";
    if (!clientValidation.ok) {
      const first = clientValidation.fields[0];
      return first
        ? `Fix policy: ${first.path} — ${first.message}`
        : "Enter your policy in the Policy Box above.";
    }
    if (!policyText) {
      return "Enter a policy description — it is sent to the LLM to build the graph.";
    }
    return null;
  }, [
    loading,
    canEdit,
    pendingPreview,
    policyExt,
    clientValidation,
    policyText,
  ]);

  const generateDisabled =
    locked ||
    loading ||
    !clientValidation.ok ||
    !policyExt ||
    !policyText ||
    pendingPreview !== null;

  function updateField(key: string, value: unknown) {
    setValues((prev) => setPath({ ...prev }, key, value));
    setUi("idle");
  }

  async function onSaveDraft() {
    const v = validateAgentPolicy(payload, { policyExt });
    if (!v.ok) {
      setUi("validation");
      setFields(v.fields);
      setBanner("Fix validation errors before saving.");
      return;
    }
    setUi("saving");
    const strippedPrompt = stripWorkflowSectionFromPrompt(
      String(v.policy.prompt ?? ""),
    );
    const policyToSave = { ...v.policy, prompt: strippedPrompt };
    const saved = await savePolicy(id, policyToSave, version);
    if (!saved.ok) {
      if (saved.body.error === "STALE_POLICY") {
        await handleStale(saved.body.currentVersion);
        return;
      }
      setUi("server");
      setBanner(saved.body.message ?? saved.body.error ?? "Save failed");
      return;
    }
    setVersion(saved.data.version);
    setStatus(saved.data.status);
    setSavedPolicyPrompt(strippedPrompt);
    setValues((prev) => setPath(prev, "prompt", strippedPrompt));
    setUi("success");
    setBanner(`Saved draft v${saved.data.version}.`);
    pushActivity(`Saved policy draft v${saved.data.version}`);
    if (embedded) setEditingPolicy(false);
    if (workflowDef) {
      setWorkflowOutOfDate(true);
    }
    onAgentUpdated?.();
  }

  function discardPreview() {
    setPendingPreview(null);
    setUi("idle");
    setBanner(null);
  }

  function applyWorkflowToPolicyValues(
    def: GraphDefinition | null | undefined,
  ): Record<string, unknown> {
    if (!def) return values;
    return mergeWorkflowIntoPolicyValues(values, def, allPolicyFields);
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
    if (policyDirty) {
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
      setSavedPolicyPrompt(policyText);
      if (workflowDef) {
        setWorkflowOutOfDate(true);
      }
    } else if (status !== "generated" && status !== "pending_go_live") {
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

    const request = policyText;
    const res = await generateAgent(
      id,
      v.policy,
      expectedVersion,
      {
        mode: "llm",
        request,
        preview: true,
      },
    );
    if (!res.ok) {
      if (res.body.error === "STALE_POLICY") {
        await handleStale(res.body.currentVersion);
        return;
      }
      if (res.body.error === "POLICY_INVALID") {
        setUi("validation");
        setFields(res.body.fields ?? []);
        setBanner("Policy invalid — nothing written.");
        pushActivity(
          `Generate failed: POLICY_INVALID — ${(res.body.fields ?? [])
            .map((f) => f.path)
            .join(", ")}`,
        );
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
      pushActivity(
        `Generate failed: ${res.body.error ?? "error"} — ${res.body.message ?? ""}`,
      );
      return;
    }

    if (res.data.preview && res.data.definition) {
      const def = res.data.definition as GraphDefinition;
      setPendingPreview({
        definition: def,
        unsupported: res.data.unsupported ?? [],
        builtSummary: res.data.builtSummary ?? null,
        request,
        message: res.data.message,
        generationTrace: res.data.generationTrace ?? null,
      });
      setWorkflowOutOfDate(false);
      setEditingWorkflow(false);
      setLastGenerationTrace(res.data.generationTrace ?? null);
      const gaps = res.data.unsupported ?? [];
      setLastUnsupported(gaps);
      setUi("preview");
      setBanner(
        gaps.length > 0
          ? `Could not add: ${gaps.join(", ")} — not in Syntra's current tool scope. The workflow was built without those steps.`
          : "Preview created — not saved yet. Review below, then Accept & save to persist.",
      );
      pushActivity(
        `LLM preview: ${res.data.graphKey ?? "graph"} — ${request.slice(0, 80)}${
          request.length > 80 ? "…" : ""
        }`,
      );
      return;
    }

    setVersion(res.data.version);
    setStatus(res.data.status);
    if (res.data.checksum) setChecksum(res.data.checksum);
    const def = res.data.definition;
    if (def && typeof def === "object") {
      setWorkflowDef(def as GraphDefinition);
    } else {
      await syncFromServer();
    }
    setUi("success");
    setBanner(
      `Workflow created (v${res.data.version}). Review the mapping below, then Make live.`,
    );
    setSavedPolicyPrompt(policyText);
    pushActivity(
      `Generated v${res.data.version}: ${res.data.graphKey} (${
        Array.isArray((res.data.definition as GraphDefinition | undefined)?.nodes)
          ? (res.data.definition as GraphDefinition).nodes.length
          : 0
      } nodes)`,
    );
    onAgentUpdated?.();
  }

  async function onAcceptPreview() {
    if (!pendingPreview || !id) return;

    const syncedValues = applyWorkflowToPolicyValues(pendingPreview.definition);
    setValues(syncedValues);
    const syncedPayload = enrichPolicyFromDefaults(
      buildPolicyFromForm(id, agentKey, syncedValues, allPolicyFields),
      policyExt,
    );
    const v = validateAgentPolicy(syncedPayload, { policyExt });
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
      request: String(getPath(syncedValues, "prompt") ?? "").trim(),
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
    setLastGenerationTrace(
      res.data.generationTrace ?? pendingPreview.generationTrace ?? null,
    );
    setWorkflowOutOfDate(false);
    setUi("success");
    setBanner(
      "Workflow saved. Policy text updated to match steps — make it live when ready.",
    );
    setSavedPolicyPrompt(String(getPath(syncedValues, "prompt") ?? "").trim());
    pushActivity(`Accepted workflow v${res.data.version}`);
    onAgentUpdated?.();
  }

  async function onGoLive() {
    if (status === "active") {
      setUi("success");
      setBanner(
        runtime?.binding
          ? `Already live (v${version}) — routes ${runtime.binding.eventType} → ${runtime.binding.graphKey}`
          : `Already live (v${version}).`,
      );
      pushActivity(`Already live at v${version}`);
      return;
    }

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
    setBanner("Making it live…");
    pushActivity("Go-live started — running safety checks…");
    const res = await goLive(id, version);
    if (!res.ok) {
      if (res.body.error === "STALE_POLICY") {
        await handleStale(res.body.currentVersion);
        return;
      }
      if (res.body.error === "ALREADY_LIVE") {
        await syncFromServer();
        setUi("success");
        setBanner(res.body.message ?? "This agent is already live.");
        pushActivity("Already live");
        return;
      }
      if (res.body.error === "GO_LIVE_BLOCKED") {
        setUi("validation");
        setGoLiveChecks(res.body.checks ?? null);
        const blocked = res.body.blockedBy?.join(", ") ?? "safety checks";
        setBanner(
          res.body.message ??
            `Can't go live yet: ${blocked} failed.`,
        );
        pushActivity(
          `Go-live blocked: ${res.body.message ?? blocked}`,
        );
        return;
      }
      if (
        res.body.error === "EVENT_ALREADY_BOUND" ||
        res.body.error === "GO_LIVE_FAILED"
      ) {
        setUi("validation");
        setBindingConflictHint(
          "Another agent is already active for this trigger event. Change «When this runs» above to a different event, or ask which agent should own this trigger.",
        );
        const msg = friendlyBindingConflict(
          res.body.message ?? "Trigger event is already used by another live agent.",
        );
        setBanner(msg);
        pushActivity(`Go-live blocked: ${res.body.error}`);
        return;
      }
      setUi("server");
      setBanner(
        res.body.message ??
          res.body.error ??
          "Couldn't make this live. Production was not changed.",
      );
      pushActivity(
        `Go-live failed: ${res.body.error ?? "error"} — ${res.body.message ?? ""}`,
      );
      return;
    }

    setStatus(res.data.status);
    if (res.data.version != null) setVersion(res.data.version);
    if (res.data.checksum != null) setChecksum(res.data.checksum);
    setGoLiveChecks(res.data.checks ?? null);
    setBindingConflictHint(null);
    await syncFromServer();
    setUi("success");
    const liveVer = res.data.version ?? version;
    const liveMsg =
      res.data.message ??
      (liveVer != null
        ? `This agent is now live (version ${liveVer}).`
        : "This agent is now live.");
    setBanner(liveMsg);
    const passed =
      res.data.checks?.filter((c) => c.ok).length ?? 0;
    const total = res.data.checks?.length ?? 0;
    pushActivity(
      `Go-live success: v${liveVer}${res.data.graphKey ? ` → ${res.data.graphKey}` : ""}${
        total ? ` (${passed}/${total} checks passed)` : ""
      }`,
    );
    onAgentUpdated?.();
  }

  async function onTakeOffline() {
    const confirmed = window.confirm(
      "Take this agent offline?\n\nNew uploads will stop using this workflow until you make it live again.",
    );
    if (!confirmed) return;

    setUi("going_live");
    setBanner(null);
    const res = await takeOffline(id, version);
    if (!res.ok) {
      if (res.body.error === "STALE_POLICY") {
        await handleStale(res.body.currentVersion);
        return;
      }
      setUi("server");
      setBanner(
        res.body.message ?? res.body.error ?? "Could not take agent offline.",
      );
      return;
    }
    await syncFromServer();
    setUi("success");
    setBanner(res.data.message ?? "Agent taken offline.");
    setGoLiveChecks(null);
    onAgentUpdated?.();
  }

  async function onSaveWorkflowManual() {
    const graphKey =
      workflowDef?.graphKey ??
      pendingPreview?.definition.graphKey ??
      `${agentKey}.authored`;
    const def = stepsToLinearGraph(graphKey, workflowSteps);
    if (!def) {
      setBanner("Add at least one workflow step.");
      return;
    }

    const syncedValues = applyWorkflowToPolicyValues(def);
    setValues(syncedValues);

    const syncedPayload = enrichPolicyFromDefaults(
      buildPolicyFromForm(id, agentKey, syncedValues, allPolicyFields),
      policyExt,
    );
    const v = validateAgentPolicy(syncedPayload, { policyExt });
    if (!v.ok) {
      setUi("validation");
      setFields(v.fields);
      setBanner("Fix policy errors before saving workflow.");
      return;
    }

    setUi("accepting");
    setBanner(null);
    const res = await generateAgent(id, v.policy, version, {
      mode: "llm",
      accept: true,
      definition: def,
      request: String(getPath(syncedValues, "prompt") ?? "").trim(),
    });
    if (!res.ok) {
      if (res.body.error === "STALE_POLICY") {
        await handleStale(res.body.currentVersion);
        return;
      }
      setUi("server");
      setBanner(
        friendlyGenerateError(res.body.message, res.body.error) ||
          "Could not save workflow.",
      );
      return;
    }

    setVersion(res.data.version);
    setStatus(res.data.status);
    setChecksum(res.data.checksum ?? null);
    if (res.data.definition && typeof res.data.definition === "object") {
      setWorkflowDef(res.data.definition as GraphDefinition);
    } else {
      setWorkflowDef(def);
    }
    setPendingPreview(null);
    setWorkflowOutOfDate(false);
    setEditingWorkflow(false);
    setLastGenerationTrace(res.data.generationTrace ?? null);
    setUi("success");
    setBanner("Workflow saved — policy updated to match steps.");
    setSavedPolicyPrompt(String(getPath(syncedValues, "prompt") ?? "").trim());
    onAgentUpdated?.();
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
    await syncFromServer();
    setUi("success");
    setBanner(`Restored version ${res.data.rolledBackTo}. It's live again.`);
    pushActivity(`Rollback to v${res.data.rolledBackTo}`);
    onAgentUpdated?.();
  }

  if (loading) {
    return <div className="loading">Loading policyâ€¦</div>;
  }

  if (loadError && !policyExt) {
    return (
      <section>
        {!embedded ? (
          <Link className="back-link" to="/builder">
            ← Builder
          </Link>
        ) : null}
        <div className="banner err">{loadError}</div>
      </section>
    );
  }

  const policyScopeGaps = outOfScopeLabels(policyText);
  const previewGaps = pendingPreview?.unsupported ?? [];
  const bannerClass =
    ui === "success" || (ui === "idle" && banner?.startsWith("Saved"))
      ? "ok"
      : ui === "preview"
        ? previewGaps.length > 0
          ? "err"
          : "warn"
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
  const simpleLayout = embedded;
  const isAgentLive =
    status === "active" || Boolean(runtime?.binding?.eventType);
  const showBanner =
    banner &&
    (!simpleLayout ||
      bannerClass === "err" ||
      bannerClass === "warn" ||
      ui === "preview");

  const hasWorkflow = !displayWorkflowSummary.empty;

  function renderWorkflowGenerateActions(placement: "policy" | "workflow") {
    if (simpleLayout && placement === "policy") return null;
    if (simpleLayout && placement === "workflow") {
      if (editingWorkflow || pendingPreview) return null;
      if (hasWorkflow) return null;
      return (
        <div className="workflow-generate-bar workflow-generate-bar--workflow workflow-generate-bar--simple">
          <button
            type="button"
            className="btn btn--compact"
            disabled={generateDisabled}
            onClick={() => void onGenerate()}
          >
            {ui === "generating" ? "Generating…" : "Generate workflow"}
          </button>
          {generateDisabled && generateDisabledReason ? (
            <p className="hint generate-hint" role="status">
              {generateDisabledReason}
            </p>
          ) : workflowOutOfDate && hasWorkflow ? (
            <p className="workflow-generate-bar-hint" role="status">
              Policy changed — update the workflow to match.
            </p>
          ) : null}
        </div>
      );
    }

    const barDisabled =
      placement === "policy"
        ? generateDisabled || editingWorkflow
        : generateDisabled;
    const barReason =
      placement === "policy" && editingWorkflow
        ? "Finish editing workflow steps first, or cancel with ✕."
        : generateDisabledReason;

    return (
      <div
        className={`workflow-generate-bar workflow-generate-bar--${placement}${
          workflowOutOfDate && hasWorkflow && !editingWorkflow
            ? " workflow-generate-bar--stale"
            : ""
        }`}
      >
        <p className="workflow-generate-bar-title">
          {placement === "policy"
            ? "Workflow from policy"
            : "Build workflow from policy"}
        </p>
        {placement === "workflow" && editingWorkflow ? (
          <p className="workflow-generate-bar-hint muted">
            You are editing steps manually — save with <strong>Save steps</strong>,
            or regenerate from policy below (replaces manual edits).
          </p>
        ) : workflowOutOfDate && hasWorkflow ? (
          <p className="workflow-generate-bar-hint" role="status">
            Policy was saved — click <strong>Regenerate workflow</strong> to
            rebuild steps from your latest policy.
          </p>
        ) : !hasWorkflow ? (
          <p className="workflow-generate-bar-hint muted">
            Save your policy first, then generate a workflow from that text.
          </p>
        ) : null}
        <div className="workflow-generate-bar-actions">
          <button
            type="button"
            className="btn btn--compact"
            disabled={barDisabled || hasWorkflow}
            onClick={() => void onGenerate()}
          >
            {ui === "generating" ? "Generating…" : "Generate workflow"}
          </button>
          <button
            type="button"
            className={`btn btn--compact${
              workflowOutOfDate && hasWorkflow && !editingWorkflow
                ? ""
                : " secondary"
            }`}
            disabled={barDisabled || !hasWorkflow}
            onClick={() => void onGenerate()}
          >
            {ui === "generating" ? "Generating…" : "Regenerate workflow"}
          </button>
        </div>
        {barDisabled && barReason ? (
          <p className="hint generate-hint" role="status">
            {barReason}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <section className={`editor-page${embedded ? " editor-page--embedded editor-page--simple" : ""}`}>
      {!embedded ? (
        <Link className="back-link" to="/builder">
          ← Builder
        </Link>
      ) : null}

      {!simpleLayout ? (
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
      ) : null}

      {showBanner ? <div className={`banner ${bannerClass}`}>{banner}</div> : null}

      {pendingPreview ? (
        <div className="banner warn preview-not-saved-banner" role="alert">
          {simpleLayout ? (
            <>
              <strong>Preview only — not saved yet.</strong> Click{" "}
              <strong>Accept & save</strong> below or discard to keep editing.
            </>
          ) : (
            <>
              <strong>Preview only — not saved.</strong> The workflow below is not in the
              database yet. Click <strong>Accept &amp; save</strong> to write graph JSON
              to <code>agent_versions</code>, or <strong>Discard</strong> to edit your
              policy again.
            </>
          )}
        </div>
      ) : null}

      {!simpleLayout ? (
        <WorkflowStatusStepper
          phase={workflowPhase}
          version={version}
          graphKey={
            pendingPreview?.definition.graphKey ??
            workflowDef?.graphKey ??
            runtime?.binding?.graphKey
          }
          hasUnsavedPreview={pendingPreview !== null}
        />
      ) : null}

      {!simpleLayout ? <AdminHelpPanel /> : null}

      {bindingConflictHint ? (
        <div className="banner warn">{bindingConflictHint}</div>
      ) : null}

      {policyDirty && !simpleLayout ? (
        <div className="banner warn">
          You changed the policy after the last graph was built. Click{" "}
          <strong>Update workflow</strong> to store a new graph version (v
          {version} → next).
        </div>
      ) : null}

      {!simpleLayout ? (
        <ol className="pipeline-steps" aria-label="Authoring pipeline">
          {[
            { id: "policy", label: "Policy" },
            { id: "generate", label: "Create workflow" },
            { id: "live", label: "Make live" },
          ].map((s) => (
            <li key={s.id}>{s.label}</li>
          ))}
        </ol>
      ) : null}

      <div className={`editor-layout${simpleLayout ? " editor-layout--simple-only" : " editor-layout--simple"}`}>
        <div className="editor-main">
          {simpleLayout ? (
            <div className="agent-panel" ref={policySectionRef}>
              <div className="agent-panel-head">
                <h3>Policy</h3>
                <div className="agent-panel-actions">
                  {editingPolicy ? (
                    <>
                      <button
                        type="button"
                        className="btn btn--compact"
                        disabled={locked}
                        onClick={() => void onSaveDraft()}
                      >
                        {ui === "saving" ? "Saving…" : "Save"}
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        title="Cancel"
                        disabled={locked}
                        onClick={() => setEditingPolicy(false)}
                      >
                        ✕
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="icon-btn"
                      title="Edit policy"
                      disabled={locked}
                      onClick={() => setEditingPolicy(true)}
                    >
                      ✎
                    </button>
                  )}
                </div>
              </div>
              {fields.length > 0 ? (
                <ul className="field-errors">
                  {fields.map((f) => (
                    <li key={f.path}>
                      <code>{f.path}</code>: {f.message}
                    </li>
                  ))}
                </ul>
              ) : null}
              {editingPolicy ? (
                <>
                  <div className="policy-fields policy-fields--builder">
                    {mainPolicyFields.map((f) => {
                      const raw = getPath(values, f.key);
                      const err = fields.find(
                        (e) =>
                          e.path === f.key || e.path.startsWith(f.key + "."),
                      );
                      return renderPolicyField(
                        f,
                        raw,
                        err,
                        locked,
                        updateField,
                        toolCatalog,
                        f.key === "prompt" ? policyScopeGaps : undefined,
                      );
                    })}
                  </div>
                </>
              ) : (
                <p className="policy-readonly">
                  {displayPolicyText ||
                    "Click the pencil to describe what this agent should do."}
                </p>
              )}
              {renderWorkflowGenerateActions("policy")}
            </div>
          ) : null}

          {!simpleLayout ? (
            <div
              className="section-card policy-box"
              ref={policySectionRef}
            >
              <div className="section-head">
                <div>
                  <h2>Policy Box</h2>
                  <p className="muted">
                    Describe what this agent should do in plain English. Create
                    workflow sends this text to the LLM with the tool catalog;
                    the model returns graph JSON (preview before save).
                  </p>
                </div>
              </div>

            {fields.length > 0 ? (
              <ul className="field-errors">
                {fields.map((f) => (
                  <li key={f.path}>
                    <code>{f.path}</code>: {f.message}
                  </li>
                ))}
              </ul>
            ) : null}

            <div className="policy-fields policy-fields--builder">
              {mainPolicyFields.map((f) => {
                const raw = getPath(values, f.key);
                const err = fields.find(
                  (e) => e.path === f.key || e.path.startsWith(f.key + "."),
                );
                return renderPolicyField(
                  f,
                  raw,
                  err,
                  locked,
                  updateField,
                  toolCatalog,
                  f.key === "prompt" ? policyScopeGaps : undefined,
                );
              })}
            </div>

            <div className="card-actions">
              <button
                type="button"
                className="btn secondary"
                disabled={locked}
                onClick={() => void onSaveDraft()}
              >
                {ui === "saving" ? "Saving…" : "Save draft"}
              </button>
            </div>
          </div>
          ) : null}

          <div className={`${simpleLayout ? "agent-panel" : "section-card workflow-card"}`}>
            <div className={simpleLayout ? "agent-panel-head" : "section-head"}>
              {simpleLayout ? (
                <h3>Workflow</h3>
              ) : (
                <div>
                  <h2>Workflow</h2>
                  <p className="muted">
                    Preview runs policy text through the LLM pipeline, then Accept
                    saves graph JSON to the database.
                  </p>
                </div>
              )}
              {simpleLayout ? (
                <div className="agent-panel-actions">
                  {pendingPreview ? (
                    <>
                      <button
                        type="button"
                        className="btn btn--compact"
                        disabled={busy || !canEdit}
                        onClick={() => void onAcceptPreview()}
                      >
                        {ui === "accepting" ? "Saving…" : "Save workflow"}
                      </button>
                      <button
                        type="button"
                        className="btn secondary btn--compact"
                        disabled={busy}
                        onClick={discardPreview}
                      >
                        Discard
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        title="Edit steps manually instead"
                        disabled={busy}
                        onClick={() => {
                          setWorkflowSteps(
                            workflowStepsFromDefinition(
                              pendingPreview.definition,
                            ),
                          );
                          discardPreview();
                          setEditingWorkflow(true);
                        }}
                      >
                        ✎
                      </button>
                    </>
                  ) : editingWorkflow ? (
                    <>
                      <button
                        type="button"
                        className="btn btn--compact"
                        disabled={busy}
                        onClick={() => void onSaveWorkflowManual()}
                      >
                        {ui === "accepting" ? "Saving…" : "Save workflow"}
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        title="Cancel editing"
                        disabled={busy}
                        onClick={() => setEditingWorkflow(false)}
                      >
                        ✕
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="icon-btn"
                        title="Edit workflow steps manually"
                        disabled={locked}
                        onClick={() => {
                          const steps = workflowStepsFromDefinition(workflowDef);
                          setWorkflowSteps(
                            steps.length > 0
                              ? steps
                              : [
                                  {
                                    id: "step_1",
                                    impl: "syntra.jd.process",
                                  },
                                ],
                          );
                          setEditingWorkflow(true);
                        }}
                      >
                        ✎
                      </button>
                    </>
                  )}
                </div>
              ) : null}
            </div>

            {simpleLayout ? (
              <>
              <div
                className={
                  workflowOutOfDate && !pendingPreview && !editingWorkflow
                    ? "workflow-canvas--stale"
                    : undefined
                }
              >
                <WorkflowCanvas
                  definition={pendingPreview?.definition ?? workflowDef}
                  version={pendingPreview ? undefined : version}
                  editable={editingWorkflow}
                  steps={editingWorkflow ? workflowSteps : undefined}
                  onStepsChange={editingWorkflow ? setWorkflowSteps : undefined}
                  emptyHint="Edit steps with ✎, or use Generate workflow below to build from policy."
                  title={name || undefined}
                  triggerEventType={
                    String(getPath(values, "triggerEventType") ?? "").trim() ||
                    runtime?.binding?.eventType ||
                    null
                  }
                  isLive={Boolean(runtime?.binding?.eventType)}
                />
              </div>
              {!pendingPreview ? renderWorkflowGenerateActions("workflow") : null}
              {simpleLayout &&
              !pendingPreview &&
              lastUnsupported.length > 0 ? (
                <div className="gap-report-unsupported" role="alert">
                  <strong>Could not add:</strong>{" "}
                  {friendlyUnsupportedSummary(lastUnsupported)}
                  <ul className="gap-report-gap-list">
                    {lastUnsupported.map((gap) => (
                      <li key={gap}>{friendlyUnsupportedGap(gap)}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              </>
            ) : (
              <div className="form-block">
                <PolicyGraphExplainer
                  policyText={policyText}
                  template={
                    agentTemplate as {
                      nodes?: Array<{ id: string; impl: string }>;
                      wiring?: Array<[string, string]>;
                    } | null
                  }
                  definition={explainerDefinition}
                  graphKey={
                    explainerDefinition?.graphKey ?? runtime?.binding?.graphKey
                  }
                  graphVersion={pendingPreview ? undefined : version}
                  mode={explainerMode}
                  generationTrace={
                    pendingPreview?.generationTrace ??
                    lastGenerationTrace ??
                    null
                  }
                  triggerEventType={
                    String(getPath(values, "triggerEventType") ?? "").trim() ||
                    runtime?.binding?.eventType ||
                    null
                  }
                  isLive={Boolean(runtime?.binding?.eventType)}
                />
              </div>
            )}

            {pendingPreview ? (
              <div className={`gap-report${simpleLayout ? " gap-report--simple" : ""}`} role="status">
                {!simpleLayout ? (
                  <h3 className="form-block-title">Review before saving</h3>
                ) : null}
                {pendingPreview.unsupported.length > 0 ? (
                  <div className="gap-report-unsupported" role="alert">
                    <strong>Could not add:</strong>{" "}
                    {friendlyUnsupportedSummary(pendingPreview.unsupported)}
                    <ul className="gap-report-gap-list">
                      {pendingPreview.unsupported.map((gap) => (
                        <li key={gap}>{friendlyUnsupportedGap(gap)}</li>
                      ))}
                    </ul>
                    <p className="muted" style={{ margin: "0.35rem 0 0" }}>
                      The steps below were built without these parts.
                    </p>
                  </div>
                ) : !simpleLayout ? (
                  <p className="muted">
                    Everything in your request maps to available steps.
                  </p>
                ) : null}
                {!simpleLayout ? (
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
                ) : null}
                {!simpleLayout ? (
                  <WorkflowPreviewSummary
                    definition={pendingPreview.definition}
                    trace={pendingPreview.generationTrace}
                    isPreviewOnly
                  />
                ) : null}
                {!simpleLayout ? (
                <div className="card-actions">
                  <button
                    type="button"
                    className="btn"
                    disabled={busy || !canEdit}
                    onClick={() => void onAcceptPreview()}
                  >
                    {ui === "accepting" ? "Saving…" : "Save workflow"}
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
                ) : null}
              </div>
            ) : !simpleLayout ? (
              <div className="card-actions">
                {workflowDef && lastGenerationTrace ? (
                  <WorkflowPreviewSummary
                    definition={workflowDef}
                    trace={lastGenerationTrace}
                  />
                ) : null}
                <button
                  type="button"
                  className="btn"
                  disabled={generateDisabled}
                  onClick={() => void onGenerate()}
                >
                  {ui === "generating"
                    ? "Generating…"
                    : workflowSummary.empty
                      ? "Generate workflow"
                      : "Regenerate workflow"}
                </button>
                {generateDisabled && generateDisabledReason ? (
                  <p className="hint generate-hint" role="status">
                    {generateDisabledReason}
                  </p>
                ) : null}
              </div>
            ) : null}

            {!simpleLayout ? (
              <div className="activity-log" aria-label="Recent actions">
                <h3 className="form-block-title">Recent actions</h3>
                {activityLog.length === 0 ? (
                  <p className="muted">No actions yet.</p>
                ) : (
                  <ol className="activity-log-list">
                    {activityLog.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ol>
                )}
              </div>
            ) : null}
          </div>

          {simpleLayout ? (
            <div className="agent-panel agent-panel--live">
              <div className="agent-panel-head">
                <h3>Go live</h3>
              </div>
              {isAgentLive ? (
                <>
                  <p className="muted agent-live-hint">
                    This agent is live
                    {runtime?.binding
                      ? ` — runs when ${friendlyEventLabel(runtime.binding.eventType)}`
                      : ""}
                    .
                  </p>
                  <button
                    type="button"
                    className="btn secondary btn--compact"
                    disabled={locked}
                    onClick={() => void onTakeOffline()}
                  >
                    {busy ? "Working…" : "Take offline"}
                  </button>
                </>
              ) : (
                <>
                  <p className="muted agent-live-hint">
                    {workflowSummary.empty
                      ? "Create a workflow first, then make it live."
                      : "Ready when you are — we run safety checks first."}
                  </p>
                  <button
                    type="button"
                    className="btn btn--compact"
                    disabled={locked || !canGoLive}
                    onClick={() => void onGoLive()}
                  >
                    {ui === "going_live" ? "Going live…" : "Make it live"}
                  </button>
                </>
              )}
              {goLiveChecks ? (
                <ul className="go-live-checks">
                  {goLiveChecks.map((c) => (
                    <li
                      key={c.id}
                      className={c.ok ? "check-ok" : "check-fail"}
                    >
                      {c.ok ? "✓" : "✗"} {c.message}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          {simpleLayout ? (
            <GraphArtifactsPanel
              agentId={id}
              refreshKey={`${version}-${status}-${ui}`}
            />
          ) : null}

          {!simpleLayout ? (
          <div className="section-card">
            <div className="section-head">
              <div>
                <h2>Make this live</h2>
                <p className="muted">
                  When the workflow looks right, make it live. We run automatic
                  safety checks first — if anything isn&apos;t ready, nothing changes
                  in production.
                </p>
              </div>
            </div>

            <div className="go-live-panel">
              {runtime?.binding ? (
                <div className="banner ok go-live-live-banner">
                  <strong>This workflow is live.</strong>{" "}
                  {friendlyEventLabel(runtime.binding.eventType)} — uploads and
                  events that match this trigger will run this agent&apos;s steps.
                </div>
              ) : status === "active" ? (
                <div className="banner warn go-live-live-banner">
                  <strong>Not connected to uploads yet.</strong> This agent is saved
                  as live in settings, but real uploads won&apos;t use it until Make
                  live succeeds for the trigger you chose.
                </div>
              ) : null}
              {policyEditorIngressLabel(status, runtime?.binding ?? null) ? (
                <p className="ingress-hint muted">
                  {policyEditorIngressLabel(status, runtime?.binding ?? null)}
                </p>
              ) : null}
              {goLiveChecks ? (
                <ul className="go-live-checks">
                  {goLiveChecks.map((c) => (
                    <li
                      key={c.id}
                      className={c.ok ? "check-ok" : "check-fail"}
                    >
                      {c.ok ? "✓" : "✗"} {c.message}
                    </li>
                  ))}
                </ul>
              ) : null}
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
                    disabled={locked}
                    onClick={() => void onGoLive()}
                  >
                    {ui === "going_live"
                      ? "Making it live…"
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
          ) : null}
        </div>

        {!simpleLayout ? (
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
              You can view this agent, but you don&apos;t have permission to edit it.
            </p>
          ) : null}

          <h2 className="panel-subhead">Runtime routing</h2>
          <dl className="panel-list">
            <div className="panel-stat">
              <dt>DB binding</dt>
              <dd>
                {runtime?.binding ? (
                  <>
                    <code>{runtime.binding.eventType}</code>
                    {" → "}
                    <code>{runtime.binding.graphKey}</code>
                    {runtime.binding.version != null
                      ? `@${runtime.binding.version}`
                      : ""}
                    <span className="muted"> ({runtime.binding.source})</span>
                  </>
                ) : (
                  "No active binding for this agent"
                )}
              </dd>
            </div>
            <div className="panel-stat">
              <dt>Compiled graph</dt>
              <dd>
                {runtime?.activeCompiledGraph ? (
                  <>
                    <code>
                      {runtime.activeCompiledGraph.graphKey}@v
                      {runtime.activeCompiledGraph.version}
                    </code>
                  </>
                ) : (
                  "Not compiled / active in graph_definitions"
                )}
              </dd>
            </div>
          </dl>
        </aside>
        ) : null}
      </div>
    </section>
  );
}

function friendlyStatus(
  status: string | null | undefined,
  version?: number,
): string {
  const ver = version != null ? ` · v${version}` : "";
  switch (status) {
    case "draft":
      return `Draft - not live${ver}`;
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

  // Only strip known seed boilerplate — keep custom agent prompts intact.
  if (/^you are syntra/i.test(text)) {
    text = text.replace(/^You are SYNTRA\.?\s*/i, "").trim();
  }
  if (text.length < 3) return "";
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
    raw.includes("insufficient")
  ) {
    return "The AI service needs more credits. Ask your engineer to update the API account.";
  }
  if (raw.includes("401") || raw.includes("unauthorized") || raw.includes("invalid api")) {
    return "The AI API key is not valid. Ask your engineer to check the server configuration.";
  }
  if (raw.includes("404") && (raw.includes("model") || raw.includes("no longer available"))) {
    return "The AI model name is outdated. Ask your engineer to update the model setting.";
  }
  if (
    raw.includes("cannot build yet") ||
    raw.includes("unsupported_request") ||
    raw.includes("unsupported")
  ) {
    const trimmed = (message ?? "").replace(/^GENERATION_FAILED:\s*/i, "").trim();
    return (
      trimmed ||
      "We cannot build all of that yet. Try describing process job, resume, match, or human review."
    );
  }
  if (raw.includes("unclosed json") || raw.includes("max_tokens") || raw.includes("mid-response")) {
    return "The AI response was cut off. Try Create workflow again with a shorter description.";
  }
  if (message?.trim()) {
    const trimmed = message.replace(/^GENERATION_FAILED:\s*/i, "").trim();
    return trimmed.length > 220 ? `${trimmed.slice(0, 220)}…` : trimmed;
  }
  return "Could not create the workflow. Your text was kept — try again.";
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

function renderPolicyField(
  f: PolicyFieldDesc,
  raw: unknown,
  err: FieldError | undefined,
  locked: boolean,
  updateField: (key: string, value: unknown) => void,
  toolCatalog: Array<{ key: string; description: string }> = [],
  scopeGaps?: string[],
): ReactNode {
  if (f.kind === "textarea") {
    return (
      <label
        key={f.key}
        className={`field field--wide ${err ? "invalid" : ""}`}
      >
        <span className="field-label">{f.label}</span>
        <textarea
          rows={4}
          disabled={locked}
          value={String(raw ?? "")}
          onChange={(e) => updateField(f.key, e.target.value)}
        />
        {f.hint ? <span className="hint">{f.hint}</span> : null}
        {scopeGaps && scopeGaps.length > 0 ? (
          <span className="hint policy-scope-hint" role="status">
            “{scopeGaps.join(", ")}” is not in scope and cannot be added as a
            workflow step.
          </span>
        ) : null}
      </label>
    );
  }
  if (f.kind === "multiEnum") {
    const selected = Array.isArray(raw) ? (raw as string[]) : [];
    const options = f.options ?? [];
    return (
      <fieldset
        key={f.key}
        className={`field field--wide ${err ? "invalid" : ""}`}
      >
        <legend className="field-label">{f.label}</legend>
        <div className="tool-checks">
          {options.map((opt) => {
            const checked = selected.includes(opt);
            return (
              <label key={opt} className="tool-check">
                <input
                  type="checkbox"
                  disabled={locked}
                  checked={checked}
                  onChange={() => {
                    const next = checked
                      ? selected.filter((x) => x !== opt)
                      : [...selected, opt];
                    updateField(f.key, next);
                  }}
                />
                <span>{f.optionLabels?.[opt] ?? opt}</span>
              </label>
            );
          })}
        </div>
        {f.hint ? <span className="hint">{f.hint}</span> : null}
      </fieldset>
    );
  }
  if (f.kind === "tools") {
    const selected = Array.isArray(raw) ? (raw as string[]) : [];
    const options =
      toolCatalog.length > 0
        ? toolCatalog
        : ((f.defaultValue as string[] | undefined) ?? []).map((k) => ({
            key: k,
            description: k,
          }));
    return (
      <fieldset
        key={f.key}
        className={`field field--wide ${err ? "invalid" : ""}`}
      >
        <legend className="field-label">{f.label}</legend>
        <div className="tool-checks">
          {options.map((t) => {
            const checked = selected.includes(t.key);
            return (
              <label key={t.key} className="tool-check">
                <input
                  type="checkbox"
                  disabled={locked}
                  checked={checked}
                  onChange={() => {
                    const next = checked
                      ? selected.filter((x) => x !== t.key)
                      : [...selected, t.key];
                    updateField(f.key, next);
                  }}
                />
                <span>
                  {t.description}
                </span>
              </label>
            );
          })}
        </div>
        {f.hint ? <span className="hint">{f.hint}</span> : null}
      </fieldset>
    );
  }
  if (f.kind === "enum") {
    return (
      <label key={f.key} className={`field ${err ? "invalid" : ""}`}>
        <span className="field-label">{f.label}</span>
        <select
          disabled={locked}
          value={String(raw ?? f.defaultValue ?? "")}
          onChange={(e) => updateField(f.key, e.target.value)}
        >
          {(f.options ?? []).map((opt) => (
            <option key={opt} value={opt}>
              {f.optionLabels?.[opt] ?? opt}
            </option>
          ))}
        </select>
        {f.hint ? <span className="hint">{f.hint}</span> : null}
      </label>
    );
  }
  if (f.kind === "boolean") {
    return (
      <label key={f.key} className={`field checkbox ${err ? "invalid" : ""}`}>
        <input
          type="checkbox"
          disabled={locked}
          checked={Boolean(raw)}
          onChange={(e) => updateField(f.key, e.target.checked)}
        />
        <span className="field-label">{f.label}</span>
      </label>
    );
  }
  if (f.kind === "number") {
    return (
      <label key={f.key} className={`field ${err ? "invalid" : ""}`}>
        <span className="field-label">{f.label}</span>
        <input
          type="number"
          disabled={locked}
          min={f.min}
          max={f.max}
          value={raw === "" || raw == null ? "" : Number(raw)}
          onChange={(e) => {
            const n = e.target.value;
            updateField(f.key, n === "" ? "" : Number(n));
          }}
        />
        {f.hint ? <span className="hint">{f.hint}</span> : null}
      </label>
    );
  }
  return (
    <label key={f.key} className={`field ${err ? "invalid" : ""}`}>
      <span className="field-label">{f.label}</span>
      <input
        disabled={locked}
        value={String(raw ?? "")}
        onChange={(e) => updateField(f.key, e.target.value)}
      />
      {f.hint ? <span className="hint">{f.hint}</span> : null}
    </label>
  );
}
