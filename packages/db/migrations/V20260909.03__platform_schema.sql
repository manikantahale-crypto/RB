--
-- Step 1 of the schema migration: the `platform` layer.
--
-- Identity and tenancy — who the customers are, who the people are, and which
-- people belong to which customer. Nothing else in the system may own these
-- concepts once this lands.
--
-- PURELY ADDITIVE. This creates a new schema and copies rows into it. It does
-- not alter, rename or drop anything that exists, and nothing reads these
-- tables yet. `public.organizations` and `public.users` keep working exactly
-- as they do today; they are retired in a later step, once code has moved.
--
-- THE ONE REAL CHANGE OF SHAPE
--
-- `role` moves off the user and onto the membership. Today `public.users` has
-- `organization_id NOT NULL` and a single `role`, so a person belongs to one
-- customer and has one role everywhere. A staffing platform needs the
-- opposite: somebody may work for two agencies, authoring in one and only
-- reading in the other. There are 52 user rows today, so this is cheap now and
-- expensive at any later point.
--
-- SAFE TO RE-RUN. Every insert is ON CONFLICT DO NOTHING, and the verification
-- at the end compares counts rather than assuming.
--

CREATE SCHEMA IF NOT EXISTS platform;


-- ─────────────────────────────────────────────────────────── organisations ──
CREATE TABLE IF NOT EXISTS platform.organizations (
  id         uuid        PRIMARY KEY,
  name       text        NOT NULL,
  -- Stable, URL-safe, and unique: what a tenant is called in a hostname or a
  -- path. Derived from the name here, but it is the slug that must never
  -- change afterwards, not the name.
  slug       citext      NOT NULL UNIQUE,
  status     text        NOT NULL DEFAULT 'active'
                         CHECK (status IN ('trial','active','suspended','closed')),
  settings   jsonb       NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);


