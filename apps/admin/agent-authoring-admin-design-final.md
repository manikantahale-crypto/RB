# TEKISHO — Agent (Product) Authoring Platform: Admin / Design-Time Design

**Version:** 1.0 (Draft for team review)
**Date:** 2026-08-10
**Status:** Proposed
**Audience:** Engineering team (backend / platform / frontend)
**Companion doc:** *Hiring Assistant Platform — Orchestrator & Workflow Engine Design v1.0* (the runtime side). This document is its design-time counterpart.

---

## 1. Purpose and Scope

This document specifies the design of the **design-time authoring system** for the TEKISHO platform — the admin-facing surface where an operator configures an **agent** and turns that configuration into a runnable graph.

**Terminology (the key framing).** In TEKISHO, each *product* in the portfolio — SYNTRA (AI Candidate Matching), ASTRA (Requirement Intelligence), ORBIT (Bench Workforce Command), and the rest — **is an agent**. "Product" is the market-facing word; "agent" is the internal, technical word for the same thing: a configurable unit of behaviour whose workflow the orchestrator executes in response to events. Throughout this document, **agent = product/module.** The admin panel's list of agents is the list of products; configuring an agent means configuring that product's behaviour.

The platform is one loop: **an admin configures an agent → its policy is revised → a graph is generated (design-time) → the orchestrator executes that graph on events (runtime) → completion events trigger the next agent's actions.** This document specifies the design-time half — configuration, policy revision, and graph generation. The runtime half (the orchestrator that watches events and triggers next actions) is already built and is summarised in §10.

The two halves meet at exactly one place: the **graph store** (the `graph_definitions` / `agent_*` tables). Authoring writes generated graphs into that store; the runtime reads published graphs out of it. Neither calls the other directly. That single hand-off boundary is the reason the two halves can be built and deployed independently.

**In scope:** the agent/policy data model, the two authoring screens (Agent List, Policy Editor), the Generate action and its server contract, the artifact it produces (`agent.ts`), the version/status lifecycle, validation and error surfaces, access control, and the boundary against the runtime.

**Out of scope for this document:** the Compiler and Publish stages (documented separately as later stages — see §9), the runtime orchestrator internals (its own doc), infrastructure provisioning, and billing. The compiler and publish stages are *referenced* here because the lifecycle passes through them, but their internals are not specified.

### 1.1 Scope commitment — Stage 1 only

The authoring pipeline has five stages: **Agent List → Policy Editor → Generate → Compile → Publish.** This document specifies **Stage 1: Generate** — the first three, ending at the `generated` status. The Agent List is the list of the (up to 12) product-agents; each is configured through the same pipeline. Compile and Publish are later stages owned separately. This is a deliberate vertical slice: Stage 1 is complete and useful on its own (it produces a reviewable, versioned graph) while touching none of the runtime.

**The defining constraint of Stage 1:** *nothing executes.* Generate produces a file and a policy record. It does not compile, publish, activate, or run an agent. An admin can misconfigure a policy and generate a bad `agent.ts`, but they cannot affect any live workflow — because reaching the runtime requires the later Compile and Publish stages, which are out of scope here and gated separately. This containment is what makes Stage 1 safe to ship first and independently.

### 1.2 Technology commitments (fixed constraints)

