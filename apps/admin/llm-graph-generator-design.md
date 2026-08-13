# TEKISHO — LLM-Driven Graph Generator: Design (Stage 1 Evolution)

**Version:** 0.2 (Spec locked — §9 resolved; ready to build)
**Date:** 2026-08-12
**Status:** Approved for build
**Companion docs:** `agent-authoring-admin-design-final.md` (the authoring platform), the orchestrator runtime doc.
**Scope of THIS doc:** replace the template-driven generator with an **LLM-driven** one, bounded to the **3 real runtime tools** that work today. More tools arrive later (teammate's work) and plug into the same engine.

---

## 1. Purpose and the Shift

### 1.1 What changes

The current generator is **template-driven**: an admin fills settings, and the engine snaps together a pre-defined template. The admin can only pick from a shape the platform already drew.

This document specifies the **description-driven** generator:

> An admin opens an agent, **sees its current workflow**, types **in plain English** what they want it to do, and an **LLM designs the workflow** — choosing which tools to use, in what order, wired how. The admin never sees the raw tool list; the LLM does, internally, via its system prompt.

The shift, in one line: **a human-drawn template becomes an AI-designed graph, bounded to real tools.**

### 1.2 What stays the same (the safety spine)

Everything that made Stage 1 safe is preserved — the LLM changes *how the graph is proposed*, not *what is allowed*:

- **Bounded output:** the LLM may only use **registered, real tools.** Any tool it invents is rejected before anything is stored.
- **Topology validation:** the proposed graph must pass `GraphDefinitionSchema` + `validateGraphTopology` (start/end present, no orphans, reachable).
- **Stops at `generated`:** nothing compiles, publishes, activates, or runs. The LLM-designed graph is inert, exactly like the template-designed one.
- **Same storage:** the graph lands in `agent_versions` at status `generated`; `graph_definitions` is untouched.

The LLM proposes; the validators dispose. An LLM mistake can produce a *wrong* graph, never an *unsafe* or *unrunnable* one.

---

## 2. The Central Decision: bounded to real tools only

### 2.1 The problem

For an LLM to design a workflow, it must choose from a set of tools. Two tool-worlds exist today, and they do not match — the **node bridge gap**:

| World | Tools | Can it actually run? |
|---|---|---|
| Authoring registry (old) | 15 fine-grained keys: `parse_jd`, `calculate_match_score`, `hard_filter`, … | **No** — not in the runtime node registry |
| Runtime node registry | **3** coarse nodes: `syntra.jd.process`, `syntra.resume.process`, `syntra.match.process` | **Yes** — these are what production runs |

If the LLM picks from the 15 authoring tools, it designs graphs the runtime **cannot execute**. That is a fiction.

### 2.2 The decision

**The LLM chooses only from the 3 real runtime tools.** More tools are added later (teammate is building ~6 more); each new real tool is added to the catalog and the same engine composes with it — no engine change.

**Rationale.** This eliminates the node bridge gap by construction: every tool the LLM can pick is one that genuinely runs. The trade-off is a **small design space today** (3 coarse tools compose into simple graphs). That is accepted: we build the *engine* now, and its richness grows automatically as real tools are added. Building against fake tools to get fancier graphs sooner would produce graphs that cannot run — worse than simple-but-real.

| # | Decision | Alternative | Why rejected |
|---|---|---|---|
| L1 | LLM designs the graph from an English description | Keep template-driven | Templates cap the admin at pre-drawn shapes; the goal is admin-authored workflows |
| L2 | Bounded to the 3 real runtime tools only | Use the 15 authoring tools | Those 15 are not runnable — authored graphs would be fiction (node bridge gap) |
| L3 | LLM output is validated against the real registry + topology before storing | Trust LLM output | LLMs hallucinate; the validator is what keeps output safe and runnable |
| L4 | Still stops at `generated` (nothing runs) | Generate-and-activate | Same safety boundary as Stage 1 — no admin action reaches production |
| L5 | Tool/event descriptions injected into the system prompt at generate time | Hard-code tool knowledge in the prompt | Descriptions live with the tools/events; assembling at generate time means new tools appear to the LLM automatically |

---

## 3. The 3 Real Tools (the LLM's entire universe today)

From `packages/orchestrator/src/nodes/syntra.ts`. Each is a real, runnable node: it takes specific inputs, calls Syntra's internal API, and emits a completion event.

### Tool 1 — `syntra.jd.process`
- **What it does:** Processes a job description (parse + prepare) via Syntra.
- **Input (required):** `jobId` (string) in the trigger payload.
- **Action:** `POST /internal/jobs/{jobId}/process`
- **Output / emits event:** `syntra.jd.parsed` — "Structured requirement and its skill demands were persisted."
- **Triggered by event:** `syntra.jd.received`

### Tool 2 — `syntra.resume.process`
- **What it does:** Processes a resume (parse + profile) via Syntra.
- **Input (required):** `resumeId` (string); optional `candidateId`.
- **Action:** `POST /internal/resumes/{resumeId}/process`
- **Output / emits event:** `syntra.profile.prepared` — "Resume parse, skill normalisation and embedding completed."
- **Triggered by event:** `syntra.resume.received`

### Tool 3 — `syntra.match.process`
- **What it does:** Scores a job × resume match via Syntra.
- **Input (required):** `jobId` (string) **and** `resumeId` (string); optional `candidateId`.
- **Action:** `POST /internal/matches/process`
- **Output / emits event:** `syntra.match.completed` — "Ranked, explained match results were persisted."
- **Triggered by event:** `syntra.match.requested`

**This is the whole catalog the LLM sees today.** Each entry becomes a block in the system prompt: name, what it does, required input, output event. The event descriptions (rich, from `event_schemas`) tell the LLM how tools connect — e.g. `jd.process` emits `jd.parsed`, which is the natural precursor to matching.

---

## 4. The Tool & Event Catalog (what feeds the system prompt)

### 4.1 Tools — need description + input + output

Today the tool registry has **one-line descriptions only** (no input/output format). For the LLM to choose well, each real tool needs a richer entry:

```ts
// enriched tool catalog entry (proposed)
{
  key: "syntra.jd.process",
  description: "Process a job description: parse it and prepare structured requirements.",
  input:  { jobId: "string (required) — the job to process" },
  output: { event: "syntra.jd.parsed", shape: "{ jobId, status, syntra }" },
  triggeredBy: "syntra.jd.received",
}
```

For the 3 tools this is small and known (from §3). The input/output come straight from `syntra.ts`. This enrichment is **step 1 of the build** — without it the LLM is guessing.

### 4.2 Events — already rich (reuse as-is)

The `event_schemas` DB table already has, per event: a description, `payload_schema` (JSON Schema), envelope fields, `produced_when`, `primary_consumer`. This is the best-documented contract in the system. The generator reads these and injects them so the LLM knows what each event means and carries. **No new work here — events are ready.**

### 4.3 Assembling the system prompt (at generate time)

On Generate, the engine builds the LLM's system prompt from:
1. The **3 tool entries** (§4.1) — name, description, input, output.
2. The **relevant event descriptions** (§4.2) — so the LLM understands the connective tissue.
3. **Rules**: "Use ONLY these tools. Output a graph as JSON in this exact shape. Every node's `impl` must be one of the tool keys. The graph must have `__start__` and `__end__` and be fully connected."
4. The **admin's English request**.

The LLM returns a graph proposal (nodes + edges). The engine never trusts it blind — §5.

---

## 5. The Generator Flow (how a request becomes a graph)

```
Admin opens agent
   → sees CURRENT policy/workflow (read-only view)      [new: requirement]
Admin types request in English
   → "When a JD arrives, process it, then run matching."
Click Generate
   → 1. Load the 3-tool catalog (desc + I/O)            [§4.1]
   → 2. Load relevant event descriptions                [§4.2]
   → 3. Build system prompt = catalog + events + rules + request
   → 4. Call LLM → receives proposed graph (nodes+edges JSON)
   → 5. VALIDATE (the safety net):
          a. every node.impl ∈ {the 3 real tools}  else REJECT
          b. GraphDefinitionSchema.parse(...)      else REJECT
          c. validateGraphTopology(...)            else REJECT
   → 6. Compute checksum; store in agent_versions at `generated`
   → 7. Return the graph to the UI for review
   STOPS. Nothing runs.
```

**Step 5 is the load-bearing safety.** The LLM is creative but fallible; the validator is deterministic and strict. If the LLM invents `send_email` (not a real tool), 5a rejects it. If it builds a graph with an orphan node, 5c rejects it. Only a graph that is *entirely real tools* and *structurally valid* is ever stored.

---

## 6. What's Different from the Template Generator

| | Template generator (current) | LLM generator (this doc) |
|---|---|---|
| Admin input | Form settings | Plain-English description |
| Who designs the graph | The pre-written template | The LLM |
| Tool source | Template's fixed node list | LLM picks from the real-tool catalog |
| Determinism | Same input → identical graph | Same English may vary slightly |
| Tools available | 15 authoring keys (not all runnable) | **3 real runtime tools** (all runnable) |
| Safety | Bounded by template | Bounded by validation against real registry |
| Stops at `generated` | Yes | Yes (unchanged) |

The **safety boundary is identical**; only the *proposal mechanism* changed from template to LLM. Determinism is the one real loss — mitigated by validation and by letting the admin review the proposed graph before it's used.

---

## 7. Honest Risks & Mitigations

| Risk | Mitigation |
|---|---|
| LLM invents a tool that doesn't exist | Step 5a: reject any `impl` not in the real registry |
| LLM returns malformed JSON | Parse defensively; on failure → `GENERATION_FAILED`, nothing stored, draft kept |
| LLM builds an invalid graph (orphans, no end) | Step 5b/5c: schema + topology validation reject it |
| Non-determinism (same English, different graph) | Admin reviews the proposed graph; regenerate if unhappy; store checksum for audit |
| Only 3 tools → simple graphs | Accepted; engine grows as teammate adds real tools — no engine change needed |
| LLM latency / API key / cost | New dependency vs the old pure function; handle timeouts, key config, and errors explicitly |
| Small design space invites over-promising | Be honest in the UI: today it composes 3 tools; richer workflows come as tools are added |

---

## 8. Build Order

1. **Enrich the 3 real tools** into a catalog with description + input + output (§4.1). Small, known, from `syntra.ts`.
2. **Reuse event descriptions** from `event_schemas` (§4.2) — wire a reader, no new data.
3. **Generic `LLMClient`** + env config (§9 #1) — fail clear if unset; Noop for tests.
4. **System-prompt builder** — assemble catalog + events + rules + request (§4.3).
5. **LLM call + response parser** — call the model, parse the proposed graph JSON defensively.
6. **Validation layer** — reuse `GraphDefinitionSchema` + `validateGraphTopology`; add the "impl ∈ real registry" check (§5 step 5). **Pairs with #3** — validator safety independent of provider.
7. **Wire into Generate** — replace/augment the template path; still write `agent_versions` at `generated`; accept/regenerate UX.
8. **Current-workflow view** — readable summary (§9 #4), freeform request + hint (§9 #3).
9. **Tests** — LLM output with a fake tool → rejected; malformed JSON → GENERATION_FAILED; valid English → valid graph of real tools; still stops at `generated`.

**Not in scope now:** the other ~6 tools (teammate), compile/publish/activate (Stages 2–3), router remount to authored keys (held separately).

---

## 9. Open Questions — RESOLVED

| # | Decision | Notes |
|---|----------|-------|
| 1 | **Generic `LLMClient` interface** — any provider via env (`LLM_PROVIDER`, `LLM_API_KEY`, `LLM_MODEL`); fail clearly if unset | Mirrors runtime orchestrator `LLMClient` seam (Noop in tests). Switching providers is config, not code. |
| 2 | **Accept / regenerate only** — no graph editor yet | Admin reviews proposed graph summary; accepts (store `generated`) or tweaks English and regenerates |
| 3 | **Freeform textarea + short hint** | Hint shows what's possible with current tools (e.g. JD → process → match) |
| 4 | **Readable workflow summary** for current-policy view | Not raw JSON; plain-English / step list over the stored graph |
| 5 | **Catalog-only for teammate tools** | New real tools = catalog data; same engine; no engine change (A6) |
| 6 | **Non-determinism accepted** — low temperature + admin review | Bounded by two nets: low temp + human accept/regenerate |

### Pairing: generic client + strict validator

The generic `LLMClient` (#1) and the §5 validation layer are a **pair**. Different providers/models return differently shaped or differently reliable output; a weaker model may hallucinate tools or return messier JSON. **Regardless of which client is plugged in**, step 5 rejects any `impl` not in the real registry and any graph that fails schema/topology. Flexibility comes from the client; safety comes from the validator. Both are required.

---

## 10. Bottom Line

Build the **LLM-driven generator engine** now, bounded to the **3 real runtime tools**. It will produce simple graphs (only 3 tools to compose) but they will be **real, runnable, and safe** — every tool exists, every graph is validated, nothing goes live. The engine is the durable asset: as the teammate adds real tools, the same engine composes richer workflows with **no engine change**. The safety spine of Stage 1 (bounded output, topology validation, stops at `generated`) is fully preserved; only the *proposal* changes from template to LLM.
