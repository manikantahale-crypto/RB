/**
 * Copy what the old project has and the new one does not — mapped, idempotent, re-runnable.
 *
 *   node scripts/copy-delta.mjs --dry-run                 rehearse everything, roll back, print counts
 *   node scripts/copy-delta.mjs                           do it
 *   node scripts/copy-delta.mjs --steps users,vendors     only these steps (names below)
 *   node scripts/copy-delta.mjs --since 2026-09-18T17:00:00Z   read only rows created/updated since
 *
 * WHAT THIS IS FOR
 *
 * The new project's core.* is a copy taken 2026-09-10 12:22; SYNTRA, ASTRA and
 * everyone else kept writing the old project's syntra.* and public.* tables
 * afterwards (ref/Old_Repo_Findings.md §3.2). The first copy was a schema
 * dump; this one has to MAP: syntra.jobs into core.requirements + embeddings
 * + processing_jobs + source_files, orbit_activities into core.activities,
 * and so on. The column mapping is the repo's own app.mirror_* functions
 * (packages/db/migrations/V20260909.15/.18/.20/.23), re-expressed here as
 * INSERT … ON CONFLICT so that running it again is harmless and picks up
 * rows that changed. ref/Data_Migration_Plan.md §3.4–§3.5 is the spec.
 *
 * WHAT IT NEVER DOES
 *
 * Write to the old project. The source connection is opened read-only and
 * every statement against it is a SELECT.
 *
 * WHAT IT SKIPS, AND SAYS SO
 *
 * The mirror rules skip a candidate with no name, a resume whose person is not
 * in core, a match whose requirement/person/resume do not all exist with one
 * organisation, an activity whose person is gone. Every skipped row is written
 * to the report (ref/docbuild/copy-delta.report.json) with its id and the
 * reason. Nothing is dropped silently.
 *
 * ORDER
 *
 * Forced by the foreign keys: users → vendors → people → requirements →
 * resumes → matches → review queue → prism → relay → activities → orbit.
 * Migrations V20260909.63–.68 must be applied first (they create the target
 * tables); V20260909.69 validates the NOT VALID keys afterwards.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const argVal = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const since = argVal("--since");
const only = argVal("--steps")?.split(",").map((s) => s.trim());
// Dry-run only: run these migration files (bodies, placeholders substituted)
// inside the same transaction first, so the copy can be rehearsed before the
// migrations that create its target tables have been applied.
const rehearseMigrations = argVal("--rehearse-migrations")?.split(",").map((s) => s.trim()) ?? [];
// Dry-run only: run these AFTER the copy, in the same transaction — V20260909.69
// (validate the NOT VALID keys) is the one that belongs here.
const rehearseAfter = argVal("--rehearse-after")?.split(",").map((s) => s.trim()) ?? [];
if ((rehearseMigrations.length || rehearseAfter.length) && !dryRun) { console.error("--rehearse-migrations / --rehearse-after are only allowed with --dry-run"); process.exit(2); }

async function runMigrationBody(f) {
  const conf = fs.readFileSync(path.join(root, "packages/db/flyway.conf"), "utf8");
  const ph = Object.fromEntries([...conf.matchAll(/^flyway\.placeholders\.(\w+)=(.*)$/gm)].map((m) => [m[1], m[2].trim()]));
  const sql = fs.readFileSync(path.resolve(root, f), "utf8").replace(/\$\{(\w+)\}/g, (m, k) => ph[k] ?? m);
  await tgt.query(sql.replace(/^\s*BEGIN\s*;/m, "").replace(/^\s*COMMIT\s*;/m, ""));
  console.log(`  rehearsed ${path.basename(f)}`);
}
const REPORT = path.join(root, "ref/docbuild/copy-delta.report.json");

const urlFrom = (envPath) => fs.readFileSync(path.join(root, envPath), "utf8")
  .split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL=")).slice(13).replace(/^"|"$/g, "");

const src = new pg.Client({ connectionString: urlFrom("old_db_repo/.env"), ssl: { rejectUnauthorized: false }, statement_timeout: 120000 });
const tgt = new pg.Client({ connectionString: urlFrom(".env"), ssl: { rejectUnauthorized: false } });
tgt.on("notice", (n) => console.log(`   ${n.message}`));

const report = { started: new Date().toISOString(), dryRun, since, steps: {} };
const ctx = {};   // lookup maps loaded from the target, refreshed as steps land

// ─────────────────────────────────────────────────────────────── helpers ──

const sinceWhere = (cols) => (since ? `WHERE ${cols.map((c) => `${c} > $1`).join(" OR ")}` : "");
const sinceParams = () => (since ? [since] : []);

async function readAll(sql, params = []) {
  const { rows } = await src.query(sql, params);
  return rows;
}

/**
 * Multi-row upsert. `cols` are target columns; `casts` maps a column to a SQL
 * type appended to its placeholder (jsonb, vector, citext…). Returns rows
 * affected as reported by RETURNING (xmax = 0 → inserted, else updated).
 */