-- ─────────────────────────────────────────────────────────────────── users ──
CREATE TABLE IF NOT EXISTS platform.users (
  id            uuid        PRIMARY KEY,
  -- Global identity, deliberately not per-organisation. This is what lets one
  -- person belong to two customers, and what collapses syntra.users into this
  -- table later: those 49 rows share both email AND id with public.users.
  email         citext      NOT NULL UNIQUE,
  full_name     text        NOT NULL,
  password_hash text,                       -- null when they sign in via SSO
  status        text        NOT NULL DEFAULT 'active'
                            CHECK (status IN ('invited','active','disabled')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);


-- ───────────────────────────────────────────────────────────── memberships ──
-- The table that does not exist today, and the reason this step exists at all.
CREATE TABLE IF NOT EXISTS platform.org_members (
  org_id     uuid        NOT NULL REFERENCES platform.organizations (id),
  user_id    uuid        NOT NULL REFERENCES platform.users (id),
  role       text        NOT NULL
                         CHECK (role IN ('owner','admin','author','operator','viewer')),
  status     text        NOT NULL DEFAULT 'active'
                         CHECK (status IN ('invited','active','suspended')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id)
);

-- "Which organisations does this person belong to" — the direction the primary
-- key cannot answer.
CREATE INDEX IF NOT EXISTS org_members_user_idx ON platform.org_members (user_id);


-- Keep updated_at honest, using the helper the rest of the database already
-- uses rather than a second convention.
DO $$
BEGIN
  IF to_regprocedure('app.set_updated_at()') IS NOT NULL THEN
    CREATE OR REPLACE TRIGGER platform_organizations_updated_at
      BEFORE UPDATE ON platform.organizations
      FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
    CREATE OR REPLACE TRIGGER platform_users_updated_at
      BEFORE UPDATE ON platform.users
      FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
    CREATE OR REPLACE TRIGGER platform_org_members_updated_at
      BEFORE UPDATE ON platform.org_members
      FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
  END IF;
END $$;


-- NOTE ON ROW-LEVEL SECURITY, DELIBERATELY NOT ENABLED HERE.
--
-- 29 tables in `public` have RLS switched on with zero policies behind them,
-- which in Postgres means deny-everything. It goes unnoticed only because every
-- connection is `postgres`, which bypasses RLS entirely. Enabling RLS on these
-- three tables now would add three more to that count and protect nothing.
-- Policies and roles are step 8, and RLS goes on in the same change as the
-- policies that make it mean something.


-- ══════════════════════════════════════════════════════════════ backfill ══
--
-- Ids are carried across unchanged. Everything in the database that already
-- references an organisation or a user by id keeps referencing the right row,
-- which is what makes the later cutover a rename rather than a remap.

-- Organisations. Two rows are both named "Test Org", so the slug cannot come
-- from the name alone; where a name is shared the id is appended to keep the
-- slug unique without inventing a naming convention nobody agreed to.
WITH src AS (
  SELECT o.*,
         nullif(trim(both '-' from regexp_replace(lower(o.name), '[^a-z0-9]+', '-', 'g')), '') AS base
    FROM public.organizations o
),
slugged AS (
  SELECT src.*,
         count(*) OVER (PARTITION BY base) AS sharing_the_name
    FROM src
)
INSERT INTO platform.organizations (id, name, slug, status, settings, created_at, updated_at, deleted_at)
SELECT s.id,
       s.name,
       CASE
         WHEN s.base IS NULL           THEN 'org-' || left(s.id::text, 8)
         WHEN s.sharing_the_name > 1   THEN s.base || '-' || left(s.id::text, 8)
         ELSE s.base
       END,
       CASE WHEN s.deleted_at IS NOT NULL THEN 'closed' ELSE 'active' END,
       s.settings,
       s.created_at,
       s.updated_at,
       s.deleted_at
  FROM slugged s
ON CONFLICT (id) DO NOTHING;


-- Users. `password_hash` stays null: this database does not hold one today,
-- and inventing a column value would imply a login path that does not exist.
INSERT INTO platform.users (id, email, full_name, password_hash, status, created_at, updated_at, deleted_at)
SELECT u.id,
       u.email::citext,
       u.full_name,
       NULL,
       CASE WHEN u.deleted_at IS NOT NULL THEN 'disabled' ELSE 'active' END,
       u.created_at,
       u.updated_at,
       u.deleted_at
  FROM public.users u
ON CONFLICT (id) DO NOTHING;


-- Memberships — one per user, from the organisation they are pinned to today.
--
-- The role mapping is a judgement, and it is written here rather than hidden in
-- application code so it can be argued with:
--
--   LEAD      -> admin      runs the account, may change what others may do
--   RECRUITER -> operator   uses the product daily, does not author workflows
--   anything else -> viewer least privilege, because an unrecognised role is
--                          an unanswered question and read-only is the safe
--                          answer to it
--
-- Nobody is mapped to `owner` or `author`. Both are real roles in the target
-- model, but assigning them is a decision for whoever runs the account, not
-- something to infer from a column that never distinguished them.
INSERT INTO platform.org_members (org_id, user_id, role, status, created_at, updated_at)
SELECT u.organization_id,
       u.id,
       CASE upper(u.role)
         WHEN 'LEAD'      THEN 'admin'
         WHEN 'RECRUITER' THEN 'operator'
         ELSE 'viewer'
       END,
       CASE WHEN u.deleted_at IS NOT NULL THEN 'suspended' ELSE 'active' END,
       u.created_at,
       u.updated_at
  FROM public.users u
  -- A user whose organisation is not in `organizations` would fail the foreign
  -- key. There are none today; this keeps the migration from being the place
  -- that discovers otherwise.
 WHERE EXISTS (SELECT 1 FROM platform.organizations o WHERE o.id = u.organization_id)
ON CONFLICT (org_id, user_id) DO NOTHING;


-- ═════════════════════════════════════════════════════════ verification ══
--
-- Compare against the source rather than trusting the inserts. A backfill that
-- silently copies 51 of 52 rows is worse than one that fails.
DO $$
DECLARE
  src_orgs    int; got_orgs    int;
  src_users   int; got_users   int;
  src_members int; got_members int;
  unmapped    int;
BEGIN
  SELECT count(*) INTO src_orgs  FROM public.organizations;
  SELECT count(*) INTO got_orgs  FROM platform.organizations;
  SELECT count(*) INTO src_users FROM public.users;
  SELECT count(*) INTO got_users FROM platform.users;
  SELECT count(*) INTO src_members
    FROM public.users u
   WHERE EXISTS (SELECT 1 FROM platform.organizations o WHERE o.id = u.organization_id);
  SELECT count(*) INTO got_members FROM platform.org_members;

  IF got_orgs <> src_orgs THEN
    RAISE EXCEPTION 'organisations: % copied, % expected', got_orgs, src_orgs;
  END IF;
  IF got_users <> src_users THEN
    RAISE EXCEPTION 'users: % copied, % expected', got_users, src_users;
  END IF;
  IF got_members <> src_members THEN
    RAISE EXCEPTION 'memberships: % created, % expected', got_members, src_members;
  END IF;

  -- A role nobody anticipated becomes a viewer above, which is safe but silent.
  -- Say so, so it is a decision rather than a default nobody noticed.
  SELECT count(*) INTO unmapped
    FROM public.users u WHERE upper(u.role) NOT IN ('LEAD','RECRUITER');
  IF unmapped > 0 THEN
    RAISE WARNING '% users had a role outside LEAD/RECRUITER and were made viewers', unmapped;
  END IF;

  RAISE NOTICE 'platform: % organisations, % users, % memberships',
    got_orgs, got_users, got_members;
END $$;
