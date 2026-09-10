--
-- Step 2b: the `core` layer, created empty.
--
-- These are the business entities that were scattered across applications —
-- people, requirements, resumes, matches. They live in `syntra` today because
-- SYNTRA built them first, not because they are SYNTRA's: ORBIT needs
-- immigration status to place somebody, TEMPO needs contact details to
-- schedule, and every application needs to agree on who a person is.
--
-- PURELY ADDITIVE. Every table here is empty and nothing reads it. The rows
-- move in step 4, behind compatibility views, so no application changes on the
-- day this lands.
--
-- ══════════════════════════════════════════════════════════════════════════
-- WHY THE KEYS LOOK ODD: UNIQUE (id, org_id)
--
-- `id` is already the primary key, so a unique constraint on (id, org_id) adds
-- nothing on its own. It exists so that OTHER tables can point at it with a
-- composite foreign key, and that is what makes a cross-tenant row impossible
-- to write:
--
--   core.matches.org_id ─┬─> core.requirements (id, org_id)
--                        └─> core.people       (id, org_id)
--
-- A match carries one org_id. It must equal the requirement's AND the person's.
-- So a match between one customer's requirement and another customer's
-- candidate cannot be inserted — not "is rejected by application code", cannot
-- be represented.
--
-- THIS IS NOT THEORETICAL HERE. 263 of the 5,384 matches in this database
-- today join a job and a candidate belonging to different organisations, in
-- both directions, created between 2026-08-31 and 2026-09-07.
--
-- WHY THOSE ROWS EXIST — CORRECTED
--
-- The first reading of this was that the matching engine had no tenant filter.
-- That is wrong, and the code says so: every path that inserts a match joins
-- `c.created_by = j.created_by`, and the HTTP route that creates one directly
-- is behind requireAuth, which sets req.userId.
--
-- What actually happened is that 33 user rows had their organization_id
-- rewritten in a single bulk update on 2026-09-03 10:20:44, across two
-- organisations. Eight candidates exist whose created_at precedes their
-- creator's user row, so user rows were reassigned or recreated too.
--
-- So these matches were consistent when they were written — same creator on
-- both sides — and became cross-tenant retroactively when the mapping beneath
-- them changed.
--
-- WHAT IS STILL WRONG, AND WHY THESE KEYS STILL MATTER
--
-- Isolation is by USER, not by ORGANISATION. Two recruiters at one agency
-- cannot see each other's candidates, and a person moving between agencies
-- silently reclassifies everything they ever touched. The composite keys below
-- would have refused the reorganisation at the moment it happened, instead of
-- leaving 263 rows to be found eleven days later.
--
-- Step 4 will report those 263 rather than migrate them. That is the schema
-- telling the truth about data that was never valid.
-- ══════════════════════════════════════════════════════════════════════════
--
-- SAFE TO RE-RUN. Everything is IF NOT EXISTS; the seed is ON CONFLICT DO NOTHING.
--

CREATE SCHEMA IF NOT EXISTS core;


