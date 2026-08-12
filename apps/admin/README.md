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

```powershell
npm run start -w @tekisho/admin-api
# → http://localhost:4200/health

npm run dev -w @tekisho/admin
# → http://localhost:5173
```

Stages 1–3 authoring APIs + SPA actions are wired. Activating an authored graph does **not** remount runtime `*.workflow` traffic.
