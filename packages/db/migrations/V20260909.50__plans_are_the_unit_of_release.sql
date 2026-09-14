--
-- A plan is the unit an author approves and releases.
--
-- One sentence can resolve to one changed threshold, or to two new workflows
-- plus a re-pointed trigger on a third. Releasing part of that is worse than
-- releasing none of it: there is a window where the new workflow is bound and
-- the trigger that feeds it has not moved yet, and in that window events go to
-- a workflow nobody meant to run.
--
-- `apps/admin-api/src/lib/build-plan.ts` has computed exactly this for a while
-- and its own comment says "Nothing is stored". That was right while a plan was
-- only something to look at before pressing a button. It stops being right the
-- moment a step needs somebody in another application to approve it, because
-- then the plan has to outlive the request that produced it.
--
-- WHAT THIS MAKES POSSIBLE
--
--   Atomic release      every changed and new step goes live in one
--                       transaction, or none does.
--   Cross-owner approval a step touching another application cannot be
--                       released until that application's owner approves it.
--                       The first place the entitlement model does real work
--                       rather than being a seam waiting for one.
--   Provenance          `request_text` keeps the sentence a workflow came
--                       from, which is the most useful thing to have six
--                       months later when nobody remembers why a step exists.
--
-- SAFE TO RE-RUN.
--

CREATE TABLE IF NOT EXISTS authoring.plans (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid        NOT NULL REFERENCES platform.organizations (id),

  -- The sentence the author actually typed, kept verbatim. Not a summary of
  -- it, and not the prompt that was sent: the thing a person can recognise.
  request_text text        NOT NULL,

  status       text        NOT NULL DEFAULT 'draft'
                           CHECK (status IN ('draft','pending_approval','live','abandoned')),

  created_by   uuid        REFERENCES platform.users (id),
  created_by_label text,

  requested_by uuid        REFERENCES platform.users (id),
  requested_by_label text,
  requested_at timestamptz,

  approved_by  uuid        REFERENCES platform.users (id),
  approved_by_label text,
  approved_at  timestamptz,

  released_at  timestamptz,

  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  -- THE TWO-PERSON RULE.
  --
  -- Structural, not a policy somebody remembers. A release changes what runs
  -- in production for every tenant on that workflow, and the one check worth
  -- making unrepresentable is the author quietly approving their own.
  --
  -- It compares ids, so it binds only when both sides are known users. The
  -- label columns exist for actors that are not — `admin-local`, a CI name —
  -- and the route refuses those explicitly, because a constraint that cannot
  -- see the value cannot enforce anything about it.
  CONSTRAINT plans_two_person_rule
    CHECK (approved_by IS NULL OR requested_by IS NULL OR approved_by <> requested_by),

  UNIQUE (id, org_id)
);


CREATE TABLE IF NOT EXISTS authoring.plan_steps (
  plan_id            uuid    NOT NULL REFERENCES authoring.plans (id) ON DELETE CASCADE,
  seq                integer NOT NULL,

  -- `existing` is in the plan so the chain reads as a whole; it releases
  -- nothing. `blocked` is a step the platform could not resolve, and its
  -- presence is what stops the plan being releasable at all.
  kind               text    NOT NULL
                             CHECK (kind IN ('existing','changed','new','blocked')),

  graph_id           uuid    REFERENCES authoring.graphs (id),
  target_version_id  uuid    REFERENCES authoring.graph_versions (id),

  -- The handoff INTO this step: which event carries work here from the one
  -- before. Null on the first step, which is triggered from outside the plan.
  inbound_event_type text,

  -- In words, and only when kind = 'blocked'. A reason nobody can read is a
  -- step nobody can unblock.
  blocked_reason     text,

  -- Set when the step touches an application other than the author's. Null
  -- means it is theirs and needs no second owner.
  owner_application  text    REFERENCES platform.applications (key),
  approved_by        uuid    REFERENCES platform.users (id),
  approved_by_label  text,
  approved_at        timestamptz,

  PRIMARY KEY (plan_id, seq),

  -- A blocked step has no workflow and must say why; anything else has one.
  CONSTRAINT plan_steps_blocked_is_explained
    CHECK ((kind = 'blocked') = (blocked_reason IS NOT NULL)),
  CONSTRAINT plan_steps_blocked_has_no_graph
    CHECK (kind <> 'blocked' OR graph_id IS NULL)
);

CREATE INDEX IF NOT EXISTS plan_steps_awaiting_owner_idx
  ON authoring.plan_steps (owner_application)
  WHERE owner_application IS NOT NULL AND approved_at IS NULL;


DO $$
BEGIN
  IF to_regprocedure('app.set_updated_at()') IS NOT NULL THEN
    CREATE OR REPLACE TRIGGER authoring_plans_updated_at
      BEFORE UPDATE ON authoring.plans
      FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
  END IF;
END $$;

-- Same rule as every other table in the six owned schemas: RLS on, a tenant
-- policy, and one for the migrator. See V20260909.45.
ALTER TABLE authoring.plans      ENABLE ROW LEVEL SECURITY;
ALTER TABLE authoring.plan_steps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS plans_tenant ON authoring.plans;
CREATE POLICY plans_tenant ON authoring.plans FOR ALL
  USING (org_id IS NULL OR org_id::text = nullif(current_setting('app.org_id', true), ''))
  WITH CHECK (org_id IS NULL OR org_id::text = nullif(current_setting('app.org_id', true), ''));

-- plan_steps has no org of its own: it belongs to its plan, and a step
-- readable when its plan is not would be a hole rather than a convenience.
DROP POLICY IF EXISTS plan_steps_tenant ON authoring.plan_steps;
CREATE POLICY plan_steps_tenant ON authoring.plan_steps FOR ALL
  USING (EXISTS (SELECT 1 FROM authoring.plans p WHERE p.id = plan_id))
  WITH CHECK (EXISTS (SELECT 1 FROM authoring.plans p WHERE p.id = plan_id));

DO $$
BEGIN
  BEGIN
    CREATE POLICY plans_migrator_all ON authoring.plans
      FOR ALL TO syntra_migrator USING (true) WITH CHECK (true);
    CREATE POLICY plan_steps_migrator_all ON authoring.plan_steps
      FOR ALL TO syntra_migrator USING (true) WITH CHECK (true);
  EXCEPTION
    WHEN undefined_object THEN NULL;   -- role absent in this environment
    WHEN duplicate_object THEN NULL;   -- already there
  END;
END $$;


DO $$
BEGIN
  RAISE NOTICE 'authoring.plans and plan_steps ready. % plan(s).',
    (SELECT count(*) FROM authoring.plans);
END $$;
