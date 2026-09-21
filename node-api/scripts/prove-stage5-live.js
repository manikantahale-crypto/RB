/**
 * Stage 5, proven against the live database — scratch and clean.
 *
 *   node node-api/scripts/prove-stage5-live.js [--keep]
 *
 * Two things no unit test can say, because they are about what the
 * database does when the real handlers run (ref/Orchestrator_Refinements.md
 * §11–§12, "unverified"):
 *
 *   1. ASTRA — `POST /internal/astra/requirements/ingest` with a
 *      correlation_id writes EXACTLY ONE `astra.requirement.received` to
 *      orch.event_outbox, carrying that id (the service owns the emit; the
 *      node no longer announces).
 *   2. PRISM — the three endpoints added for the orchestrator work against
 *      real rows: open a submission for a real candidate/requirement pair
 *      → record a consent YES → mask → move it (WITHDRAWN) — every move
 *      through PRISM's own matrix and audit.
 *
 * HOW IT RUNS. node-api's express app is loaded IN THIS PROCESS on an
 * ephemeral port and called over HTTP, exactly as the worker calls it. No
 * pg-boss, no workers, no dev server needed.
 *
 * WHAT IT MUST NOT DO. Send mail. PRISM's consent handler used to auto-chain
 * a YES into a vendor email (guessing the vendor when the JD named none);
 * since D-A (2026-09-21) the INBOUND path records, masks and stops, and a
 * vendor is never guessed. Both are asserted below by watching the log:
 * no vendor resolution, no RELAY call. RELAY is still pointed at a dead
 * port before the app loads — a proof stays safe by construction, not by
 * trusting the code it is proving.
 *
 * Scratch rows are named "SCRATCH stage-5 proof" and deleted at the end
 * unless --keep. The candidate and requirement used are REAL and are not
 * touched beyond the submission rows that reference them.
 */
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });

// Before anything of node-api loads: no mail can leave this process.
process.env.RELAY_INTERNAL_URL = "http://127.0.0.1:9";
process.env.RELAY_SERVICE_URL = "http://127.0.0.1:9";
process.env.RELAY_API_URL = "http://127.0.0.1:9";
process.env.LOG_LEVEL = process.env.LOG_LEVEL || "warn";

const crypto = require("crypto");
const { pool } = require("../src/config/db");
const log = require("../src/utils/logger");

// Every line node-api logs during the run, so a proof can assert on what the
// code DID (resolved a vendor, called RELAY) and not only on what it stored.
const logged = [];
for (const level of ["info", "warn", "error"]) {
  const orig = log[level].bind(log);
  log[level] = (...args) => { logged.push(args.map(String).join(" ")); return orig(...args); };
}

const KEEP = process.argv.includes("--keep");
const TAG = "SCRATCH stage-5 proof";
const results = [];
function ok(name, pass, detail) {
  results.push({ check: name, result: pass ? "PASS" : "FAIL", detail });
  if (!pass) throw new Error(`${name}: ${detail}`);
}

