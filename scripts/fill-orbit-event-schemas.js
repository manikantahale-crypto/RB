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

const ORBIT = [
  {
    event_type: "orbit.lifecycle.transition_requested",
    description: "Request ORBIT lifecycle transition for a candidate.",
    produced_when: "ORBIT UI / recruiter action / API",
    primary_consumer: "orbit.lifecycle.workflow",
    payload_schema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      title: "orbit.lifecycle.transition_requested payload",
      type: "object",
      required: ["candidate_id", "to_state"],
      additionalProperties: true,
      properties: {
        candidate_id: { type: "string", format: "uuid" },
        to_state: { type: "string" },
        from_state: { type: "string" },
        note: { type: ["string", "null"] },
      },
    },
  },
  {
    event_type: "orbit.lifecycle.transitioned",
    description: "Candidate lifecycle state changed in ORBIT.",
    produced_when: "orbit.lifecycle.transition completed",
    primary_consumer: "Audit / orbit.route.decision",
    payload_schema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      title: "orbit.lifecycle.transitioned payload",
      type: "object",
      required: ["candidate_id", "to_state"],
      additionalProperties: true,
      properties: {
        candidate_id: { type: "string", format: "uuid" },
        from_state: { type: ["string", "null"] },
        to_state: { type: "string" },
        note: { type: ["string", "null"] },
      },
    },
  },
  {
    event_type: "orbit.placement.confirm_requested",
    description: "Request confirmation of a client placement.",
    produced_when: "ORBIT UI / placement API",
    primary_consumer: "orbit.placement.workflow",
    payload_schema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      title: "orbit.placement.confirm_requested payload",
      type: "object",
      required: [
        "candidate_id",
        "client_name",
        "start_date",
        "confirmed_bill_rate",
        "confirmed_pay_rate",
      ],
      additionalProperties: true,
      properties: {
        candidate_id: { type: "string", format: "uuid" },
        client_name: { type: "string" },
        start_date: { type: "string" },
        confirmed_bill_rate: { type: "number" },
        confirmed_pay_rate: { type: "number" },
        employment_model: { type: "string" },
        work_mode: { type: "string" },
      },
    },
  },
  {
    event_type: "orbit.placement.confirmed",
    description: "Client placement confirmed; candidate marked PLACED.",
    produced_when: "orbit.placement.confirm completed",
    primary_consumer: "Audit / revenue follow-up",
    payload_schema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      title: "orbit.placement.confirmed payload",
      type: "object",
      required: ["candidate_id", "placement_id"],
      additionalProperties: true,
      properties: {
        candidate_id: { type: "string", format: "uuid" },
        placement_id: { type: "string", format: "uuid" },
        client_name: { type: "string" },
      },
    },
  },
  {
    event_type: "orbit.revenue.arrange_requested",
    description: "Request revenue arrangement on a placement.",
    produced_when: "ORBIT UI / finance",
    primary_consumer: "orbit.revenue.workflow",
    payload_schema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      title: "orbit.revenue.arrange_requested payload",
      type: "object",
      required: ["placement_id", "arrangement_type", "value"],
      additionalProperties: true,
      properties: {
        placement_id: { type: "string", format: "uuid" },
        arrangement_type: { type: "string" },
        value: { type: "number" },
      },
    },
  },
  {
    event_type: "orbit.revenue.arranged",
    description: "Revenue arrangement attached to placement.",
    produced_when: "orbit.revenue.arrange completed",
    primary_consumer: "Audit",
    payload_schema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      title: "orbit.revenue.arranged payload",
      type: "object",
      required: ["placement_id"],
      additionalProperties: true,
      properties: {
        placement_id: { type: "string", format: "uuid" },
        arrangement_type: { type: "string" },
        value: { type: "number" },
      },
    },
  },
  {
    event_type: "orbit.activity.noted",
    description: "Recruiter note written on candidate timeline.",
    produced_when: "orbit.activity.note completed",
    primary_consumer: "Audit",
    payload_schema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      title: "orbit.activity.noted payload",
      type: "object",
      required: ["candidate_id", "summary"],
      additionalProperties: true,
      properties: {
        candidate_id: { type: "string", format: "uuid" },
        summary: { type: "string" },
      },
    },
  },
  {
    event_type: "orbit.bench.hold",
    description: "Candidate moved to HOLD/IGNORE — needs attention.",
    produced_when: "orbit.route.decision hold branch",
    primary_consumer: "UI / ops",
    payload_schema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      title: "orbit.bench.hold payload",
      type: "object",
      additionalProperties: true,
      properties: {
        candidate_id: { type: "string", format: "uuid" },
        to_state: { type: "string" },
        reason: { type: "string" },
      },
    },
  },
];

async function main() {
  const c = new Client({
    connectionString: loadEnvUrl(),
    ssl: { rejectUnauthorized: false },
  });
  await c.connect();

  for (const ev of ORBIT) {
    const res = await c.query(
      `UPDATE event_schemas
          SET description = $2,
              payload_schema = $3::jsonb,
              envelope_fields = $4::jsonb,
              produced_when = $5,
              primary_consumer = $6,
              status = 'ACTIVE',
              updated_at = now()
        WHERE event_type = $1 AND schema_version = '1.0'
        RETURNING event_type`,
      [
        ev.event_type,
        ev.description,
        JSON.stringify(ev.payload_schema),
        JSON.stringify(ENVELOPE),
        ev.produced_when,
        ev.primary_consumer,
      ],
    );
    console.log(
      res.rowCount ? `updated ${ev.event_type}` : `MISSING ${ev.event_type}`,
    );
  }

  const check = await c.query(
    `SELECT event_type,
            payload_schema <> '{}'::jsonb AS has_payload,
            envelope_fields <> '{}'::jsonb AS has_envelope,
            produced_when IS NOT NULL AS has_produced,
            primary_consumer IS NOT NULL AS has_consumer
       FROM event_schemas
      WHERE event_type LIKE 'orbit.%'
      ORDER BY 1`,
  );
  console.table(check.rows);
  await c.end();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