The authoring system designs within the same fixed stack as the runtime: Node.js + TypeScript on the server; Postgres (Supabase) as the single datastore, shared with the runtime, with row-level security scoped by `org_id`; Zod as the single source of truth for the policy schema and the generation request/response contracts; and the same `graph_definitions` family of tables the runtime already reads. The admin frontend is a TypeScript single-page app living in the orchestration monorepo (`apps/admin`), consuming a small authoring API (`apps/admin-api` or a route group on the existing worker's HTTP surface).

**Rationale.** Reusing the runtime's datastore and schema is not incidental — it is the mechanism by which authoring and runtime stay consistent. There is exactly one `graph_definitions` table; the authoring side writes rows, the runtime side reads them, and a single Zod schema (`GraphDefinitionSchema`, already defined for the runtime) validates them at both ends. There is no second copy of the contract to drift. Keeping the admin app in the same monorepo lets it import those shared Zod schemas as types rather than re-declaring them.

---

## 2. The Central Design Decision

### 2.1 The problem as originally framed

The intuitive model is: "an admin edits a product in a form, clicks Generate, and the system writes that product's workflow code — so the form is essentially a code editor with a nicer UI, and Generate is a save button."

This intuition is half right, and the half that is wrong shapes the entire design:

> **What the admin edits is *policy*, not code.** The Policy Editor captures structured configuration — a prompt, a set of allowed tools, thresholds, retry rules, guardrails. It never captures node functions, control flow, or dependency wiring. The admin authors *intent*; the generator turns intent into a code artifact from a **fixed, reviewed template**. The admin can never author arbitrary behaviour, only select and parameterise behaviour the platform already ships.

The reason this matters is the same inertness argument the runtime design makes about `graph_definitions`: if an admin form could produce arbitrary code, business logic would leave git, review, type-checking, and the test suite through a UI. Instead, the form produces *data* (a policy record), and a code generator — itself in git, reviewed and tested — deterministically renders that data into an `agent.ts` whose every possible shape is bounded by the template and the node registry.

### 2.2 The resolution: policy is data; generation is a pure, bounded transform

We split authoring into three layers with a strict ownership boundary, mirroring the runtime's registry/definition/compiler split:

| Layer | Lives in | Contains | Changes via |
|---|---|---|---|
| **Policy record** | DB (`agent_policies`, JSONB) | One agent's configuration, validated against that agent's schema — all *intent* | Admin edits in Policy Editor (a data write, no deploy) |
| **Agent template + schema** | Config/data (per agent) | How *this* agent's graph is built from its policy: available nodes, wiring, configurable knobs, the policy field schema | Add/edit a template (data op) — **no generator code change** |
| **Generator (schema-driven)** | Code (git) | One generic engine: `(policy, agent template) → graph definition`. Agent-agnostic | PR + deploy (changes rarely) |
| **Node/tool registry** | Code (git) | The named implementations any template may reference — all *behaviour* | PR + deploy (shared with runtime) |

**Rationale — why policy is data.** Policy is exactly the part that must change without a deploy: a recruiter-admin tuning a match-score threshold, swapping which tools an agent may use, or tightening a guardrail should be a data operation with an audit row, not a code change. Storing policy as a validated JSONB record scoped by `org_id` gives per-org configuration and a full edit history for free, and makes the Policy Editor a CRUD surface over structured data rather than a code editor.

**Rationale — why generation stays in code.** The generator is where a policy becomes a concrete artifact, and it is exactly where correctness and safety live. Keeping the template and generator in git means every `agent.ts` the system can possibly emit is a parameterisation of reviewed code — the output space is bounded and auditable. It also means the generator can be unit-tested: given a policy, assert the emitted artifact references only registered tools, injects the prompt in the right place, and is itself type-valid.

**Rationale — why ONE schema-driven generator, not one per agent.** The generator is a single generic engine: given a policy and that agent's template, it emits a graph definition. It does not know or care whether the agent is SYNTRA or VECTOR — the *template* carries everything agent-specific (which nodes, how they wire, which knobs the policy exposes). This is the property that realises the core vision: **adding a new agent, or a new capability to an existing one, is adding/editing a template + schema — data, not generator code.** "Admin adds a new thing → a new graph is generated" works without a deploy because the new thing is a template the existing generator already knows how to consume. Per-agent generators were rejected: they would multiply code, and every new product would require shipping and reviewing new generation logic, defeating the no-deploy goal.

**Rationale — why we do NOT let admins write graph code directly.** Direct code authoring through the UI is an explicit non-goal, for the same reason the runtime design forbids hand-editing `graph_definitions` JSON: it would bypass the template's guarantees. The admin's leverage is *selection and parameterisation* of shipped capabilities within an agent's template, never authoring new behaviour. New node or tool implementations arrive the normal way — a PR against the registry.

### 2.3 Decision record

| # | Decision | Alternatives considered | Why rejected |
|---|---|---|---|
| A1 | Policy captured as validated JSONB data; a graph is rendered from it by a schema-driven generator | (a) Admin edits `agent.ts` directly in the UI; (b) store generated code as the source of truth | (a) moves behaviour out of git/review/CI through a form — the exact anti-pattern the registry pattern exists to prevent. (b) makes the artifact authoritative and the policy derived, so an admin edit and a regenerate could disagree; policy-as-source keeps one truth. |
| A2 | Generate is validate-then-render, producing an artifact at `generated` status; it never compiles, publishes, or runs | Generate compiles and publishes in one click | Collapsing the stages removes every review gate between "an admin changed a form" and "a new graph is live in production." The staged lifecycle (§6) is the safety mechanism; one-click-to-live discards it. |
| A3 | Access scoped per agent, not only per role | Single admin role with all-or-nothing access | Different admins own different agents; an all-or-nothing role forces over-granting. Per-agent entitlement is the least-privilege default and the Agent List already needs it to decide which rows are editable. |
| A4 | Policy validated by a shared Zod schema at Save, at Generate, and (later) at Compile | Validate only server-side at Generate | One schema used at every boundary means a policy that passes the editor is guaranteed acceptable to the generator; there is no way for the three consumers to drift, and the admin gets inline errors before submitting. |
| A5 | Authoring reuses the runtime's `graph_definitions` datastore and `GraphDefinitionSchema` | A separate authoring database | A second store would need a sync mechanism to the runtime and a second copy of the definition contract — two sources of drift. One store, one schema, read by both halves, eliminates both. |
| A6 | One schema-driven generator + per-agent templates (agent = product) | Per-agent generators / bespoke Generate code per product | Per-agent generators require shipping and reviewing new code for every new product, defeating the "add a new agent as data yields a new graph, no deploy" goal. A generic engine driven by per-agent templates makes new agents a config operation. |

---

## 3. System Overview

```
        ┌───────────────────────────────────────────────┐
        │              AGENT LIST (screen 1)            │
        │  list agents (RLS by org) → status, version   │
        │  show Edit/Generate only where entitled       │
        └───────────────────────┬───────────────────────┘
                                │ select agent
                                ▼
        ┌───────────────────────────────────────────────┐
        │            POLICY EDITOR (screen 2)           │
        │  edit prompt / tools / thresholds / retry /   │
        │  escalation / guardrails  → validate (Zod)    │
        │  Save = upsert agent_policies (draft)         │
        └──────────┬───────────────────────┬────────────┘
                   │ Save                   │ Generate
                   ▼                        ▼
        ┌────────────────────┐   ┌──────────────────────────────┐
        │  agent_policies    │   │       GENERATE (action)      │
        │  (JSONB, draft)    │   │  POST /agents/:id/generate   │
        └────────────────────┘   │  1. load + Zod-validate pol. │
                                 │  2. render agent.ts (tmpl)   │
                                 │  3. write artifact + version │
                                 │  4. status draft → generated │
                                 └───────────────┬──────────────┘
                                                 │ writes
                                                 ▼
                          ┌──────────────────────────────────────┐
                          │            GRAPH STORE (DB)          │
                          │  agent_policies · agent_versions ·   │
                          │  graph_definitions · graph_versions  │
                          └──────────────────────────────────────┘
                                                 │
                        ══════════ Stage 1 ends here ══════════
                                                 │ (later stages)
                                    Compile → Publish → Active
                                                 │
                                                 ▼
                                   Runtime router reads a *published*
                                   graph and resolves events to it.
```

Everything above the "Stage 1 ends here" line is this document. The generator runs in-process on the authoring API; the artifact it writes is inert until a later stage compiles and publishes it. Splitting the admin app and API into separate deployables later is a process-topology change, not a code change.

---

## 4. Layer 1 — The Policy Record (data)

### 4.1 Contract

The unit an admin authors is a **policy record**: a validated, structured description of one agent's (product's) configured intent. It contains no code and no control flow — only named references to registered capabilities and their parameters. Because the agents are different products (SYNTRA matches candidates; VECTOR chases invoices), **each agent declares its own policy schema**: a shared base holds the fields every agent has, and the agent's template extends it with product-specific fields. The Policy Editor renders the form from the agent's schema, so it is one schema-driven form, not twelve hand-built ones.

