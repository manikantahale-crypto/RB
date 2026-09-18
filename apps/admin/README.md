# Admin — Agent Authoring

The authoring UI (screens 1–13 of the platform). The design and stage documents that
used to sit beside this file were removed on 2026-09-18; the screen guide and decisions
live with the platform documentation, not in the repo.

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
