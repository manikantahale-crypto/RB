# Admin Builder — what runs where

## One terminal for Admin UI + API

From `orchaestration/`:

```powershell
npm run dev:admin
```

This starts **both**:
- Admin API on http://localhost:4200
- Builder UI on http://localhost:5173/builder

Logs are prefixed `[api]` and `[ui]` in the same terminal.

### Full stack (optional — only if testing Syntra uploads too)

| What | Command | Port |
|------|---------|------|
| Admin (builder) | `npm run dev:admin` | 4200 + 5173 |
| Orch worker | `npm run start -w @tekisho/worker` | — |
| Syntra API | `npm start` in Syntra node-api | 4000 |
| Syntra UI | `npm run dev` in Syntra Front | 3000 |

You do **not** need 5 terminals for builder-only work — use **one** `dev:admin` terminal.

---

## File map (what belongs to what)

### UI (`apps/admin/`)

| File | Purpose |
|------|---------|
| `src/App.tsx` | Routes: `/builder`, go-live requests |
| `src/pages/BuilderPage.tsx` | Sidebar agent list + Create Agent |
| `src/pages/PolicyEditor.tsx` | Policy Box, Create workflow, Make live, activity log |
| `src/api.ts` | Browser client for admin-api |
| `src/styles.css` | Builder layout + policy box styles |

### API (`apps/admin-api/`)

| File | Purpose |
|------|---------|
| `src/index.ts` | Boots API, schema ensure, registers routes |
| `src/routes/catalog.ts` | Tools/events catalog, **POST /agents** (create) |
| `src/routes/agents.ts` | Policy save, generate, compile, go-live, GET agent detail |
| `src/with-org-scope.ts` | DB org context for RLS |

### Authoring engine (`packages/authoring/`)

| File | Purpose |
|------|---------|
| `src/policy-ext-ui.ts` | Policy Box field definitions (prompt, tools, trigger) |
| `src/validate-policy.ts` | Validation before save/generate |
| `src/generate-graph.ts` | Template → graph JSON |
| `src/generate-graph-from-llm.ts` | LLM → graph JSON |
| `src/generation-meta.ts` | What gets stored in DB audit (`meta`) |
| `src/event-bindings.ts` | `graph_event_bindings` upsert on activate |
| `src/trigger-events.ts` | Trigger event dropdown catalog |
| `src/tool-registry.ts` | Allowed tools for graphs |

### Database (`packages/db/`)

| File | Purpose |
|------|---------|
| `migrations/V12–V19` | Policies, versions, bindings, grants |
| `scripts/grant-admin-builder.sql` | **Run once in Supabase** for Create Agent |

---

## Why "Create workflow" might look like it does nothing

1. **Button disabled** — scroll Policy Box: fill **System prompt**, check **Tools**, pick **Trigger event**. A red hint appears under the button explaining what's missing.

2. **Required fields were below the fold** — Builder fields (prompt/tools/event) are now **at the top** of the Policy Box; retry/escalation settings are under "Advanced".

3. **No visible feedback** — use the **Activity log** under the workflow card. It shows save/generate API results.

4. **API logs** — watch the terminal running `npm run dev:admin`; the `[api]` lines show every HTTP request and error.

5. **Template vs LLM** — empty "Your description" = **template** generate (no LLM). Filled description = LLM preview (needs `LLM_PROVIDER` in `.env`).

### SonuZ example (visa matching)

For "match on visa only":
1. **System prompt** — describe visa-only matching
2. **Tools** — enable `syntra.match.process` (and `syntra.jd.process` if JD-triggered)
3. **Trigger event** — e.g. `syntra.jd.received` or `syntra.match.requested`
4. **Hard filters** — set `visa` in policy if using SyntraPolicyExt fields
5. **Save draft** → **Create workflow** → check Activity log for `Generated v…`

---

## DB: what gets stored

| Action | Tables |
|--------|--------|
| Create agent | `agent_definitions`, `agent_templates`, `agent_policies`, `admin_agent_entitlements` |
| Save policy | `agent_policies` |
| Generate | `agent_versions.artifact_source`, `agent_versions.meta` |
| Make live | `graph_definitions`, `graph_event_bindings`, policy `active` |

Seed agents (matching, intake, copilot) are **never modified** — custom agents get new `agent_id`.
