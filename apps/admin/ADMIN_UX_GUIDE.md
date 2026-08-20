# Tekisho Orchestration — Admin UI Guide

> **Audience:** UX designers, front-end developers, and anyone opening this app for the first time.  
> **URL:** http://localhost:5173  
> **Stack:** React SPA (Vite) → Admin API on :4200 → Supabase Postgres

---

## Big picture

This admin UI lets a non-engineer describe what an AI agent should do in plain English, then turns that description into a live workflow that runs automatically when Syntra uploads a JD or resume.

There are **two pages** in the nav bar:

| Nav link | Route | What it is |
|---|---|---|
| **Builder** | `/builder` | Where you create, edit, and publish agents |
| **Go-live** | `/go-live-requests` | Where you approve agents and see what is currently live |

---

## Page 1 — Builder (`/builder`)

This is the main workspace. It has two panels side by side.

---

### Left panel — Agent list (sidebar)

Lists every agent that exists. Each row shows:
- **Agent name** (e.g. "AI Candidate Matching")
- **Status badge**: Draft / Ready / Live

#### Buttons in the sidebar header

| Button | What it does |
|---|---|
| **+ Create** | Opens the "New agent" form inline in the sidebar. Does not navigate away. |
| **All policies** | Opens a read-only modal showing every agent's policy text at once. Useful for a quick overview. |

#### Creating a new agent

When you click **+ Create**, three fields appear:

| Field | Purpose |
|---|---|
| **Copy from** (dropdown) | Clone an existing agent's policy + workflow as a starting point. Default = blank template. |
| **Name** | Short label for this agent (e.g. "Visa-only JD matching"). |
| **What should it do?** | One-line description (optional). Appears as subtitle in the sidebar. |

Click **Create** → navigates straight into the builder for the new agent.  
Click **Cancel** → closes the form.

#### Selecting an existing agent

Click any row in the sidebar. The right panel loads that agent's editor. The row highlights.

#### Deleting an agent

A small **×** button appears on the right of each row (only for agents you are allowed to delete — seed/system agents are protected). Click it → browser confirm dialog → deletes permanently.

---

### Right panel — Policy Editor

This is where all the authoring work happens. It has several sections stacked vertically.

---

#### Agent name bar (top strip)

Shows the agent name, its status badge, and a **Delete** button (only if deletable).

---

#### Status stepper

A horizontal track with four steps:

```
Policy  →  Preview  →  Graph saved  →  Live
```

The current step is highlighted. This tells you exactly where in the workflow you are at a glance.

| Step | What it means |
|---|---|
| **Policy** | You have started typing a policy. Nothing generated yet. |
| **Preview** | The LLM has proposed a graph but you have not accepted it yet. |
| **Graph saved** | You accepted the preview and the graph is stored. |
| **Live** | The agent is bound to a real trigger event and running on the platform. |

---

#### "When this runs" (trigger event selector)

A dropdown that sets which platform event starts this agent.

| Event option | When Syntra fires it |
|---|---|
| Job description received | A JD file is uploaded |
| Resume received | A resume is uploaded |
| Match requested | A job × resume pair is queued for scoring |
| Duplicate review required | A probable duplicate needs a human decision |
| Job description parsed | Structured requirements extracted from a JD |
| Profile prepared | Resume parse + skills + embedding complete |

> **Important:** Only one agent can own a trigger event at a time. If you pick an event that another agent already owns, go-live will be blocked with the message "Another agent is already active for this trigger event."

---

#### Policy box

A free-text area. Write what the agent should do in plain English.

**Examples:**

```
When a job description arrives, process the JD. Then score matches with a threshold of 80.
```

```
When a resume arrives, process the profile. Then check for duplicates.
```

The text is sent verbatim to the LLM when you click Generate. The LLM picks the right tools and order from it.

> Scope hints appear below the box while you are typing (e.g. "email is not supported"). These disappear once you stop editing.

---

#### Advanced settings (collapsed by default)

Fields like retry count, escalation, guardrails (PII redaction, max output tokens). These do not affect which tools run — they control what happens if the agent fails.

---

#### "Workflow from policy" bar

This bar appears below the policy and contains the generate buttons.

| Button | When it appears | What it does |
|---|---|---|
| **Generate workflow** | No graph exists yet | Sends the policy to the LLM. Returns a proposed graph. |
| **Regenerate workflow** | Graph already exists and policy was changed | Re-runs the LLM with the updated policy. Replaces the current graph after you accept. |

Both buttons are **disabled** if:
- The policy text is empty
- The policy has unsaved changes (save first)

While generating, the button shows **"Generating…"** and the whole form is locked.

---

#### Workflow canvas

Shows the generated graph as a visual step list.