```ts
// contracts/agent-policy.ts

// Shared base — the fields EVERY agent (product) has.
export const AgentPolicyBase = z.object({
  agentId:     z.string().ulid(),          // which product-agent
  agentKey:    z.string(),                  // stable slug: "syntra", "vector", ...
  retry:       z.object({
    max:      z.number().int().min(0).max(10).default(3),
    fallback: z.enum(["human_review", "skip", "fail"]).default("human_review"),
  }).default({}),
  escalation:  z.enum(["none", "human", "other_agent"]).default("none"),
  guardrails:  z.object({
    piiRedact:       z.boolean().default(false),
    maxOutputTokens: z.number().int().positive().optional(),
  }).default({}),
});

// Each agent's TEMPLATE contributes its product-specific fields. Examples:
export const SyntraPolicyExt = z.object({
  matchThreshold: z.number().min(0).max(100).default(60),
  hardFilters:    z.array(z.enum(["location","visa","availability","experience"])).default([]),
  rerank:         z.boolean().default(true),
});
export const VectorPolicyExt = z.object({
  dsoAlertDays:       z.number().int().positive().default(45),
  collectionPriority: z.enum(["balance","age","risk"]).default("age"),
});

// The generator composes base + the agent's extension at load time:
//   const schema = AgentPolicyBase.merge(templateFor(agentKey).policyExt)
export type AgentPolicy = z.infer<typeof AgentPolicyBase> & Record<string, unknown>;
```

The base is fixed and shared; the extension is declared by the agent's template (data). Adding a new product means shipping its template with a `policyExt` schema — the Policy Editor and generator consume it automatically. This is the schema-driven mechanism (A6) that makes new agents a config operation.

### 4.2 Design rules for policies — and why

**A policy references capabilities; it never defines them.** `allowedTools` holds *keys* into the Tool Registry (`"search"`, `"vector_db"`), never tool implementations. *Why:* this is the inertness guarantee — a policy can only ever select tools the platform has shipped, reviewed, and tested. A corrupted or malicious policy can misconfigure an agent but can never introduce a capability that does not already exist in code.

**Every referenced key must resolve at validation time.** Generation validates that each `allowedTools` entry exists in the registry and each threshold is in range *before* rendering anything. *Why:* the failure should surface as a precise field error in the editor ("tool `emailz` is not a registered tool"), not as a broken `agent.ts` discovered three stages later at compile time.

