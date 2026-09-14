--
-- Two columns in authoring.node_registry hold JSON and were typed text.
--
-- `execution` and `idempotency` are jsonb in public.node_registry, the table
-- this one replaced. V20260909.10 declared them `text` -- every other JSON
-- column on the table got jsonb, so this was a slip rather than a decision.
--
-- Postgres accepted it happily: the generator writes JSON.stringify(...) and
-- text takes a string without complaint. The value comes back out as a STRING
-- rather than an object, so in the admin editor
--
--   selectedContract.execution.retry.limit
--
-- read `.retry` off a string, got undefined, and threw
-- "Cannot read properties of undefined (reading 'limit')". The whole editor
-- died behind its error boundary the moment anybody selected a node.
--
-- That is what a text column holding JSON costs: no error at the write, an
-- error a long way from it, and nothing in between pointing back.
--
-- The USING clause parses what is already stored. Every current value is a
-- JSON object serialised by the generator, so the cast is exact -- and a value
-- that is not valid JSON would fail the migration here rather than reaching a
-- screen.
--
-- SAFE TO RE-RUN.
--

DO $$
BEGIN
  IF (SELECT format_type(a.atttypid, a.atttypmod)
        FROM pg_attribute a
       WHERE a.attrelid = 'authoring.node_registry'::regclass
         AND a.attname = 'execution') = 'text' THEN
    ALTER TABLE authoring.node_registry
      ALTER COLUMN execution TYPE jsonb USING nullif(execution, '')::jsonb;
    RAISE NOTICE 'authoring.node_registry.execution is jsonb';
  END IF;

  IF (SELECT format_type(a.atttypid, a.atttypmod)
        FROM pg_attribute a
       WHERE a.attrelid = 'authoring.node_registry'::regclass
         AND a.attname = 'idempotency') = 'text' THEN
    ALTER TABLE authoring.node_registry
      ALTER COLUMN idempotency TYPE jsonb USING nullif(idempotency, '')::jsonb;
    RAISE NOTICE 'authoring.node_registry.idempotency is jsonb';
  END IF;
END $$;


DO $$
DECLARE
  wrong int;
BEGIN
  -- Every JSON-bearing column on this table, typed as JSON. If a future column
  -- is added as text this reports it here instead of in a browser.
  SELECT count(*) INTO wrong
    FROM pg_attribute a
   WHERE a.attrelid = 'authoring.node_registry'::regclass
     AND a.attname IN ('tags','input_schema','output_schema','config_schema',
                       'admin_exposed','idempotency','execution','llm',
                       'dependencies','persistence','fixture_names','emits')
     AND format_type(a.atttypid, a.atttypmod) <> 'jsonb';

  IF wrong > 0 THEN
    RAISE EXCEPTION '% JSON column(s) on authoring.node_registry are not jsonb.', wrong;
  END IF;

  RAISE NOTICE 'every JSON column on authoring.node_registry is jsonb.';
END $$;