async function upsert({ table, cols, rows, conflict, update, casts = {}, where = "" }) {
  let inserted = 0, updated = 0;
  const CHUNK = 200;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const params = [];
    const values = chunk.map((r) => "(" + cols.map((c) => {
      params.push(r[c] === undefined ? null : r[c]);
      return `$${params.length}${casts[c] ? "::" + casts[c] : ""}`;
    }).join(", ") + ")");
    const upd = update.length
      ? `DO UPDATE SET ${update.map((c) => `${c} = EXCLUDED.${c}`).join(", ")}${where}`
      : "DO NOTHING";
    const sql = `INSERT INTO ${table} (${cols.join(", ")}) VALUES ${values.join(",\n")}
      ON CONFLICT (${conflict.join(", ")}) ${upd}
      RETURNING (xmax = 0) AS inserted`;
    const { rows: out } = await tgt.query(sql, params);
    for (const o of out) { if (o.inserted) inserted++; else updated++; }
  }
  return { inserted, updated };
}

async function loadMaps() {
  const m = async (sql) => new Map((await tgt.query(sql)).rows.map((r) => [r.id, r.org_id]));
  ctx.users = new Set((await tgt.query("SELECT id FROM platform.users")).rows.map((r) => r.id));
  ctx.userOrg = new Map();
  for (const r of (await tgt.query("SELECT user_id, org_id, count(*) OVER (PARTITION BY user_id) n FROM platform.org_members")).rows) {
    if (Number(r.n) === 1) ctx.userOrg.set(r.user_id, r.org_id);
  }
  ctx.orgs = new Set((await tgt.query("SELECT id FROM platform.organizations")).rows.map((r) => r.id));
  ctx.people = await m("SELECT id, org_id FROM core.people");
  ctx.requirements = await m("SELECT id, org_id FROM core.requirements");
  ctx.resumes = await m("SELECT id, org_id FROM core.resumes");
  ctx.matches = new Set((await tgt.query("SELECT id FROM core.matches")).rows.map((r) => r.id));
  ctx.vendors = await safeSet("SELECT id FROM core.vendors");
}

async function safeSet(sql) {
  try { return new Set((await tgt.query(sql)).rows.map((r) => r.id)); } catch { return new Set(); }
}

function step(name, fn) { return { name, fn }; }

// ───────────────────────────────────────────────────────────────── steps ──

