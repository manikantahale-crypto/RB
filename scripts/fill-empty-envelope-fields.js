const { Client } = require("pg");
const fs = require("fs");
const path = require("path");

function loadEnvUrl() {
  const raw = fs.readFileSync(path.join(__dirname, "../.env"), "utf8");
  const line = raw
    .split(/\r?\n/)
    .find((l) => l.startsWith("DATABASE_MIGRATOR_URL="));
  if (!line) throw new Error("DATABASE_MIGRATOR_URL missing");
  return line.slice("DATABASE_MIGRATOR_URL=".length).trim();
}

const ENVELOPE = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Syntra event envelope",
  type: "object",
  required: [
    "event_id",
    "event_type",
    "schema_version",
    "occurred_at",
    "correlation_id",
    "organization_id",
    "aggregate",
    "payload_ref",
    "producer",
  ],
  additionalProperties: false,
  properties: {
    event_id: { type: "string", format: "uuid" },
    event_type: { type: "string" },
    schema_version: { type: "string" },
    occurred_at: { type: "string", format: "date-time" },
    correlation_id: {
      type: "string",
      format: "uuid",
      description:
        "Stable across the whole causal chain from one recruiter action.",
    },
    causation_id: {
      type: ["string", "null"],
      format: "uuid",
      description:
        "event_id of the immediately preceding event. Null for chain roots.",
    },
    organization_id: { type: "string", format: "uuid" },
    aggregate: {
      type: "object",
      required: ["type", "id"],
      additionalProperties: false,
      properties: {
        type: { type: "string" },
        id: { type: "string", format: "uuid" },
      },
    },
    payload_ref: {
      type: "object",
      description:
        "Entity references and small scalars only. Never document bytes or resume text.",
    },
    producer: { type: "string" },
  },
};

/** Docs backfill only when currently null — does not overwrite good values. */
const META = {
  "astra.email.received": {
    produced_when: "Email webhook / mailbox adapter",
    primary_consumer: "astra.email.intake.workflow",
  },
  "astra.jobboard.fetch_requested": {
    produced_when: "Admin / scheduler / market adapter",
    primary_consumer: "astra.jobboard.fetch.workflow",
  },
  "astra.requirement.received": {
    produced_when: "ASTRA channel / ingest created a JD row",
    primary_consumer: "astra.requirement.workflow",
  },
  "astra.requirement.normalized": {
    produced_when: "astra.requirement.normalize completed",
    primary_consumer: "Same-graph astra.route.decision; audit",
  },
  "astra.requirement.scored": {
    produced_when: "astra.requirement.quality completed",
    primary_consumer: "Same-graph branch planner; audit",
  },
  "astra.requirement.rejected": {
    produced_when: "ASTRA route decision failed the actionable gate",
    primary_consumer: "UI notify; audit; no SYNTRA match trigger",
  },
  "syntra.jd.normalized": {
    produced_when: "ASTRA route decision passed (actionable + minConfidence)",
    primary_consumer: "SYNTRA matching-agent / syntra.jd.process",
  },
};

async function main() {
  const c = new Client({
    connectionString: loadEnvUrl(),
    ssl: { rejectUnauthorized: false },
  });
  await c.connect();

  const envRes = await c.query(
    `UPDATE event_schemas
        SET envelope_fields = $1::jsonb,
            updated_at = now()
      WHERE schema_version = '1.0'
        AND (
          envelope_fields IS NULL
          OR envelope_fields = '{}'::jsonb
          OR envelope_fields = 'null'::jsonb
        )
      RETURNING event_type`,
    [JSON.stringify(ENVELOPE)],
  );
  console.log(`envelope_fields filled: ${envRes.rowCount} row(s)`);

  for (const [eventType, meta] of Object.entries(META)) {
    const r = await c.query(
      `UPDATE event_schemas
          SET produced_when = COALESCE(produced_when, $2),
              primary_consumer = COALESCE(primary_consumer, $3),
              updated_at = now()
        WHERE event_type = $1 AND schema_version = '1.0'
        RETURNING event_type, produced_when, primary_consumer`,
      [eventType, meta.produced_when, meta.primary_consumer],
    );
    if (r.rowCount) {
      console.log(
        `meta ${eventType}: produced=${r.rows[0].produced_when ? "yes" : "no"} consumer=${r.rows[0].primary_consumer ? "yes" : "no"}`,
      );
    }
  }

  const check = await c.query(
    `SELECT event_type,
            envelope_fields <> '{}'::jsonb AS has_envelope,
            produced_when IS NOT NULL AS has_produced,
            primary_consumer IS NOT NULL AS has_consumer
       FROM event_schemas
      WHERE event_type LIKE 'astra.%'
         OR event_type = 'syntra.jd.normalized'
         OR event_type LIKE 'orbit.%'
      ORDER BY 1`,
  );
  console.table(check.rows);
  await c.end();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
