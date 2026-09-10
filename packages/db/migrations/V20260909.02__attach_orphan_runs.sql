--
-- Attach the runs that point at an organisation which does not exist.
--
-- WHY
--
-- 29 rows in orch.runs carry an organization_id that is in no row of
-- public.organizations — 29 distinct ids, one run each. All of them are
-- graph_key 'test-graph', all still status RUNNING, all created on 2026-09-01
-- in a single session. Something generated a fresh uuid per run instead of
-- naming a tenant.
--
-- They matter because step 3 of the schema migration puts composite foreign
-- keys on org ownership. Those keys refuse exactly these rows, and a migration
-- that fails halfway through on live data is the thing this whole sequence
-- exists to avoid. Better to find them now, when the fix is one statement.
--
-- WHY REASSIGN RATHER THAN DELETE
--
-- Deleting live rows needs a stronger reason than "they are untidy". These are
-- test rows and could be dropped when the system is taken to production, but
-- that is a decision to make deliberately later, not a side effect of a
-- migration. Reassigning is reversible in the sense that matters: nothing is
-- lost.
--
-- The target is the organisation that owns everything else — 48 of 52 users,
-- 9,909 of 9,965 runs, 2,799 of 2,946 jobs. It is named "Test Org", which is
-- accurate today; renaming it belongs with the production cutover, not here.
--
-- SAFE TO RE-RUN. The WHERE clause matches nothing once it has run, and
-- nothing on a freshly built database, where orch.runs is empty.
--

UPDATE orch.runs r
   SET organization_id = '2b8e12b3-1745-4ae9-902c-5a249c28ba94'
 WHERE r.organization_id IS NOT NULL
   AND NOT EXISTS (
         SELECT 1 FROM public.organizations o WHERE o.id = r.organization_id
       );

-- Prove it, in the same transaction as the fix. If the count is not zero the
-- migration fails and rolls back, rather than reporting success on a database
-- the foreign keys will later refuse.
DO $$
DECLARE remaining int;
BEGIN
  SELECT count(*) INTO remaining
    FROM orch.runs r
   WHERE r.organization_id IS NOT NULL
     AND NOT EXISTS (
           SELECT 1 FROM public.organizations o WHERE o.id = r.organization_id
         );

  IF remaining > 0 THEN
    RAISE EXCEPTION
      'orch.runs still has % rows pointing at an unknown organisation', remaining;
  END IF;
END $$;