Each step card shows:
- **Step name** (e.g. "Process job description")
- **Tool key** (e.g. `syntra.jd.process`)
- **Config bits** if set: Min score, Rerank on/off, Filters

When a preview is pending (not yet accepted), the canvas shows the **proposed** graph with a yellow "Not saved" badge in the stepper.

**In read-only mode** (after accepting): you can see all steps but cannot drag or edit.

**In edit mode** (when you click "Edit steps manually"): you can:
- Add a step (tool picker dropdown)
- Remove a step (× on the card)
- Reorder steps (drag handle)

Changes in edit mode do not save automatically — you must click **Save workflow** to commit.

---

#### Preview accept/reject bar

Only visible when the LLM has returned a proposed graph that has not been accepted yet.

| Button | What it does |
|---|---|
| **Accept & save** | Stores the proposed graph as the agent's current workflow. Status moves to "Graph saved". |
| **Discard preview** | Throws away the proposal. Policy and existing workflow are unchanged. |

If the LLM flagged anything it could not implement (e.g. you asked for email), a yellow banner shows "Could not implement: email" — the rest of the graph is still usable.

---

#### Go-live panel

Appears at the bottom when the graph is saved (status = `generated` or `pending_go_live`).

**Go-live checklist** — before the button activates, the system runs checks:

| Check | What it verifies |
|---|---|
| Policy saved | A policy version exists |
| Workflow generated | A graph definition exists |
| No conflicting binding | No other live agent owns this trigger event |
| Tools in registry | Every tool in the graph exists in the runtime |

If all checks pass:

| Button | What it does |
|---|---|
| **Make it live** | Activates the agent immediately. The worker starts routing that event to this graph. |
| **Request go-live** | Submits an approval request (for review on the Go-live page). Used when a second person must approve. |

If the agent is already live:

| Button | What it does |
|---|---|
| **Take offline** | Removes the event binding. The worker stops routing that event to this agent. Existing running workflows are not interrupted. |

**Rollback** — if you want to go back to a previous version:
- Enter a version number in the rollback input
- Click **Rollback** → restores that graph version as active

---

## Page 2 — Go-live (`/go-live-requests`)

Accessed via the **Go-live** link in the top nav.

---

### Live agents section

A list of every agent currently live on the platform. Each card shows:
- Agent name + purpose
- Status badge (Live)
- Which trigger event it owns (e.g. "Handles: syntra.jd.received")
- **Open in Builder** button → navigates back to that agent in the Builder

---

### Waiting for approval section

Lists agents that clicked **Request go-live** but have not been approved yet.

Each card shows:
- Agent name + purpose
- Version number + request timestamp

| Button | What it does |
|---|---|
| **Open** | Goes to that agent in the Builder so you can review the graph |
| **Approve** | Browser confirm → activates the agent. It becomes live immediately. |

---

## Full lifecycle — step by step

```
1. Click + Create in the sidebar
2. Name the agent, click Create & open builder
3. Pick "When this runs" (trigger event)
4. Write policy in plain English
5. Click Generate workflow
6. LLM returns a proposed graph — canvas shows it
7. Review the steps, click Accept & save
8. Go-live checklist runs automatically
9. Click Make it live (or Request go-live for approval)
10. Agent is now live — worker routes that event to this graph
```

---

## Error messages and what they mean

| Message | Cause | Fix |
|---|---|---|
| "Another agent is already active for this trigger event" | A different agent already owns that event | Change "When this runs" to a different event, or take the other agent offline first |
| "unknown tool impl(s) not in registry" | LLM invented a tool name | Click Regenerate — the system now strips invalid tools automatically |
| "Generate a policy (Stage 1) before Compile" | The policy was never saved | Type a policy and save it first |
| "Could not reach admin API on port 4200" | Admin API is not running | Run `npm run dev:admin` in the orch-llm folder |
| "No active graph_definitions for …" | Go-live picked a graph key that has no compiled graph | Accept the LLM preview first, then try go-live again |

---

## What the admin UI does NOT do

- It does not upload JDs or resumes (that is Syntra's job)
- It does not show running workflows or their progress
- It does not send emails or Slack messages
- It does not let you edit the raw graph JSON directly

These are all possible additions for a future iteration.

---

## Routes reference

| URL | Component | Purpose |
|---|---|---|
| `/builder` | `BuilderPage` | Sidebar + empty main panel |
| `/builder/:agentId` | `BuilderPage` + `PolicyEditorPage` | Sidebar + full editor |
| `/agents/:agentId` | `PolicyEditorPage` (standalone) | Full editor without sidebar |
| `/go-live-requests` | `GoLiveRequestsPage` | Approval queue + live agent list |
