/**
 * The statuses a run can be in, named once.
 *
 * The runner used to write WAITING_APPROVAL to the database and answer
 * PARKED to its caller for the same run at the same moment, and every reader
 * learnt both. V20260909.72 made PARKED the one word and put a CHECK on the
 * column; this is the list that CHECK names, and the one place the code
 * says it.
 *
 * `isParked` still accepts the old word on READ: a row from before the
 * migration, a screenshot, a log line. Nothing here writes it.
 */

export const RUN_STATUSES = [
  'QUEUED',
  'RUNNING',
  /** Stopped at a human gate, waiting for a decision. Resumed by thread. */
  'PARKED',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'EXPIRED',
] as const;

export type RunStatus = (typeof RUN_STATUSES)[number];

export const PARKED = 'PARKED' as const;

/** What the runner wrote before V20260909.72. Read, never written. */
export const LEGACY_PARKED = 'WAITING_APPROVAL';

export function isParked(status: string | null | undefined): boolean {
  return status === PARKED || status === LEGACY_PARKED;
}

/** The status as the code names it now; the legacy word becomes PARKED. */
export function normalizeRunStatus(status: string | null | undefined): string | null {
  if (status == null) return null;
  return status === LEGACY_PARKED ? PARKED : status;
}

export function isRunStatus(value: unknown): value is RunStatus {
  return typeof value === 'string' && (RUN_STATUSES as readonly string[]).includes(value);
}
