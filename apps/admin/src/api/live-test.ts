/** Screen 5 — firing a real trigger event at a workflow, and following it. */
import { request } from "../api";

export type LiveTestField = {
  name: string;
  type: string;
  format: string | null;
  enum: unknown[] | null;
  description: string | null;
  required: boolean;
  /** A starting value of the right type, so the form is not empty. */
  sample: unknown;
};

export type LiveTestPlan = {
  graphKey: string;
  version: number;
  status: string;
  /**
   * `binding` — events reach this workflow today.
   * `draft` — a trigger is chosen but nothing is bound yet, so firing it runs
   * whatever IS bound to that event, which may be a different workflow.
   * `none` — nothing to fire.
   */
  triggerSource: "binding" | "draft" | "none";
  eventType: string | null;
  /** False when the event's schema is a placeholder rather than a description. */
  payloadDeclared: boolean;
  fields: LiveTestField[];
  steps: Array<{ id: string; impl: string }>;
};

export type FireResult = {
  eventId: string;
  accepted: string;
  envelope: Record<string, unknown>;
};

/**
 * Whether a run has appeared yet.
 *
 * Firing is asynchronous — outbox, relay, router, then a run. `queued` and
 * `published` are the honest in-between states; `unknown` means the event is
 * not even in the outbox, which is a real failure rather than slowness.
 */
export type StartedState =
  | { state: "running"; runId: string; graphKey: string; status: string }
  | { state: "queued" | "published" | "unknown" };

export function loadLiveTestPlan(graphKey: string) {
  return request<LiveTestPlan>(`/live-test/${encodeURIComponent(graphKey)}`);
}

export function fireTestEvent(body: {
  eventType: string;
  organizationId: string;
  payload: Record<string, unknown>;
  aggregateType?: string;
  aggregateId?: string;
}) {
  return request<FireResult>("/live-test/fire", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function checkStarted(eventId: string) {
  return request<StartedState>(
    `/live-test/started/${encodeURIComponent(eventId)}`,
  );
}

export type Organisation = { id: string; name: string };

/** The organisations a run can belong to — a required field on every fire. */
export function loadOrganisations() {
  return request<{ organisations: Organisation[] }>("/live-test/organisations");
}

export type RecentEvent = {
  eventId: string;
  organisationId: string;
  aggregateType: string;
  aggregateId: string;
  producer: string;
  occurredAt: string;
  payload: Record<string, unknown>;
};

/**
 * Real events of this type that already happened, newest first.
 *
 * Replaying one beats filling in a generated form: the sample for a string
 * field is `""` and the sample for every uuid is the same constant, so a
 * hand-filled event is both more work and less realistic than one production
 * actually produced.
 */
export function loadRecentEvents(eventType: string) {
  return request<{ eventType: string; recent: RecentEvent[] }>(
    `/live-test/recent/${encodeURIComponent(eventType)}`,
  );
}
