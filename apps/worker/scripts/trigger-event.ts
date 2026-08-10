import { PgBoss } from "pg-boss";
import { env } from "../src/env.js";
import type { EventEnvelope } from "@tekisho/domain";

const boss = new PgBoss({
  connectionString: env.DATABASE_MIGRATOR_URL,
  schema: "pgboss",
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await boss.start();
  
  const type = process.argv[2];
  let payload = {};

  if (type === 'jd.uploaded') {
    // Need a real jobId from Syntra DB to avoid failure!
    // I will fetch a real jobId in the script if needed, or pass it as an argument.
    const jobId = process.argv[3];
    if (!jobId) throw new Error("Please provide jobId as 2nd arg");
    payload = { jobId };
  } else if (type === 'resume.uploaded') {
    const resumeId = process.argv[3];
    if (!resumeId) throw new Error("Please provide resumeId as 2nd arg");
    payload = { resumeId };
  } else if (type === 'match.requested') {
    const jobId = process.argv[3];
    const resumeId = process.argv[4];
    if (!jobId || !resumeId) throw new Error("Please provide jobId and resumeId");
    payload = { jobId, resumeId };
  } else {
    throw new Error("Invalid event type. Use jd.uploaded, resume.uploaded, or match.requested");
  }

  const envelope: EventEnvelope = {
    event_id: crypto.randomUUID(),
    event_type: type as any,
    schema_version: "1.0",
    occurred_at: new Date().toISOString(),
    correlation_id: crypto.randomUUID(),
    causation_id: null,
    organization_id: "org1",
    aggregate: { type: "test", id: crypto.randomUUID() },
    payload_ref: payload,
    producer: "test-script",
  };

  const id = await boss.send("orchestration.dispatch", envelope);
  console.log(`Sent ${type} with job id ${id}`);

  await boss.stop();
}

run().catch(console.error);
