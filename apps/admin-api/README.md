# Admin API (`@tekisho/admin-api`)

Authoring HTTP API for Stage 1 (Save policy + Generate).

**All plan / status / design docs:** [`../admin/`](../admin/)  
Especially: [`../admin/agent-authoring-admin-design-final.md`](../admin/agent-authoring-admin-design-final.md), [`../admin/PLAN.md`](../admin/PLAN.md), [`../admin/STAGE_1.md`](../admin/STAGE_1.md), [`../admin/STATUS.md`](../admin/STATUS.md)

Do **not** add a second copy of those docs here.

---

## Run

```powershell
npm run start -w @tekisho/admin-api
```

Default port: **4200** (`ADMIN_API_PORT`).  
Requires `DATABASE_MIGRATOR_URL` (boot schema) and preferably `DATABASE_RELAY_URL` (reads `agent_definitions` + authoring DML) in repo-root `.env`.

### Headers

| Header | Purpose |
|--------|---------|
| `x-org-id` | Sets `app.org_id` for RLS (omit / empty = global `org_id NULL`) |
| `x-admin-id` | Actor + entitlement lookup (default `admin-local`; fail-closed) |

### Access (A3)

- Edit/Generate require a row in `admin_agent_entitlements` (`can_edit=true`).
- List still shows all agents; `canEdit: false` hides Edit affordance; writes return `403 FORBIDDEN`.
- Authoring tables use RLS (global readable; writes only for matching org / global when GUC unset).

### Routes

| Method | Path | Notes |
|--------|------|-------|
| `GET` | `/templates` | Active agent templates (A6) |
| `GET` | `/agents` | Active `agent_definitions` + latest policy |
| `GET` | `/agents/:id` | Definition + latest policy + template |
| `PUT` | `/agents/:id/policy` | Body `{ policy, expectedVersion? }` → `draft` |
| `POST` | `/agents/:id/generate` | Body `{ policy, expectedVersion? }` → `generated` |

Errors: `FORBIDDEN` (403), `POLICY_INVALID` (400), `STALE_POLICY` (409), `NO_DRAFT` / `NOT_DRAFT` (404/409).

Shared logic: `@tekisho/authoring`.
