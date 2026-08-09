import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const rootEnvPath = fileURLToPath(
  new URL("../../../.env", import.meta.url),
);

dotenv.config({
  path: rootEnvPath,
});

const EnvironmentSchema = z.object({
  DATABASE_MIGRATOR_URL: z
    .string()
    .min(1, "DATABASE_MIGRATOR_URL is required")
    .refine(
      (value) => value.startsWith("postgresql://"),
      "DATABASE_MIGRATOR_URL must start with postgresql://",
    ),
  // Prefer this for outbox relay (RLS policies target syntra_relay).
  // If unset, relay falls back to DATABASE_MIGRATOR_URL (needs UPDATE on
  // event_outbox — see packages/db/scripts/fix-event-outbox-migrator-bridge.sql).
  DATABASE_RELAY_URL: z
    .string()
    .refine(
      (value) => value === "" || value.startsWith("postgresql://"),
      "DATABASE_RELAY_URL must start with postgresql://",
    )
    .optional()
    .default(""),
});

export const env = EnvironmentSchema.parse(
  process.env,
);