**Policy is the source of truth; `agent.ts` is derived.** The stored policy — not the generated file — is authoritative. Regenerating from the same policy must produce the same artifact (a pure transform). *Why:* if the artifact were authoritative, an admin edit and a regenerate could disagree, and "what did this agent do" would have two answers. One source of truth, one answer.

**Policy field keys are a stable contract.** Renaming a policy field or changing its meaning is a breaking change to every stored policy and to the generator template. Handle it with a new field and a policy schema version, never by re-meaning an existing field. *Why:* stored policies and in-flight generated artifacts reference the old shape; the old key must keep meaning what it meant.

### 4.3 What a policy is validated against

The same `AgentPolicySchema` validates the policy at three boundaries: on **Save** (client-side and server-side, for inline editor errors), on **Generate** (server-side, the authoritative gate before rendering), and — in a later stage — at **Compile**. *Why one schema in three places:* any policy the editor accepts is guaranteed acceptable to the generator; the consumers cannot drift.

---

## 5. Layer 2 — The Generator (code)

### 5.1 Responsibilities

The generator is a single, agent-agnostic engine: the bounded transform `(AgentPolicy, AgentTemplate) → graph definition`. It has four responsibilities and no others:

1. **Validate** the policy against `AgentPolicySchema` and against live registries (tools exist, referenced nodes exist). On failure: return `POLICY_INVALID` with per-field detail; write nothing.
2. **Load the agent's template** (`templateFor(agentKey)`): its node set, wiring rules, and `policyExt` schema. The generator itself contains no per-agent logic — the template supplies everything product-specific.
3. **Render** the graph definition: from the template's node set and wiring, apply the policy's parameters (thresholds, filters, retry, guardrails), and emit a `graph_definitions`-shaped topology referencing only registered node keys. (The concrete artifact — an `.def.ts`/`agent.ts` or a definition row — is settled in §11; the shape is a validated graph either way.)
4. **Persist** the generated graph and bump the agent's status to `generated`, recording a new `agent_versions` row with a checksum and the generating admin.

### 5.2 The bounded-output guarantee

The generator's most important property is that its output space is closed: **every `agent.ts` it can emit is a parameterisation of one reviewed template referencing only registry keys.** There is no policy input that makes it emit an arbitrary function body, an unreviewed import, or a call to an unregistered tool — those inputs fail validation in step 1. *Why this matters:* it reduces "is this generated agent safe?" from an open question about arbitrary code to a closed question about a fixed template plus a whitelist. The template gets reviewed once; every generation inherits that review.

### 5.3 Generate — server contract

```
POST /agents/:id/generate
  auth:    admin must hold edit entitlement on :id  (A3)
  body:    { policy: AgentPolicy }   // the saved draft
  200:     { status: "generated", agentId, version, checksum, generatedAt }
  4xx:     { error: "POLICY_INVALID", fields: [{ path, message }, ...] }
  409:     { error: "STALE_POLICY", currentVersion }  // optimistic-concurrency guard
  5xx:     { error: "GENERATION_FAILED" }             // template/render fault; nothing written
```

The 409 path exists because two admins may edit the same agent; the write is guarded by the version the client last read (optimistic concurrency). *Why not a lock:* a lock held across a human editing session is an availability problem; a version check at write time is cheap and only rejects genuinely concurrent edits.

---

---

## 5A. The Agent Template Layer (what makes "add a new agent → new graph" work)

An **agent template** is the per-product data that turns the generic generator into a specific agent's graph. It is the mechanism behind the core vision: *when settings change or a new capability is added, a new graph is generated — with no generator code change.*

A template declares, for one agent (product):

```jsonc
// templates/syntra.template.jsonc  (data — one per product-agent)
{
  "agentKey": "syntra",
  "displayName": "SYNTRA — AI Candidate Matching",
  "policyExt": "SyntraPolicyExt",          // the Zod schema name for its extra fields
  "nodes": [                                // the palette this agent may wire
    { "id": "parse",     "impl": "jd.parse" },
    { "id": "summarize", "impl": "cv.summarize" },
    { "id": "match",     "impl": "jd.match",   "configFrom": ["matchThreshold","rerank"] },
    { "id": "persist",   "impl": "match.persist" }
  ],
  "wiring": [                               // how policy toggles change the graph
    ["__start__","parse"], ["parse","summarize"], ["summarize","match"],
    ["match","persist"], ["persist","__end__"]
  ],
  "conditionalOn": {                        // policy-driven topology
    "hardFilters": "insert filter node before match when non-empty"
  }
}
```

**How a policy change becomes a new graph.** The admin edits SYNTRA's policy — say, turns on a `location` hard filter and raises `matchThreshold`. On Generate, the engine loads `syntra.template`, applies the policy: it inserts the filter node (because `hardFilters` is non-empty), stamps the threshold into the `match` node's config, and emits a new graph definition at a new version. No code shipped — a different graph came out because the *policy* and *template* combined differently. That is the whole point.

