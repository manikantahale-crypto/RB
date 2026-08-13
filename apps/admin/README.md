# Admin — Agent Authoring

**Source of truth:** [`agent-authoring-admin-design-final.md`](./agent-authoring-admin-design-final.md)

| Doc | Purpose |
|-----|---------|
| [`agent-authoring-admin-design-final.md`](./agent-authoring-admin-design-final.md) | Final design (canonical) |
| [`PLAN.md`](./PLAN.md) | Stage division index — section → stage map (nothing missing) |
| [`STAGE_1.md`](./STAGE_1.md) | Stage 1: Agent List → Policy Editor → Generate → `generated` |
| [`STAGE_1_AUDIT.md`](./STAGE_1_AUDIT.md) | Full Stage 1 audit |
| [`STAGE_2.md`](./STAGE_2.md) | Stage 2: Compile → `compiled` |
| [`STAGE_2_AUDIT.md`](./STAGE_2_AUDIT.md) | Full Stage 2 audit |
| [`COMPILE_DESIGN.md`](./COMPILE_DESIGN.md) | Compile internals / API contract |
| [`STAGE_3.md`](./STAGE_3.md) | Stage 3: Publish → activate → `active` |
| [`STAGE_3_AUDIT.md`](./STAGE_3_AUDIT.md) | Full Stage 3 audit |
| [`PUBLISH_DESIGN.md`](./PUBLISH_DESIGN.md) | Publish / activate scoping + API |
| [`RUNTIME.md`](./RUNTIME.md) | Companion: already-built orchestrator (§10 / §12.2) |
| [`STATUS.md`](./STATUS.md) | Implementation checklist |

**API package:** `../admin-api` — code only; docs stay here.

---

## Pipeline

```text
Agent List → Policy Editor → Generate → Compile → Publish
└──────────── Stage 1 ────────────┘     Stage 2    Stage 3
```

Stage 1: *nothing executes.*

---

## Run

**Authoring only (one terminal):**

```powershell
cd ...\orchaestration
npm run dev:admin
# → API http://localhost:4200/health
# → UI  http://localhost:5173
```

Ctrl+C stops both.

**Separate terminals (same thing):**

```powershell
npm run dev -w @tekisho/admin-api
npm run dev -w @tekisho/admin
```

Do **not** start API (`:4100`) or worker unless you are smoke-testing events
(`npm run start -w @tekisho/api` + `npm start`).

Stages 1–3 authoring APIs + SPA actions are wired. After **Make this live**,
JD production traffic prefers `syntra.authored` when that key is active
(else seed `syntra.jd.workflow`). Match/resume still use their seed keys.