async function withApp(fn) {
  const app = require("../src/app");
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (p, body) => {
    const res = await fetch(base + p, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = { raw: text }; }
    return { status: res.status, json };
  };
  try {
    return await fn(post);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

async function proveAstra(post, cleanup) {
  const correlationId = crypto.randomUUID();
  // The run's organisation — what the node sends as ctx.orgId. Any real one.
  const { rows: orgs } = await pool.query(`SELECT org_id FROM core.requirements WHERE org_id IS NOT NULL GROUP BY org_id ORDER BY count(*) DESC LIMIT 1`);
  ok("astra: an organisation exists to act for", orgs.length === 1, "no org_id on any requirement");
  const organizationId = orgs[0].org_id;
  const r = await post("/internal/astra/requirements/ingest", {
    organization_id: organizationId,
    title: TAG,
    raw_text: "SCRATCH. Java developer, Spring Boot, AWS. Austin TX. Delete me.",
    channel_type: "API",
    source: "prove-stage5-live",
    correlation_id: correlationId,
  });
  ok("astra: ingest answers 201 with the id and the flow's correlation", r.status === 201 && r.json.jobId && r.json.correlation_id === correlationId,
    `status=${r.status} body=${JSON.stringify(r.json)}`);
  const jobId = r.json.jobId;
  cleanup.push(async () => {
    await pool.query(`DELETE FROM orch.run_failures WHERE trigger_event_id::text = $1`, [String(r.json.event_id)]).catch(() => {});
    await pool.query(`DELETE FROM orch.event_outbox WHERE aggregate_id = $1`, [jobId]);
    await pool.query(`DELETE FROM core.source_files WHERE subject_id = $1`, [jobId]).catch(() => {});
    await pool.query(`DELETE FROM core.processing_jobs WHERE requirement_id = $1`, [jobId]).catch(() => {});
    await pool.query(`DELETE FROM core.embeddings WHERE subject_id = $1`, [jobId]).catch(() => {});
    await pool.query(`DELETE FROM core.requirements WHERE id = $1`, [jobId]);
  });

  const { rows: req } = await pool.query(`SELECT org_id, created_by FROM core.requirements WHERE id = $1`, [jobId]);
  ok("astra: the row belongs to the run's organisation, with no created_by", req[0]?.org_id === organizationId && req[0]?.created_by === null, JSON.stringify(req[0]));
  const { rows } = await pool.query(
    `SELECT event_id, event_type, correlation_id, organization_id, producer
       FROM orch.event_outbox
      WHERE aggregate_id = $1`,
    [jobId],
  );
  ok("astra: exactly one outbox row for the requirement", rows.length === 1, `${rows.length} rows: ${JSON.stringify(rows)}`);
  ok("astra: it is astra.requirement.received from astra-intake", rows[0].event_type === "astra.requirement.received" && rows[0].producer === "astra-intake",
    JSON.stringify(rows[0]));
  ok("astra: it carries the flow's correlation id and the organisation", rows[0].correlation_id === correlationId && rows[0].organization_id === organizationId,
    `${rows[0].correlation_id} vs ${correlationId}; org ${rows[0].organization_id}`);
  return { jobId, correlationId };
}

async function findPair() {
  // A real recruiter's real candidate (with a current resume that has text,
  // not Staging) and a real requirement of the same recruiter, with no
  // active submission between them yet. Prefer a requirement with no vendor,
  // so the consent auto-chain has less to resolve.
  const { rows } = await pool.query(`
    SELECT r.id AS job_id, r.title, p.id AS candidate_id, p.full_name, r.created_by,
           r.vendor_id IS NULL AS no_vendor
      FROM core.requirements r
      JOIN core.people p ON p.created_by = r.created_by
      JOIN core.resumes res ON res.person_id = p.id AND res.is_current = true
     WHERE r.created_by IS NOT NULL
       AND COALESCE(p.status, '') <> 'Staging'
       AND p.full_name IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM prism.submissions s
          WHERE s.person_id = p.id AND s.requirement_id = r.id
            AND s.status NOT IN ('WITHDRAWN','REJECTED'))
     ORDER BY (r.vendor_id IS NULL) DESC, r.created_at DESC
     LIMIT 1`);
  return rows[0] || null;
}

async function provePrism(post, cleanup) {
  const pair = await findPair();
  ok("prism: a real candidate/requirement pair with one owner exists", Boolean(pair), "none found");
  const { job_id: jobId, candidate_id: candidateId } = pair;
  console.log(`   pair: candidate ${candidateId} (${pair.full_name}) × requirement ${jobId} ("${pair.title}") owner ${pair.created_by} vendor=${pair.no_vendor ? "none" : "set"}`);

  const opened = await post("/internal/prism/submissions", { candidateId, jobId });
  ok("prism: open answers 201 created as the requirement's owner",
    opened.status === 201 && opened.json.status === "created" && opened.json.submission?.status === "DRAFT" && opened.json.actor_source === "requirement_owner",
    `status=${opened.status} body=${JSON.stringify(opened.json)}`);
  const submissionId = opened.json.submission.id;
  cleanup.push(async () => {
    await pool.query(`DELETE FROM prism.audit WHERE entity_id = $1`, [submissionId]);
    await pool.query(`DELETE FROM prism.consents WHERE submission_id = $1`, [submissionId]);
    await pool.query(`DELETE FROM prism.rtr WHERE submission_id = $1`, [submissionId]).catch(() => {});
    await pool.query(`DELETE FROM prism.approvals WHERE submission_id = $1`, [submissionId]).catch(() => {});
    await pool.query(`DELETE FROM prism.submissions WHERE id = $1`, [submissionId]);
  });

  const again = await post("/internal/prism/submissions", { candidateId, jobId });
  ok("prism: opening the same pair again answers exists, not a second row",
    again.status === 200 && again.json.status === "exists" && again.json.submission?.id === submissionId,
    `status=${again.status} body=${JSON.stringify(again.json)}`);

  const consent = await post("/internal/prism/consent/response", { submissionId, candidateId, jobId, response: "ACCEPTED", notes: TAG });
  ok("prism: a YES is recorded and validates the candidate",
    consent.status === 200 && consent.json.status === "success" && ["CANDIDATE_VALIDATED", "MASKED"].includes(consent.json.newStatus),
    `status=${consent.status} body=${JSON.stringify(consent.json)}`);

  const { rows: afterConsent } = await pool.query(`SELECT status, masked_profile IS NOT NULL AS masked FROM prism.submissions WHERE id = $1`, [submissionId]);
  ok("prism: an inbound YES records and masks, and stops there (D-A)",
    afterConsent[0].status === "MASKED" && afterConsent[0].masked === true, `status=${afterConsent[0].status} masked=${afterConsent[0].masked}`);
  const resolved = logged.filter((l) => l.includes("[resolveVendorForJob]"));
  const relayCalls = logged.filter((l) => /Relay Adapter|\/internal\/profile\/send/.test(l));
  ok("prism: no vendor was resolved and RELAY was never called", resolved.length === 0 && relayCalls.length === 0,
    `vendor lines: ${resolved.length}, relay lines: ${relayCalls.length}`);
  ok("prism: the handler said the send waits for a person", logged.some((l) => l.includes("waits for a person")), "no such log line");
  console.log(`   after consent: status=${afterConsent[0].status} masked=${afterConsent[0].masked}`);

  const mask = await post(`/internal/prism/submissions/${submissionId}/mask`, {});
  ok("prism: mask answers with a masked profile (fresh or already there)",
    mask.status === 200 && ["success", "already_processed"].includes(mask.json.status) && mask.json.maskedProfile && typeof mask.json.maskedProfile === "object",
    `status=${mask.status} body=${JSON.stringify(mask.json).slice(0, 300)}`);
  const mp = mask.json.maskedProfile;
  // Masking is about VALUES: PRISM writes "[PROTECTED]" under email and
  // phone on purpose. What must never be there is the person's real name,
  // email or phone.
  const { rows: who } = await pool.query(`SELECT full_name, email::text AS email, phone::text AS phone FROM core.people WHERE id = $1`, [candidateId]);
  const text = JSON.stringify(mp).toLowerCase();
  const leaks = ["full_name", "email", "phone"].filter((k) => who[0]?.[k] && String(who[0][k]).trim().length > 3 && text.includes(String(who[0][k]).toLowerCase()));
  ok("prism: the masked profile carries neither the name, the email nor the phone", leaks.length === 0, `real ${leaks.join(",")} found in the masked profile`);
  ok("prism: the masked profile has the reference, role and protected placeholders", /^CAN-/.test(String(mp.maskedCandidateId)) && mp.email === "[PROTECTED / VIA RECRUITER]" && mp.phone === "[PROTECTED]",
    JSON.stringify({ id: mp.maskedCandidateId, email: mp.email, phone: mp.phone }));
  console.log(`   masked profile keys: ${Object.keys(mp).join(", ")}`);

  const moved = await post(`/internal/prism/submissions/${submissionId}/transition`, { targetStatus: "WITHDRAWN", metadata: {} });
  ok("prism: transition moves MASKED → WITHDRAWN through the matrix, sent=false",
    moved.status === 200 && moved.json.status === "success" && moved.json.newStatus === "WITHDRAWN" && moved.json.sent === false,
    `status=${moved.status} body=${JSON.stringify(moved.json)}`);

  const refused = await post(`/internal/prism/submissions/${submissionId}/transition`, { targetStatus: "MASKED" });
  ok("prism: a move the matrix refuses is a 400 with PRISM's reason",
    refused.status === 400 && /cannot transition|terminal/i.test(JSON.stringify(refused.json)),
    `status=${refused.status} body=${JSON.stringify(refused.json)}`);

  const { rows: audit } = await pool.query(
    `SELECT previous_status, new_status FROM prism.audit WHERE entity_id = $1 ORDER BY created_at`, [submissionId]);
  ok("prism: every move is on the audit trail", audit.length >= 3, JSON.stringify(audit));
  console.log(`   audit: ${audit.map((a) => `${a.previous_status ?? "∅"}→${a.new_status}`).join("  ")}`);
  return { submissionId };
}

(async () => {
  const cleanup = [];
  let failed = null;
  try {
    await withApp(async (post) => {
      console.log("\n[1] ASTRA — the service announces once, with the flow's id");
      await proveAstra(post, cleanup);
      console.log("\n[2] PRISM — open → consent yes → mask → withdraw, on real rows");
      await provePrism(post, cleanup);
    });
  } catch (err) {
    failed = err;
  } finally {
    if (KEEP) {
      console.log("\n--keep: scratch rows left in place");
    } else {
      for (const step of cleanup.reverse()) {
        try { await step(); } catch (e) { console.error(`cleanup: ${e.message}`); }
      }
      console.log("\nscratch rows removed");
    }
    console.log("");
    console.table(results);
    await pool.end().catch(() => {});
    if (failed) {
      console.error(`\nFAILED: ${failed.message}`);
      process.exit(1);
    }
  }
})();