**Why templates are data, not code.** If templates were code, "add product #13" or "add a node to SYNTRA" would be a deploy. As data (validated against a `TemplateSchema`, authored in the repo and seeded like graph definitions), a new agent is a new template row the existing generator already knows how to consume. Behaviour still lives in code — the *nodes* the template references are registry implementations (shared with the runtime); the template only *wires and parameterises* them. A template can never introduce a node that does not exist in the registry.

**The boundary that keeps this safe.** A template may reference only registered node keys; a policy may set only fields its agent's `policyExt` declares; the generator emits only graph definitions that pass the same `GraphDefinitionSchema` the runtime validates. Three whitelists in series mean an admin (or a malformed template) can produce a *different* graph but never an *unsafe* one.

## 6. The Version / Status Lifecycle

An agent version moves through five states. **Stage 1 owns only the first two transitions.**

```
   draft ──Generate──▶ generated ──Compile──▶ compiled ──Publish──▶ published ──activate──▶ active
   (edit)              (this doc)              (later)              (later)               (runtime reads)
```

| Status | Meaning | Set by | In scope? |
|---|---|---|---|
| `draft` | Policy being edited; no artifact, or artifact stale | Save | Yes |
| `generated` | `agent.ts` rendered from the current policy; not validated as a graph | Generate | Yes — **Stage 1 ends here** |
| `compiled` | Artifact parsed + validated into a graph, checksummed, versioned | Compiler | No (later) |
| `published` | Reviewed and marked ready | Publish | No (later) |
| `active` | Live; the runtime router resolves events to it | activate | No (runtime) |

**Rationale for the staged lifecycle.** Each transition is a review gate. The distance between "an admin changed a form" (`draft`) and "this is live in production" (`active`) is three deliberate, separately-owned steps. This is the core safety property of the whole authoring system: no single action an admin takes in Stage 1 can reach the runtime. Statuses are one-directional within a version; a change after `generated` is a new version, never an in-place edit — for the same immutability reason the runtime pins `(graphKey, version)`: a version number must identify a fixed artifact.

---

## 7. Data Model

```sql
-- One row per agent (the 12). Mirrors the existing agent_definitions the runtime seeds.
-- agent_definitions(id, name, version, purpose, allowed_tools, model_config, is_active, ...)

CREATE TABLE agent_policies (
  id          text PRIMARY KEY,                     -- ULID
  org_id      text REFERENCES orgs(id),             -- NULL = global default
  agent_id    text NOT NULL REFERENCES agent_definitions(id),
  policy      jsonb NOT NULL,                        -- AgentPolicy (Zod-validated)
  status      text NOT NULL DEFAULT 'draft'
              CHECK (status IN ('draft','generated','compiled','published','active')),
  version     int  NOT NULL,
  checksum    text,                                  -- sha256 of the generated artifact
  created_by  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agent_id, COALESCE(org_id,'~global~'), version)
);

CREATE TABLE agent_versions (
  id          text PRIMARY KEY,
  agent_id    text NOT NULL,
  version     int  NOT NULL,
  artifact_ref text NOT NULL,                        -- where agent.ts lives (path or blob key)
  checksum    text NOT NULL,
  status      text NOT NULL,
  generated_by text NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now()
);

-- Invariant: at most one active version per (agent_id, scope) — mirrors graph_definitions.
CREATE UNIQUE INDEX agent_policies_one_active
  ON agent_policies (agent_id, COALESCE(org_id,'~global~'))
  WHERE status = 'active';
```

**Rationale for specific choices.** `org_id IS NULL` as the global scope with `COALESCE` in the unique index gives the same two-level resolution (org override, else global) the runtime uses, with no per-org duplication of defaults. The `checksum` over the generated artifact lets a later stage verify that a compiled graph matches exactly what a given policy+template emitted — the audit answer to "what was generated for this agent on this date." The single-active partial index enforces at the database level the invariant that one agent has at most one live version per scope.

---

## 8. Screens and UI States

### 8.1 Agent List (screen 1)

A table/grid of the agents visible to this admin. Columns: name (read-only), status badge (read-only), current active version (read-only), last-generated timestamp + author (read-only), and an Edit/Generate action **rendered only where the admin holds entitlement (A3)**. Non-editable agents still appear (read-only) so the admin sees the whole fleet; the affordance is hidden or disabled. Reads are RLS-scoped by `org_id`.

### 8.2 Policy Editor (screen 2) — states

| State | What the admin sees | Result |
|---|---|---|
| Idle | Fields editable; Generate enabled once required fields valid | default |
| Saving | Fields briefly disabled; no navigation | policy upserted as `draft` |
| Generating | Spinner on Generate; fields locked | awaiting API |
| Success | Confirmation with new version + timestamp | status → `generated` |
| Validation error | Inline errors under offending fields; Generate stays disabled | nothing written |
| Server error | Banner "Generation failed, try again"; draft preserved | nothing written |
| Stale (409) | "This agent was changed elsewhere; reload" | nothing written |