const STEPS = [

  step("users", async () => {
    // platform.* on the old project by id, then the syntra.users rows that
    // never made it into platform.users (2 on 2026-09-18), with the org that
    // public.users recorded for them.
    const orgCols = ["id", "name", "slug", "status", "settings", "created_at", "updated_at", "deleted_at"];
    const orgs = await readAll(`SELECT ${orgCols.join(", ")} FROM platform.organizations`);
    for (const r of orgs) if (r.settings != null) r.settings = JSON.stringify(r.settings);
    const o = await upsert({ table: "platform.organizations", cols: orgCols, rows: orgs, conflict: ["id"], casts: { settings: "jsonb" }, update: orgCols.filter((c) => c !== "id") });

    const users = await readAll(`SELECT id, email, full_name, password_hash, status, created_at, updated_at, deleted_at FROM platform.users`);
    const u = await upsert({ table: "platform.users", cols: ["id", "email", "full_name", "password_hash", "status", "created_at", "updated_at", "deleted_at"],
      rows: users, conflict: ["id"], update: ["email", "full_name", "password_hash", "status", "updated_at", "deleted_at"] });

    const stray = await readAll(`
      SELECT s.id, s.email, s.full_name, s.password_hash, s.created_at, pu.organization_id AS org_id
        FROM syntra.users s
        LEFT JOIN public.users pu ON pu.id = s.id
       WHERE NOT EXISTS (SELECT 1 FROM platform.users p WHERE p.id = s.id)`);
    const skipped = [];
    const ok = stray.filter((r) => { if (!r.org_id) { skipped.push({ id: r.id, reason: "syntra.users row with no organisation in public.users" }); return false; } return true; });
    const s = ok.length ? await upsert({ table: "platform.users", cols: ["id", "email", "full_name", "password_hash", "status", "created_at"],
      rows: ok.map((r) => ({ ...r, status: "active" })), conflict: ["id"], update: [] }) : { inserted: 0, updated: 0 };

    const members = await readAll("SELECT org_id, user_id, role, status, created_at, updated_at FROM platform.org_members");
    // 54 of 55 old memberships are 'operator' (the other is 'admin'); a stray Recruiter is an operator.
    for (const r of ok) members.push({ org_id: r.org_id, user_id: r.id, role: "operator", status: "active", created_at: r.created_at, updated_at: r.created_at });
    const mm = await upsert({ table: "platform.org_members", cols: ["org_id", "user_id", "role", "status", "created_at", "updated_at"],
      rows: members, conflict: ["org_id", "user_id"], update: ["role", "status", "updated_at"] });
    return { organizations: o, users: u, stray_syntra_users: s, org_members: mm, skipped };
  }),

  step("vendors", async () => {
    const rows = await readAll(`SELECT id, name, vendor_type, status, website, email, phone, linkedin, location, timezone,
                                       payment_terms, preferred_technologies, preferred_immigration_types, created_by, created_at, updated_at
                                  FROM public.vendors`);
    const skipped = [];
    const ok = rows.filter((r) => {
      if (!ctx.users.has(r.created_by)) { skipped.push({ id: r.id, reason: `created_by ${r.created_by} not in platform.users` }); return false; }
      const org = ctx.userOrg.get(r.created_by);
      if (!org) { skipped.push({ id: r.id, reason: `created_by ${r.created_by} has no single organisation` }); return false; }
      r.org_id = org; return true;
    });
    const cols = ["id", "org_id", "name", "vendor_type", "status", "website", "email", "phone", "linkedin", "location", "timezone",
      "payment_terms", "preferred_technologies", "preferred_immigration_types", "created_by", "created_at", "updated_at"];
    const res = await upsert({ table: "core.vendors", cols, rows: ok, conflict: ["id"], update: cols.filter((c) => !["id", "org_id", "created_by", "created_at"].includes(c)) });
    return { ...res, skipped };
  }),

  step("people", async () => {
    // app.mirror_candidate, V20260909.15 lines 36-72
    const rows = await readAll(`SELECT id, org_id, full_name, email, phone, linkedin, github, location, immigration_status, availability,
                                       current_title, candidate_source, status, created_by, created_at, updated_at
                                  FROM syntra.candidates ${sinceWhere(["created_at", "updated_at"])}`, sinceParams());
    const skipped = [];
    const ok = rows.filter((r) => {
      if (r.full_name == null) { skipped.push({ id: r.id, reason: "full_name IS NULL (mirror_candidate rule)" }); return false; }
      if (!r.org_id || !ctx.orgs.has(r.org_id)) { skipped.push({ id: r.id, reason: `org_id ${r.org_id} not in platform.organizations` }); return false; }
      r.email = r.email === "" ? null : r.email;
      r.status = r.status ?? "active";
      r.created_by = ctx.users.has(r.created_by) ? r.created_by : null;
      return true;
    });
    const cols = ["id", "org_id", "full_name", "email", "phone", "linkedin", "github", "location", "immigration_status", "availability",
      "current_title", "candidate_source", "status", "created_by", "created_at", "updated_at"];
    const res = await upsert({ table: "core.people", cols, rows: ok, conflict: ["id"], casts: { email: "citext" },
      update: ["full_name", "email", "phone", "linkedin", "github", "location", "immigration_status", "availability", "current_title", "candidate_source", "status", "updated_at"] });
    return { ...res, skipped };
  }),

  step("requirements", async () => {
    // app.mirror_job — V20260909.23 lines 55-75 (columns), V20260909.20 lines 59-77 (embedding, processing, file).
    // syntra.jobs has no updated_at trigger, so --since cannot be trusted for it: always read in full.
    const rows = await readAll(`SELECT * FROM syntra.jobs`);
    const skipped = [];
    const ok = rows.filter((r) => {
      if (!r.org_id || !ctx.orgs.has(r.org_id)) { skipped.push({ id: r.id, reason: `org_id ${r.org_id} not in platform.organizations` }); return false; }
      return true;
    });
    const reqs = ok.map((r) => ({
      id: r.id, org_id: r.org_id, title: r.title, company_name: r.company_name, vendor_id: ctx.vendors.has(r.vendor_id) ? r.vendor_id : null,
      summary: r.jd_summary, primary_role: r.primary_role, required_skills: r.required_skills, mandatory_skills: r.mandatory_skills,
      preferred_skills: r.preferred_skills, skill_weights: r.skill_weights, score_threshold: r.score_threshold,
      min_experience: r.min_experience, max_experience: r.max_experience, visa_requirement: r.visa_requirement,
      employment_type: r.employment_type, location: r.location, remote_policy: r.remote_policy,
      status: r.status ?? "open",
      origin: r.source_type != null ? "import" : r.source_email != null ? "astra" : "manual",
      uploaded_at: r.uploaded_at, source_email: r.source_email, message_id: r.message_id, source_type: r.source_type,
      source_name: r.source_name, source_url: r.source_url, relay_thread_id: r.relay_thread_id,
      created_by: ctx.users.has(r.created_by) ? r.created_by : null, created_at: r.created_at, updated_at: r.updated_at,
    }));
    const cols = Object.keys(reqs[0] ?? {});
    const jsonb = { required_skills: "jsonb", mandatory_skills: "jsonb", preferred_skills: "jsonb", skill_weights: "jsonb" };
    for (const q of reqs) for (const k of Object.keys(jsonb)) if (q[k] != null) q[k] = JSON.stringify(q[k]);
    const res = reqs.length ? await upsert({ table: "core.requirements", cols, rows: reqs, conflict: ["id"], casts: jsonb,
      update: cols.filter((c) => !["id", "org_id", "created_by", "created_at"].includes(c)) }) : { inserted: 0, updated: 0 };
    const side = await sideTables("requirement", ok);
    return { ...res, ...side, skipped };
  }),

  step("resumes", async () => {
    // app.mirror_resume, V20260909.20 lines 82-140
    const rows = await readAll(`SELECT * FROM syntra.resumes ${sinceWhere(["created_at", "updated_at"])}`, sinceParams());
    const skipped = [];
    const ok = rows.filter((r) => {
      const porg = ctx.people.get(r.candidate_id);
      if (!porg || porg !== r.org_id) { skipped.push({ id: r.id, reason: `person ${r.candidate_id} not in core.people with org ${r.org_id} (mirror_resume rule)` }); return false; }
      return true;
    });
    const res_ = ok.map((r) => ({
      id: r.id, org_id: r.org_id, person_id: r.candidate_id, version_number: r.version_number ?? 1, is_current: r.is_current ?? true,
      summary: r.resume_summary, profile_summary: r.profile_summary, skills: r.skills, education: r.education, experience: r.experience,
      primary_role: r.primary_role, years_experience: r.years_experience, total_experience: r.total_experience, status: r.status,
      current_company: r.current_company, current_role_title: r.current_role, min_rate: r.min_rate, uploaded_at: r.uploaded_at,
      created_at: r.created_at, updated_at: r.updated_at,
    }));
    const jsonb = { skills: "jsonb", education: "jsonb", experience: "jsonb" };
    for (const q of res_) for (const k of Object.keys(jsonb)) if (q[k] != null) q[k] = JSON.stringify(q[k]);
    const cols = Object.keys(res_[0] ?? {});
    const res = res_.length ? await upsert({ table: "core.resumes", cols, rows: res_, conflict: ["id"], casts: jsonb,
      update: cols.filter((c) => !["id", "org_id", "person_id", "created_at"].includes(c)) }) : { inserted: 0, updated: 0 };
    const side = await sideTables("resume", ok);
    return { ...res, ...side, skipped };
  }),

  step("matches", async () => {
    // app.mirror_match, V20260909.15 lines 163-215. matching_started_at/failed_at/error not carried (D4).
    const rows = await readAll(`SELECT * FROM syntra.matches ${sinceWhere(["created_at", "updated_at"])}`, sinceParams());
    const skipped = [];
    const ok = rows.filter((r) => {
      const q = ctx.requirements.get(r.job_id), p = ctx.people.get(r.candidate_id), s = ctx.resumes.get(r.resume_id);
      if (q !== r.org_id || p !== r.org_id || s !== r.org_id) {
        skipped.push({ id: r.id, reason: `requirement/person/resume not all in core with org ${r.org_id} (mirror_match rule): ${q ?? "-"} / ${p ?? "-"} / ${s ?? "-"}` });
        return false;
      }
      return true;
    });
    const ms = ok.map((r) => ({
      id: r.id, org_id: r.org_id, requirement_id: r.job_id, person_id: r.candidate_id, resume_id: r.resume_id,
      status: r.match_status ?? "scored", final_decision: r.final_decision, score: r.score, llm_score: r.llm_score,
      eligibility_score: r.eligibility_score, skill_match_score: r.skill_match_score, tier: r.tier, confidence_score: r.confidence_score,
      reasoning: r.reasoning, breakdown: r.breakdown, evidence: r.evidence, strengths: r.strengths, gaps: r.gaps,
      green_flags: r.green_flags, red_flags: r.red_flags, scored_by: r.score_source ?? "syntra", model_name: r.model_name,
      prompt_version: r.prompt_version, requested_at: r.match_requested_at, matched_at: r.matched_at,
      created_at: r.created_at, updated_at: r.updated_at,
    }));
    const jsonb = { breakdown: "jsonb", evidence: "jsonb", strengths: "jsonb", gaps: "jsonb", green_flags: "jsonb", red_flags: "jsonb" };
    for (const q of ms) for (const k of Object.keys(jsonb)) if (q[k] != null) q[k] = JSON.stringify(q[k]);
    const cols = Object.keys(ms[0] ?? {});
    const res = ms.length ? await upsert({ table: "core.matches", cols, rows: ms, conflict: ["id"], casts: jsonb,
      update: cols.filter((c) => !["id", "org_id", "requirement_id", "person_id", "resume_id", "created_at"].includes(c)) }) : { inserted: 0, updated: 0 };
    return { ...res, skipped };
  }),

  step("review_queue", async () => {
    const rows = await readAll(`SELECT * FROM syntra.review_queue ${sinceWhere(["created_at"])}`, sinceParams());
    const cols = ["id", "user_id", "organization_id", "action_type", "status", "title", "message", "payload", "source_event_type", "source_event_id", "created_at", "decided_at", "decided_by", "decision_note"];
    for (const r of rows) if (r.payload != null) r.payload = JSON.stringify(r.payload);
    const res = rows.length ? await upsert({ table: "syntra.review_queue", cols, rows, conflict: ["id"], casts: { payload: "jsonb" },
      update: ["status", "decided_at", "decided_by", "decision_note", "payload"] }) : { inserted: 0, updated: 0 };
    return { ...res, skipped: [] };
  }),

  step("prism", async () => {
    const subs = await readAll(`SELECT * FROM public.prism_submissions ${sinceWhere(["created_at", "updated_at"])}`, sinceParams());
    const skipped = [];
    const ok = subs.filter((r) => {
      const porg = ctx.people.get(r.candidate_id);
      if (!porg) { skipped.push({ table: "prism.submissions", id: r.id, reason: `person ${r.candidate_id} not in core.people` }); return false; }
      if (!ctx.requirements.has(r.job_id)) { skipped.push({ table: "prism.submissions", id: r.id, reason: `requirement ${r.job_id} not in core.requirements` }); return false; }
      if (!ctx.resumes.has(r.resume_id)) { skipped.push({ table: "prism.submissions", id: r.id, reason: `resume ${r.resume_id} not in core.resumes` }); return false; }
      if (!ctx.users.has(r.created_by)) { skipped.push({ table: "prism.submissions", id: r.id, reason: `created_by ${r.created_by} not in platform.users` }); return false; }
      r.org_id = porg; r.person_id = r.candidate_id; r.requirement_id = r.job_id;
      r.match_id = ctx.matches.has(r.match_id) ? r.match_id : null;
      return true;
    });
    const jb = ["candidate_validation_results", "vendor_validation_results", "masked_profile", "interview_details", "confirmation_data"];
    for (const r of ok) for (const k of jb) if (r[k] != null) r[k] = JSON.stringify(r[k]);
    const scols = ["id", "org_id", "person_id", "resume_id", "requirement_id", "match_id", "status", "created_by", "created_at", "updated_at", ...jb,
      "rate", "rate_type", "availability", "recruiter_label", "last_consent_sent_at", "consent_resend_count"];
    const s = ok.length ? await upsert({ table: "prism.submissions", cols: scols, rows: ok, conflict: ["id"], casts: Object.fromEntries(jb.map((k) => [k, "jsonb"])),
      update: scols.filter((c) => !["id", "org_id", "person_id", "resume_id", "requirement_id", "created_by", "created_at"].includes(c)) }) : { inserted: 0, updated: 0 };
    const subOrg = new Map((await tgt.query("SELECT id, org_id FROM prism.submissions")).rows.map((r) => [r.id, r.org_id]));

    const child = async (oldTable, newTable, cols) => {
      const rows = await readAll(`SELECT * FROM public.${oldTable}`);
      const good = rows.filter((r) => {
        const org = subOrg.get(r.submission_id);
        if (!org) { skipped.push({ table: newTable, id: r.id, reason: `submission ${r.submission_id} not copied` }); return false; }
        if (!ctx.users.has(r.created_by)) { skipped.push({ table: newTable, id: r.id, reason: `created_by ${r.created_by} not in platform.users` }); return false; }
        r.org_id = org; return true;
      });
      return good.length ? upsert({ table: newTable, cols, rows: good, conflict: ["id"], update: cols.filter((c) => !["id", "org_id", "submission_id", "created_by", "created_at"].includes(c)) }) : { inserted: 0, updated: 0 };
    };
    const consents = await child("prism_consents", "prism.consents", ["id", "org_id", "submission_id", "status", "notes", "created_by", "created_at", "updated_at"]);
    const rtr = await child("prism_rtr", "prism.rtr", ["id", "org_id", "submission_id", "status", "document_url", "created_by", "created_at", "updated_at"]);
    const approvals = await child("prism_approvals", "prism.approvals", ["id", "org_id", "submission_id", "status", "notes", "created_by", "created_at", "updated_at"]);

    const audit = await readAll(`SELECT * FROM public.prism_audit ${sinceWhere(["created_at"])}`, sinceParams());
    const aok = audit.filter((r) => {
      const org = ctx.userOrg.get(r.created_by);
      if (!ctx.users.has(r.created_by) || !org) { skipped.push({ table: "prism.audit", id: r.id, reason: `created_by ${r.created_by} not in platform.users with one organisation` }); return false; }
      r.org_id = org; return true;
    });
    const a = aok.length ? await upsert({ table: "prism.audit", cols: ["id", "org_id", "entity_type", "entity_id", "previous_status", "new_status", "created_by", "created_at"], rows: aok, conflict: ["id"], update: [] }) : { inserted: 0, updated: 0 };
    return { submissions: s, consents, rtr, approvals, audit: a, skipped };
  }),

  step("relay", async () => {
    // No timestamp columns on relay.* — always read in full (~16,300 rows).
    const skipped = [];
    const threads = await readAll("SELECT * FROM relay.email_threads");
    for (const t of threads) {
      if (t.candidate_id && !ctx.people.has(t.candidate_id)) { skipped.push({ table: "relay.email_threads", id: t.thread_id, reason: `candidate ${t.candidate_id} not in core.people — reference cleared` }); t.candidate_id = null; }
      if (t.vendor_id && !ctx.vendors.has(t.vendor_id)) { skipped.push({ table: "relay.email_threads", id: t.thread_id, reason: `vendor ${t.vendor_id} not in core.vendors — reference cleared` }); t.vendor_id = null; }
      t.org_id = t.candidate_id ? ctx.people.get(t.candidate_id) : null;
      for (const k of ["workflow_context", "draft_attachments"]) if (t[k] != null) t[k] = JSON.stringify(t[k]);
    }
    const tcols = ["thread_id", "org_id", "subject", "latest_sender", "latest_sender_email", "latest_date", "reply_intent", "requires_followup", "status", "priority",
      "candidate_id", "vendor_id", "correlation_id", "workflow_context", "draft_body", "draft_subject", "draft_source", "draft_message_id", "draft_attachments"];
    const th = await upsert({ table: "relay.email_threads", cols: tcols, rows: threads, conflict: ["thread_id"], casts: { workflow_context: "jsonb", draft_attachments: "jsonb" },
      update: tcols.filter((c) => c !== "thread_id") });
    const threadOrg = new Map(threads.map((t) => [t.thread_id, t.org_id]));

    const messages = await readAll("SELECT * FROM relay.email_messages");
    for (const m of messages) { m.org_id = threadOrg.get(m.thread_id) ?? null; if (m.attachments != null) m.attachments = JSON.stringify(m.attachments); }
    const mcols = ["id", "org_id", "thread_id", "from_email", "from_name", "to_email", "subject", "raw_body", "cleaned_body", "direction", "date", "provider_message_id", "is_bounce", "html_body", "attachments"];
    const ms = await upsert({ table: "relay.email_messages", cols: mcols, rows: messages, conflict: ["id"], casts: { attachments: "jsonb" }, update: mcols.filter((c) => c !== "id") });

    const fix = (table, idCol) => (r) => {
      if (r.candidate_id && !ctx.people.has(r.candidate_id)) { skipped.push({ table, id: r[idCol], reason: `candidate ${r.candidate_id} not in core.people — reference cleared` }); r.candidate_id = null; }
      if (r.vendor_id && !ctx.vendors.has(r.vendor_id)) { skipped.push({ table, id: r[idCol], reason: `vendor ${r.vendor_id} not in core.vendors — reference cleared` }); r.vendor_id = null; }
      r.org_id = threadOrg.get(r.thread_id) ?? null;
    };
    const cls = await readAll("SELECT * FROM relay.email_classifications"); cls.forEach(fix("relay.email_classifications", "message_id"));
    const ccols = ["message_id", "org_id", "thread_id", "main_bucket", "reply_intent", "sender_type", "priority", "requires_followup", "candidate_id", "vendor_id", "classification_reason", "confidence_source"];
    const cl = await upsert({ table: "relay.email_classifications", cols: ccols, rows: cls, conflict: ["message_id"], update: ccols.filter((c) => c !== "message_id") });
    const fus = await readAll("SELECT * FROM relay.followups"); fus.forEach(fix("relay.followups", "id"));
    const fcols = ["id", "org_id", "thread_id", "message_id", "candidate_id", "vendor_id", "main_category", "reply_type", "priority", "status", "due_date", "suggested_reply", "followup_reason"];
    const fu = await upsert({ table: "relay.followups", cols: fcols, rows: fus, conflict: ["id"], update: fcols.filter((c) => c !== "id") });
    return { email_threads: th, email_messages: ms, email_classifications: cl, followups: fu, skipped };
  }),

  step("activities", async () => {
    const rows = await readAll(`SELECT * FROM public.orbit_activities ${sinceWhere(["created_at"])}`, sinceParams());
    const skipped = [];
    const ok = rows.filter((r) => {
      const org = ctx.people.get(r.candidate_id);
      if (!org) { skipped.push({ id: r.id, reason: `person ${r.candidate_id} not in core.people` }); return false; }
      r.org_id = org; r.person_id = r.candidate_id;
      if (r.payload != null) r.payload = JSON.stringify(r.payload);
      return true;
    });
    const cols = ["id", "org_id", "person_id", "activity_type", "actor_type", "actor_id", "summary", "payload", "occurred_at", "created_at"];
    const res = ok.length ? await upsert({ table: "core.activities", cols, rows: ok, conflict: ["id"], casts: { payload: "jsonb" }, update: [] }) : { inserted: 0, updated: 0 };
    return { ...res, skipped };
  }),

  step("orbit", async () => {
    // D5: only rows whose person exists in core.people.
    const skipped = [];
    const ls = await readAll("SELECT * FROM public.orbit_lifecycle_states");
    const lok = ls.filter((r) => {
      if (!ctx.people.has(r.candidate_id)) { skipped.push({ table: "orbit.lifecycle_states", id: r.id, reason: `person ${r.candidate_id} not in core.people (D5)` }); return false; }
      r.org_id = ctx.orgs.has(r.organization_id) ? r.organization_id : ctx.people.get(r.candidate_id); r.person_id = r.candidate_id;
      r.transitioned_by = ctx.users.has(r.transitioned_by) ? r.transitioned_by : null;
      if (r.context != null) r.context = JSON.stringify(r.context);
      return true;
    });
    const lcols = ["id", "org_id", "person_id", "state", "previous_state", "transitioned_at", "transitioned_by", "note", "context", "created_at"];
    const l = lok.length ? await upsert({ table: "orbit.lifecycle_states", cols: lcols, rows: lok, conflict: ["id"], casts: { context: "jsonb" }, update: [] }) : { inserted: 0, updated: 0 };

    const ps = await readAll("SELECT * FROM public.orbit_placements");
    const pok = ps.filter((r) => {
      if (!ctx.people.has(r.candidate_id)) { skipped.push({ table: "orbit.placements", id: r.id, reason: `person ${r.candidate_id} not in core.people (D5)` }); return false; }
      r.org_id = ctx.orgs.has(r.organization_id) ? r.organization_id : ctx.people.get(r.candidate_id); r.person_id = r.candidate_id;
      r.requirement_id = ctx.requirements.has(r.requirement_id) ? r.requirement_id : null;
      r.vendor_id = ctx.vendors.has(r.vendor_id) ? r.vendor_id : null;
      r.created_by = ctx.users.has(r.created_by) ? r.created_by : null;
      return true;
    });
    const pcols = ["id", "org_id", "person_id", "requirement_id", "vendor_id", "client_name", "start_date", "end_date", "confirmed_bill_rate", "confirmed_pay_rate",
      "employment_model", "work_mode", "location", "status", "notes", "package_ctc", "monthly_profit", "created_by", "created_at", "updated_at"];
    const p = pok.length ? await upsert({ table: "orbit.placements", cols: pcols, rows: pok, conflict: ["id"], update: pcols.filter((c) => !["id", "org_id", "person_id", "created_by", "created_at"].includes(c)) }) : { inserted: 0, updated: 0 };
    const placed = new Map(pok.map((r) => [r.id, r.org_id]));

    const ras = await readAll("SELECT * FROM public.orbit_revenue_arrangements");
    const rok = ras.filter((r) => {
      const org = placed.get(r.placement_id);
      if (!org) { skipped.push({ table: "orbit.revenue_arrangements", id: r.id, reason: `placement ${r.placement_id} not copied` }); return false; }
      r.org_id = org; r.created_by = ctx.users.has(r.created_by) ? r.created_by : null; return true;
    });
    const rcols = ["id", "org_id", "placement_id", "arrangement_type", "value", "calculated_hourly_amount", "calculated_monthly_amount", "calculation_note", "notes", "custom_formula", "is_current", "created_by", "created_at"];
    const ra = rok.length ? await upsert({ table: "orbit.revenue_arrangements", cols: rcols, rows: rok, conflict: ["id"], update: rcols.filter((c) => !["id", "org_id", "placement_id", "created_by", "created_at"].includes(c)) }) : { inserted: 0, updated: 0 };
    return { lifecycle_states: l, placements: p, revenue_arrangements: ra, skipped };
  }),
];