-- ═══════════════════════════════════════════ platform.applications first ══
--
-- `core.processing_jobs` names the application that ran a stage, and that name
-- has to mean something. This is also the table that eventually replaces the
-- hardcoded MODULES list in packages/node-contract — a new application becomes
-- a row rather than a release.
CREATE TABLE IF NOT EXISTS platform.applications (
  key        text PRIMARY KEY,
  name       text NOT NULL,
  status     text NOT NULL DEFAULT 'planned'
             CHECK (status IN ('planned','alpha','beta','available','retired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Status reflects what is actually true in THIS database, not a roadmap.
--
--   available  code in this repository, running, with data
--   beta       data in this database, code owned elsewhere
--   planned    named in the design and nothing else
--
-- `platform` is not a product. It is here because node contracts owned by the
-- platform rather than by any application declare `module: 'platform'`, and
-- the eventual foreign key from the node registry has to resolve.
INSERT INTO platform.applications (key, name, status) VALUES
  ('syntra',    'Candidates and matching',            'available'),
  ('astra',     'Requirements and intake',            'available'),
  ('orbit',     'Bench lifecycle and placements',     'available'),
  ('relay',     'Email and outreach',                 'beta'),
  ('interview', 'Interview question bank',            'beta'),
  ('platform',  'Platform-owned steps',               'available'),
  ('flux',      'Flux',                               'planned'),
  ('prism',     'Consent and right to represent',     'planned'),
  ('talyn',     'Candidate pipeline',                 'planned'),
  ('tempo',     'Scheduling',                         'planned'),
  ('helix',     'Helix',                              'planned'),
  ('ignite',    'Ignite',                             'planned'),
  ('chrona',    'Timesheets',                         'planned'),
  ('vector',    'Vector',                             'planned')
ON CONFLICT (key) DO NOTHING;


-- ════════════════════════════════════════════════════════════════ people ══
--
-- The idea `public.parties` was reaching for. That table exists today with
-- seven foreign keys pointing at it and zero rows, because nothing owned it
-- and nothing enforced it, so each application built its own instead. This
-- attempt differs only if `core` has an owner and a migration process.
CREATE TABLE IF NOT EXISTS core.people (
  id                 uuid        PRIMARY KEY,
  org_id             uuid        NOT NULL REFERENCES platform.organizations (id),
  full_name          text        NOT NULL,
  email              citext,
  phone              text,
  linkedin           text,
  github             text,
  location           text,
  immigration_status text,
  availability       text,
  current_title      text,
  status             text        NOT NULL DEFAULT 'active',
  created_by         uuid        REFERENCES platform.users (id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz,
  UNIQUE (id, org_id)
);

-- Deduplication is per tenant: two customers may each know the same person,
-- and that is two rows, because they hold them under different consent.
CREATE UNIQUE INDEX IF NOT EXISTS people_org_email_idx
  ON core.people (org_id, lower(email::text))
  WHERE email IS NOT NULL AND deleted_at IS NULL;


-- ══════════════════════════════════════════════════════════ requirements ══
CREATE TABLE IF NOT EXISTS core.requirements (
  id               uuid        PRIMARY KEY,
  org_id           uuid        NOT NULL REFERENCES platform.organizations (id),
  title            text,
  company_name     text,
  vendor_id        uuid,
  summary          text,
  primary_role     text,
  required_skills  jsonb,
  skill_weights    jsonb,
  min_experience   integer,
  max_experience   integer,
  visa_requirement text,
  employment_type  text,
  location         text,
  remote_policy    text,
  status           text        NOT NULL DEFAULT 'open',
  -- Where it came from, so ASTRA's intake and a manual upload are
  -- distinguishable without a second table.
  origin           text        NOT NULL DEFAULT 'manual'
                               CHECK (origin IN ('manual','astra','api','import')),
  origin_ref       uuid,       -- soft reference into astra's intake, deliberately not a FK
  created_by       uuid        REFERENCES platform.users (id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, org_id)
);


-- ═══════════════════════════════════════════════════════════════ resumes ══
--
-- Versioned rather than overwritten: a resume is a document a person had at a
-- point in time, and a match scored against version 2 must still make sense
-- after version 3 arrives.
CREATE TABLE IF NOT EXISTS core.resumes (
  id               uuid        PRIMARY KEY,
  org_id           uuid        NOT NULL REFERENCES platform.organizations (id),
  person_id        uuid        NOT NULL,
  version_number   integer     NOT NULL DEFAULT 1,
  is_current       boolean     NOT NULL DEFAULT true,
  summary          text,
  profile_summary  text,
  skills           jsonb,
  education        jsonb,
  experience       jsonb,
  primary_role     text,
  years_experience integer,
  current_company  text,
  -- Named current_role in the design document, which Postgres rejects:
  -- CURRENT_ROLE is a reserved keyword. Quoting it would work and would
  -- make every query that touches it quote it forever, so it is renamed
  -- here instead. This is the only deviation from the design's column
  -- names.
  current_role_title text,
  min_rate         text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, org_id),
  UNIQUE (org_id, person_id, version_number),
  FOREIGN KEY (person_id, org_id) REFERENCES core.people (id, org_id)
);

-- One current resume per person, enforced rather than assumed.
CREATE UNIQUE INDEX IF NOT EXISTS resumes_one_current_idx
  ON core.resumes (person_id) WHERE is_current;


-- ═══════════════════════════════════════════════════════════════ matches ══
--
-- Written by SYNTRA today, but a core entity: ORBIT decides what to submit
-- from it and PRISM records approvals against it. `scored_by` exists so a
-- second scoring application can coexist with SYNTRA rather than replace it.
--
-- The three composite foreign keys are the tenant boundary. See the header.
CREATE TABLE IF NOT EXISTS core.matches (
  id                uuid        PRIMARY KEY,
  org_id            uuid        NOT NULL REFERENCES platform.organizations (id),
  requirement_id    uuid        NOT NULL,
  person_id         uuid        NOT NULL,
  resume_id         uuid        NOT NULL,
  status            text        NOT NULL DEFAULT 'scored',
  final_decision    text,
  score             numeric,
  eligibility_score numeric,
  skill_match_score numeric,
  tier              text,
  confidence_score  integer,
  reasoning         text,
  breakdown         jsonb,
  evidence          jsonb,
  strengths         jsonb,
  gaps              jsonb,
  green_flags       jsonb,
  red_flags         jsonb,
  scored_by         text,       -- which application produced it
  model_name        text,
  prompt_version    text,
  requested_at      timestamptz,
  matched_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, org_id),
  -- One score per requirement/resume pair. True of all 5,384 live rows: every
  -- (job_id, resume_id) pair is distinct, so this constrains rather than hopes.
  UNIQUE (org_id, requirement_id, resume_id),
  FOREIGN KEY (requirement_id, org_id) REFERENCES core.requirements (id, org_id),
  FOREIGN KEY (person_id, org_id)      REFERENCES core.people       (id, org_id),
  FOREIGN KEY (resume_id, org_id)      REFERENCES core.resumes      (id, org_id)
);

CREATE INDEX IF NOT EXISTS matches_requirement_idx ON core.matches (org_id, requirement_id);
CREATE INDEX IF NOT EXISTS matches_person_idx      ON core.matches (org_id, person_id);


-- ══════════════════════════════════ three tables that absorb wide columns ══

-- File and ingestion metadata, off requirements and resumes. `syntra.jobs`
-- carries original_file_name, file_path, mime_type, raw_text and storage_key
-- among its 42 columns; none of that is what a requirement IS.
CREATE TABLE IF NOT EXISTS core.source_files (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid NOT NULL REFERENCES platform.organizations (id),
  subject_type       text NOT NULL CHECK (subject_type IN ('requirement','resume','person')),
  subject_id         uuid NOT NULL,
  original_file_name text,
  file_path          text NOT NULL,
  mime_type          text,
  raw_text           text,
  content_hash       text,
  uploaded_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS source_files_subject_idx
  ON core.source_files (subject_type, subject_id);

-- ONE state machine, replacing the same six columns repeated on three tables:
-- processing_status, processing_started_at, processing_failed_at,
-- processing_error, uploaded_at, processed_at appear on syntra.jobs and
-- syntra.resumes, and again in a third spelling on syntra.matches.
--
-- Keeping attempts as rows rather than overwriting a status column means the
-- history survives, which is what an operations screen needs to show.
CREATE TABLE IF NOT EXISTS core.processing_jobs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES platform.organizations (id),
  application  text NOT NULL REFERENCES platform.applications (key),
  subject_type text NOT NULL CHECK (subject_type IN ('requirement','resume','match')),
  subject_id   uuid NOT NULL,
  stage        text NOT NULL,   -- 'extract','summarise','embed','score'
  status       text NOT NULL CHECK (status IN ('pending','running','succeeded','failed')),
  attempt      integer NOT NULL DEFAULT 1,
  started_at   timestamptz,
  finished_at  timestamptz,
  error        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (subject_type, subject_id, stage, attempt)
);

-- One home for vectors, replacing the embedding column on syntra.jobs, the
-- same on syntra.resumes, and the separate public.job_vector_embeddings and
-- public.resume_vector_embeddings tables.
--
-- The column is deliberately an unconstrained `vector`: this database holds
-- both 1536- and 1024-dimension embeddings today, so pinning a dimension would
-- make one of them unstorable. The cost is that an hnsw index needs a fixed
-- dimension, so indexes are added per model as a partial index once the query
-- patterns are known — not guessed at while the table is empty.
CREATE TABLE IF NOT EXISTS core.embeddings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES platform.organizations (id),
  subject_type  text NOT NULL CHECK (subject_type IN ('requirement','resume','person')),
  subject_id    uuid NOT NULL,
  model         text NOT NULL,
  model_version text NOT NULL,
  embedding     vector NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (subject_type, subject_id, model, model_version)
);


-- Keep updated_at honest using the helper the rest of the database uses.
DO $$
DECLARE t text;
BEGIN
  IF to_regprocedure('app.set_updated_at()') IS NULL THEN RETURN; END IF;
  FOREACH t IN ARRAY ARRAY['people','requirements','resumes','matches'] LOOP
    EXECUTE format(
      'CREATE OR REPLACE TRIGGER %I BEFORE UPDATE ON core.%I
         FOR EACH ROW EXECUTE FUNCTION app.set_updated_at()',
      'core_' || t || '_updated_at', t);
  END LOOP;
END $$;


-- RLS is deliberately not enabled. See the note in V20260909.03: switching it
-- on without policies means deny-everything, and 29 tables already demonstrate
-- that mistake. It goes on in step 8, with the policies that make it mean
-- something.


DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM pg_tables WHERE schemaname = 'core';
  RAISE NOTICE 'core: % tables created, all empty. Rows arrive in step 4.', n;
END $$;