*Why the draft is always preserved on failure:* generation faults must never cost the admin their edits; Save and Generate are separable precisely so that intent is durable before the risky render step.

---

## 9. Boundary Against the Runtime (and later stages)

This document ends at `generated`. The connection to everything downstream is a single, one-directional data hand-off:

```
   Stage 1 (this doc)          Later stages              Runtime (built)
   ─────────────────           ────────────              ───────────────
   writes agent_policies  ──▶  Compile validates    ──▶  router resolves a
   + agent_versions            Publish activates          *published* graph
   at status=generated         (status → active)          from graph_definitions
```

Stage 1 never calls the runtime, and the runtime never calls Stage 1. They share only the graph store. This is what lets the admin app and the orchestrator be developed, tested, and deployed on independent schedules. The Compile and Publish stages — the two transitions between `generated` and `active` — are owned separately and specified in their own documents; they are named here only so the lifecycle is legible end to end.

---

## 10. Runtime Architecture (how this connects to Phase 1)

This chapter exists because design-time is only half the story: an authored, published agent means nothing until the runtime *executes* it. Everything below is the **already-built** Phase 1 runtime (its own design doc covers it in full); this is the connected summary a reviewer needs to see the whole loop. Where the built system differs from the pure design, that is called out honestly rather than papered over.

The runtime reads a **published** graph from the graph store and runs it in response to events. It never authors anything. The hand-off is one-directional: authoring writes definitions; runtime reads them.

**The event-chaining loop (the "orchestration sits on top, watching" part of the vision).** Agents do not call each other directly. When one agent's workflow completes, it emits a domain event to the outbox; the relay publishes it; the router resolves it to the *next* agent's workflow (if any). So SYNTRA finishing a match can trigger PRISM (submission), which can trigger TEMPO (interview) — each agent reacting to the previous agent's completion event, coordinated by the orchestrator, never by point-to-point calls. This is what lets the 12 agents behave as one connected system while staying independently authored and deployed.

```
 Event producers (Syntra, ATS, website, CRM, …)
        │  emit a domain event
        ▼
 ┌──────────────┐   validate envelope (Zod), write to event_outbox
 │   INGRESS    │   (in the built system Syntra publishes directly to the
 └──────┬───────┘    module queues — a documented bridge; see note)
        ▼
 ┌──────────────┐   (event.type, org) → graph_key
 │   ROUTER     │   resolve version, route to the module queue
 └──────┬───────┘
        ▼
 ┌──────────────┐   1. resolve pinned graph version
 │   WORKER     │   2. compiler.get(key, version) → compiled LangGraph
 │  (module)    │   3. graph.invoke(input, { thread_id })
 └──────┬───────┘   4. checkpoint after every node (Postgres saver)
        ▼
 ┌──────────────┐   node bodies run: currently call Syntra over HTTP
 │  EXECUTE     │   (the bridge); design target is in-process nodes
 └──────┬───────┘
        ▼
 ┌──────────────┐   workflow emits follow-on events → event_outbox
 │   OUTBOX     │   (published_at = NULL)
 └──────┬───────┘
        ▼
 ┌──────────────┐   reads unpublished rows via the syntra_relay role,
 │    RELAY     │   publishes to orchestration.dispatch, marks published
 └──────┬───────┘
        ▼
 orchestration.dispatch → next workflow, or terminal (acked)
```

**Router.** Maps `(event.type, org_id)` to a `graph_key` via a deterministic routing table (structured events already declare their intent, so no LLM sits in this path). In the built system this resolution lives in the dispatcher rather than a separate router worker — a documented simplification, valid while a single module publishes events.

**Version pinning.** The design's target (decision D3) is to stamp `(graphKey, graphVersion)` into the job payload *at enqueue* so every retry runs the exact topology it started on. The **built** system pins at *consume* time — it resolves the active version once when the job is picked up and reuses it for that delivery. Retry-safety across a crash is covered by the checkpointer (below); the narrower "promotion between enqueue and first pickup" window is the gap between practical and architectural D3, and closes when the enqueue-stamping router is built. *This distinction is stated plainly because a reviewer will ask exactly this.*

**Graph loading.** The worker calls `compiler.get(graphKey, orgId, pinnedVersion?)`. The compiler loads the inert JSON topology from `graph_definitions`, validates it (duplicate ids, edge endpoints, `__start__`/`__end__`, orphans, reachability), hydrates each node from the code registry, and caches the compiled graph by `graphKey@version:checksum`. A compiled graph is code and is never stored — only definitions are stored.

**Worker + LangGraph.** Each module queue has a pool of pg-boss workers. A worker compiles (or cache-hits) the graph and calls `graph.invoke(state, { configurable: { thread_id } })`. `thread_id` is stable across redeliveries (`orgId:jobId` in the built system), which is what makes checkpoint *resume* — not restart — work: a crashed run resumes at its first incomplete node. This is decision D4, the runtime's most load-bearing property, and it is proven by a resume-semantics test.

