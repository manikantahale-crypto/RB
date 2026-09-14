-- Where a node's claim on one unit of work lives.
--
-- WHY THIS TABLE EXISTS
--
-- Every node contract declares how it behaves when run twice. It is a required
-- field and the schema refuses a writing node that claims to be `pure`. Nothing
-- read it. `syntra.continuous.match` caps its retries at 1 instead of 3, which
-- is only necessary because its declared key was never enforced.
--
-- Meanwhile a step publishes when it succeeds, and a published event that is
-- bound starts another workflow. A workflow holding both `syntra.jd.process`
-- and `syntra.continuous.match` therefore searches the bench twice for one
-- requirement — once as its own next step, once in the workflow that
-- `syntra.jd.parsed` set going. Two match jobs, two sets of results, and
-- nothing in any log that says so.
--
-- WHAT IS STORED, AND WHAT DELIBERATELY IS NOT
--
-- Ids and a status. No payload, no node output, no input.
--
-- That is not frugality, it is the existing posture: `orch.steps.input` is
-- populated in 0 of 6,030 rows, and no structured node output appears in any
-- `node_executions.patch_ref`. The orchestrator does not keep node data, and
-- this must not be the thing that changes that.
--
-- It can afford not to. On a hit the step is skipped and the run continues —
-- there is no first result to hand back, because nothing consumes one. Every
-- node builds its input from the trigger payload, and no live workflow
-- declares an `inputs` map reading an earlier step's output.
--
-- THE KEY IS SCOPED TO ONE CAUSAL FLOW
--
-- `correlation_id` names one chain of work from one real cause. Scoping to it
-- collapses the duplicate, the retry and the replay — while the same
-- requirement arriving next week is a NEW flow and matches again, which is
-- right, because the bench has changed. A permanent key would silently refuse
-- legitimate re-work.
--
-- It also settles a question that would otherwise need an answer: two people
-- doing the same thing at the same time start two flows, so neither is ever
-- suppressed on account of the other.

BEGIN;

CREATE TABLE IF NOT EXISTS orch.node_idempotency (
  org_id          uuid        NOT NULL,
  node_key        text        NOT NULL,
  -- JSON array of the values at the contract's declared keyPaths. JSON rather
  -- than a joined string because a separator can appear inside a value.
  idempotency_key text        NOT NULL,
  correlation_id  uuid        NOT NULL,
  -- 'running' is a claim in hand; 'done' is work that must not be repeated.
  status          text        NOT NULL DEFAULT 'running'
                              CHECK (status IN ('running', 'done')),
  -- Which step took it, for reading a run back. Not part of the key: the same
  -- work is the same work whichever step in the flow reached it first.
  node_id         text,
  claimed_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz,
  PRIMARY KEY (org_id, node_key, idempotency_key, correlation_id)
);

--
-- For the sweep. Records are only ever hygiene: a correlation id belongs to
-- one original event, so an old row can never match a new flow. Deleting one
-- too early is the only way to do harm, which is why the sweep is by age and not
-- by "the flow looks finished" — a run parked at a human gate can sit for days
-- and then resume inside the same correlation.
--
CREATE INDEX IF NOT EXISTS node_idempotency_age_idx
  ON orch.node_idempotency (claimed_at);

COMMENT ON TABLE orch.node_idempotency IS
  'One row per (node, declared key, causal flow). Ids and status only — no '
  'node input or output is stored here. Rows are safe to delete once old; '
  'sweep on claimed_at, never on whether a flow looks finished.';

--
-- The roles that run nodes need to write here, or every claim fails closed and
-- the node runs anyway — which is safe, and silently turns the whole feature
-- off. A policy without a grant protects nothing; so does a table without one.
--
DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['${app_role}', '${migrator_role}'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format(
        'GRANT SELECT, INSERT, UPDATE, DELETE ON orch.node_idempotency TO %I', r);
    END IF;
  END LOOP;
END $$;

COMMIT;
