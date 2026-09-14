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
  /**
   * The workflow's first step reads this field.
   *
   * `syntra.jd.normalized` declares ten; a flow starting at
   * `syntra.jd.process` uses two of them. The rest are the event's business,
   * not this author's, and belong out of the way rather than in the form.
   */
  usedByWorkflow: boolean;
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
  /**
   * A real recent payload for this event, and the organisation it belonged to.
   *
   * The form starts from this rather than from `sample`, which returns
   * `00000000-…-000000000000` for every uuid — a value of the right shape that
   * matches no row, so an untouched form looked answered and failed.
   */
  seed: {
    payload: Record<string, unknown>;
    organisationId: string | null;
    occurredAt: string;
  } | null;
  /** What this event is about — `requirement`, `candidate`, `resume`. */
  aggregateType: string | null;
  /** Payload fields that name the subject, filled in when one is picked. */
  identifierFields: string[];
};

export type TestSubject = { id: string; label: string; detail: string };

/**
 * Real rows of the kind this event is about, by name.
 *
 * The form asked for a uuid. Nobody knows a requirement by
 * `10a47180-080c-415f-8e90-8cf587108416`, so the only ways to answer were to
 * look one up somewhere else or to keep whatever a replayed event happened to
 * carry — which is how a test runs against something nobody chose.
 */
export function loadSubjects(aggregateType: string, organisationId?: string) {
  const qs = organisationId
    ? `?organisationId=${encodeURIComponent(organisationId)}`
    : "";
  return request<{
    aggregateType: string;
    supported: boolean;
    subjects: TestSubject[];
  }>(`/live-test/subjects/${encodeURIComponent(aggregateType)}${qs}`);
}

export type FireResult = {
  eventId: string;
  accepted: string;
  envelope: Record<string, unknown>;
  /**
   * The version this run will actually use.
   *
   * Null means it was not pinned, and the router will answer with whatever is
   * bound — which is the live version, not what is on screen. The difference
   * is the whole reason this field exists, so the screen says which happened
   * rather than leaving "Test" to imply the flattering one.
   */
  ranVersion: number | null;
  pinned: boolean;
  pinNote: string | null;
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
  /** Which workflow is being tested, so the run can be pinned to its version. */
  graphKey?: string;
  /** What the event is about — the subject picked on screen. */
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