**Tool execution.** Node bodies invoke capabilities through the tool executor / node context. In the built system the Syntra nodes call Syntra's existing processing over HTTP (the bridge); the design target is in-process nodes calling tools and an `LLMClient` directly. Which of these is permanent is the one open architecture decision the runtime doc flags.

**Outbox + relay.** A workflow does not publish to the queue directly. It writes follow-on events to `event_outbox` (`published_at = NULL`) inside the run's transaction. A background **relay** reads unpublished rows and publishes them to `orchestration.dispatch`, then marks them published. In the built system the relay authenticates as the least-privileged `syntra_relay` role (which holds `UPDATE` on `event_outbox`); this is live and verified draining to zero unpublished rows. Terminal events (a completed match) have no downstream runbook and are acked, not errored.

---

## 11. Design-Time vs Runtime — the separation, at a glance

| | Design-Time (this document) | Runtime (Phase 1, built) |
|---|---|---|
| Trigger | An admin edits and clicks Generate | A producer emits a domain event |
| Primary action | Generates `agent.ts` from policy | Executes a compiled graph |
| Relationship to versions | *Creates* versions (`draft → generated`) | *Uses* a pinned version |
| Relationship to the graph store | **Writes** definitions / policies | **Reads** a published definition |
| Execution | None — produces an artifact only | Only execution — runs nodes, emits events |
| Failure blast radius | A bad artifact at `generated`; nothing live | A bad run; contained by retry + checkpoint |
| Source of truth it owns | The policy record | The checkpointed run state |
| Who acts | A human admin | The system, autonomously |

The row that matters most: **design-time writes and never executes; runtime executes and never authors.** Every other difference follows from that one. Note that "agent" on both sides means the same product — SYNTRA is configured on the left and executed on the right; the graph store is where the two meet.

---

## 12. Sequence Diagrams

### 12.1 Generate (design-time)

```
Admin      Policy Editor        Generate API        Generator          DB
  │              │                   │                  │               │
  │─open agent──▶│                   │                  │               │
  │              │─GET /agents/:id──▶│                  │               │
  │              │◀── policy ────────│                  │               │
  │─edit fields─▶│                   │                  │               │
  │─click Save──▶│─PUT /policy ─────▶│─ upsert draft ──────────────────▶│
  │              │◀── 200 (draft) ───│                  │               │
  │─Generate────▶│─POST /generate ──▶│                  │               │
  │              │                   │─validate policy─▶│               │
  │              │                   │◀ ok / field errs─│               │
  │              │                   │─render agent.ts─▶│               │
  │              │                   │                  │─ write ver. ─▶│
  │              │                   │◀── generated ────│               │
  │              │◀ 200 version+ts ──│                  │               │
  │◀ success UI ─│                   │                  │               │
```

### 12.2 Runtime execution (Phase 1, built)

```
Producer   Ingress/Queue   Router     Worker      Node/Tool    Outbox   Relay
   │            │            │           │             │          │        │
   │─event─────▶│            │           │             │          │        │
   │            │─enqueue───▶│           │             │          │        │
   │            │            │─route────▶│             │          │        │
   │            │            │           │─resolve ver.│          │        │
   │            │            │           │─compile+get─│          │        │
   │            │            │           │─invoke─────▶│          │        │
   │            │            │           │             │─call ────│        │
   │            │            │           │◀ state patch│          │        │
   │            │            │           │─emit events──────────▶│        │
   │            │            │           │  (checkpoint each node)│        │
   │            │            │           │             │          │◀ read ─│
   │            │            │           │             │          │─publish▶ dispatch
```

---

## 13. Component Diagrams

### 13.1 Policy Engine — inputs to a policy record

```
   prompt ──┐
   tools  ──┤
 thresholds─┼──▶  AgentPolicy (validated JSONB)  ──▶  agent_policies row (draft)
   retry  ──┤
 guardrails─┘
```

### 13.2 Generator — policy to artifact

```
   AgentPolicy ──▶ resolve template ──▶ inject prompt / import tools /
                                        build nodes / apply params
                                              │
                                              ▼
                                        agent.ts  (status: generated)
```

### 13.3 Compiler (later stage) — artifact to graph

```
   agent.ts ──▶ parse (AST) ──▶ validate ──▶ resolve deps ──▶
                checksum ──▶ graph definition + version (status: compiled)
```

*(13.3 is a later stage, shown for continuity; not built in Stage 1.)*

---

## 14. Data Model — Entity Relationships

```
 agent_definitions (the 12 agents)
        │ 1
        │
        │ N
 agent_policies ─────────────┐
   (one policy version per     │ each generated
    agent, per scope)          │ policy yields
        │ 1                    ▼
        │                 agent_versions
        │ N               (artifact_ref, checksum, status)
        │                      │
        ▼                      │ compile (later) produces
 graph_definitions ◀───────────┘
   (topology the runtime reads; graph_versions tracks history)
```