/** core.embeddings, core.processing_jobs, core.source_files for a batch of old jobs or resumes — V20260909.18/.19/.20. */
async function sideTables(subjectType, rows) {
  const status = (s) => ({ processed: "succeeded", failed: "failed", processing: "running" })[String(s ?? "").toLowerCase()] ?? "pending";
  const emb = rows.filter((r) => r.embedding != null).map((r) => ({
    org_id: r.org_id, subject_type: subjectType, subject_id: r.id, model: r.embedding_model ?? "unknown", model_version: r.embedding_version ?? "1",
    embedding: r.embedding, created_at: r.processed_at ?? new Date(),
  }));
  const e = emb.length ? await upsert({ table: "core.embeddings", cols: ["org_id", "subject_type", "subject_id", "model", "model_version", "embedding", "created_at"], rows: emb,
    conflict: ["subject_type", "subject_id", "model", "model_version"], update: ["embedding"], casts: { embedding: "vector" } }) : { inserted: 0, updated: 0 };
  const pj = rows.map((r) => ({
    org_id: r.org_id, application: "syntra", subject_type: subjectType, subject_id: r.id, stage: "extract", status: status(r.processing_status), attempt: 1,
    started_at: r.processing_started_at, finished_at: r.processed_at, error: r.processing_error, created_at: r.created_at,
  }));
  const p = await upsert({ table: "core.processing_jobs", cols: ["org_id", "application", "subject_type", "subject_id", "stage", "status", "attempt", "started_at", "finished_at", "error", "created_at"], rows: pj,
    conflict: ["subject_type", "subject_id", "stage", "attempt"], update: ["status", "started_at", "finished_at", "error"] });
  // source_files has no natural unique key; mirror_source_file inserts only when none exists for the subject.
  const have = new Set((await tgt.query("SELECT subject_id FROM core.source_files WHERE subject_type = $1", [subjectType])).rows.map((r) => r.subject_id));
  const sf = rows.filter((r) => r.file_path != null && !have.has(r.id)).map((r) => ({
    org_id: r.org_id, subject_type: subjectType, subject_id: r.id, original_file_name: r.original_file_name, file_path: r.file_path, mime_type: r.mime_type,
    raw_text: r.raw_text, content_hash: r.summary_hash, uploaded_at: r.uploaded_at ?? new Date(),
  }));
  let sfIns = 0;
  for (let i = 0; i < sf.length; i += 100) {
    const chunk = sf.slice(i, i + 100); const params = []; const cols = Object.keys(chunk[0]);
    const values = chunk.map((r) => "(" + cols.map((c) => { params.push(r[c]); return `$${params.length}`; }).join(", ") + ")");
    const { rowCount } = await tgt.query(`INSERT INTO core.source_files (${cols.join(", ")}) VALUES ${values.join(",")}`, params);
    sfIns += rowCount;
  }
  return { embeddings: e, processing_jobs: p, source_files: { inserted: sfIns, updated: 0 } };
}