Relationships in words: one `agent_definitions` row has many `agent_policies` versions (one active per scope); generating a policy produces an `agent_versions` row (the artifact); a later compile stage materialises a `graph_definitions` row that the runtime reads. `graph_versions` mirrors `agent_versions` on the graph side. (An ERD with crow's-foot cardinality can be rendered from these tables; the runtime doc's `graph_definitions` schema is authoritative for its columns.)

---

## 15. API Surface

Stage 1 requires only the first four; the remainder belong to later stages and are listed so the full surface is legible. All routes are admin-authenticated and per-agent entitlement-checked (A3); all reads are RLS-scoped by `org_id`.

| Method + path | Stage | Purpose |
|---|---|---|
| `GET /agents` | 1 | List agents visible to this admin (Agent List). |
| `GET /agents/:id` | 1 | Load one agent + its current policy (Policy Editor). |
| `PUT /agents/:id/policy` | 1 | Save the policy as a `draft` (upsert; optimistic-concurrency guarded). |
| `POST /agents/:id/generate` | 1 | Validate policy → render `agent.ts` → `draft → generated`. |
| `POST /agents/:id/compile` | later | Parse + validate artifact into a graph (`generated → compiled`). |
| `POST /agents/:id/publish` | later | Review-gate and publish (`compiled → published`). |
| `POST /agents/:id/rollback` | later | Revert the active version to a prior published one. |

Contracts for the Stage 1 routes are specified in §5.3 (Generate) and §4.1 (the policy body). The later-stage routes are named here only for completeness; their request/response contracts are out of scope for this document.

---

## 16. Testing Strategy

Each layer has exactly one kind of test attached, mirroring the runtime doc's pyramid:

**Generator unit tests** (the bulk): given a policy, assert the emitted `agent.ts` (a) references only registered tools, (b) injects the prompt verbatim in the template's prompt slot, (c) applies retry/threshold/guardrail parameters, and (d) is itself type-valid (compile the emitted TS in-test). Include adversarial policies (unknown tool, out-of-range threshold) and assert `POLICY_INVALID` with the right field path — asserting the bounded-output guarantee (§5.2) directly.

**Policy schema tests**: round-trip valid and invalid policies through `AgentPolicySchema`; assert the editor's inline-error contract matches the server's.

**Generate API integration test** (one golden path + key failures): POST a valid policy through the real route against a test DB; assert `200` with a new version row and `status=generated`. Assert the `409` stale path and the `POLICY_INVALID` path write nothing.

**Access-control test**: assert an admin without entitlement on an agent gets no Edit/Generate affordance (list) and a `403` (API), for the same agent a second admin can edit.

Determinism rule: generation is a pure transform of policy + template + registry; no test calls a real LLM and no test reaches the runtime. Whether a *generated agent produces good outputs* is a runtime/eval concern, not an authoring-CI concern — authoring CI verifies the generator, not the model.

---

## 17. Open Questions for Team Review

1. ~~One policy schema or twelve?~~ **DECIDED (A6):** each agent (product) has its own `policyExt` schema on a shared base; the Policy Editor is one schema-driven form that renders from the agent's schema. Open sub-question: the exact base-vs-extension split for the first agents (SYNTRA, ASTRA).
2. **Does Generate overwrite `agent.ts` or create a new draft version alongside the published one?** (Determines whether `agent_versions` accumulates or replaces at `generated`.)
3. **Where does the artifact live** — a path on disk, or a blob/row in the graph store? `artifact_ref` abstracts this, but the team should pick one for Stage 1.
4. **Is Save-without-Generate a required state**, or is every Save immediately followed by Generate? (Affects whether `draft` is a first-class resting status.)
5. **Concurrent-edit UX:** is the optimistic `409` (A2/§5.3) sufficient, or does the product want soft-locking / presence indication?
6. **Audit trail depth:** `agent_versions` records who generated what and when — is that the full audit requirement, or is a separate immutable audit log needed for compliance?

---

## Appendix A — Invariants (the short list every PR is reviewed against)

1. Policy is data; generation is code. No admin action authors arbitrary behaviour.
2. A policy references only registered tools/nodes; unknown keys fail validation before render.
3. The stored policy is the source of truth; `agent.ts` is a pure, reproducible derivation of it.
4. Generate reaches `generated` only. Nothing in Stage 1 compiles, publishes, activates, or runs.
5. Every status is one-directional within a version; a change after `generated` is a new version.
6. At most one `active` version per `(agent_id, scope)`, enforced by a DB partial unique index.
7. Every authoring DB access runs under the admin's `org_id` scope (RLS); entitlement is checked per agent.
8. One Zod schema validates a policy at Save, Generate, and Compile — no drift between consumers.
9. Authoring and runtime share only the graph store; neither calls the other.