// ───────────────────────────────────────────────────────────────── main ──

await src.connect();
await src.query("SET default_transaction_read_only = on");
await tgt.connect();
console.log(`\ncopy-delta ${dryRun ? "(DRY RUN — will roll back)" : "(APPLYING)"}${since ? `  since ${since}` : ""}`);
console.log(`  from ${new URL(urlFrom("old_db_repo/.env")).hostname}  (read only)`);
console.log(`  into ${new URL(urlFrom(".env")).hostname}\n`);

try {
  await tgt.query("BEGIN");
  for (const f of rehearseMigrations) await runMigrationBody(f);
  if (rehearseMigrations.length) console.log("");
  for (const s of STEPS) {
    if (only && !only.includes(s.name)) continue;
    await loadMaps();
    const t0 = Date.now();
    const out = await s.fn();
    report.steps[s.name] = { ...out, ms: Date.now() - t0 };
    const counts = typeof out.inserted === "number"
      ? `+${out.inserted}/~${out.updated}` + Object.entries(out).filter(([k, v]) => v && typeof v === "object" && "inserted" in v).map(([k, v]) => `  ${k}: +${v.inserted}/~${v.updated}`).join("")
      : Object.entries(out).filter(([k, v]) => v && typeof v === "object" && "inserted" in v).map(([k, v]) => `${k}: +${v.inserted}/~${v.updated}`).join("  ");
    console.log(`  ${s.name.padEnd(14)} ${counts}${out.skipped?.length ? `  skipped ${out.skipped.length}` : ""}`);
    if (!dryRun) { await tgt.query("COMMIT"); await tgt.query("BEGIN"); }
  }
  if (rehearseAfter.length) { console.log(""); for (const f of rehearseAfter) await runMigrationBody(f); }
  if (dryRun) { await tgt.query("ROLLBACK"); console.log("\n  rolled back — nothing changed"); }
  else { await tgt.query("COMMIT"); console.log("\n  committed"); }
} catch (e) {
  await tgt.query("ROLLBACK").catch(() => {});
  console.error(`\n  FAILED: ${e.message}`);
  report.error = e.message;
  process.exitCode = 1;
} finally {
  report.finished = new Date().toISOString();
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
  console.log(`  report: ${path.relative(root, REPORT)}`);
  await src.end(); await tgt.end();
}
