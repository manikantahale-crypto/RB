--
-- Retire the second identity table: make platform.users able to sign people in.
--
-- WHAT WAS WRONG
--
-- There are two user tables and they hold different halves of one person:
--
--   syntra.users     49 rows, ALL with a password_hash. This is what the login
--                    endpoint actually reads. No organisation column at all.
--   public.users     52 rows, WITH organization_id, WITHOUT any password.
--                    This is what created_by points at everywhere else.
--
-- So the table that authenticates people cannot say which customer they belong
-- to, and the table that knows the customer cannot authenticate anyone. They
-- share ids and emails — 49 of them — so this is one table split in half by
-- accident.
--
-- V20260909.03 built platform.users from public.users, which means it inherited
-- the half without passwords. Pointing the login endpoint at it before this
-- migration would lock every user out.
--
-- WHAT THIS DOES
--
-- Copies the password hashes across by id. Nothing is re-hashed and no
-- credential is created — the same bcrypt string moves to the row that also
-- knows the organisation.
--
-- THE THREE WHO CANNOT SIGN IN, AND WHY THAT IS NOT A REGRESSION
--
-- Three of the 52 have no syntra.users row and therefore no password. They
-- cannot sign in today either, because the login endpoint reads syntra.users
-- and they are not in it. They are reported below rather than silently left
-- half-migrated, and they need a password set or an invitation.
--
-- SAFE TO RE-RUN. Only fills a NULL.
--

UPDATE platform.users p
   SET password_hash = s.password_hash,
       updated_at    = now()
  FROM syntra.users s
 WHERE p.id = s.id
   AND p.password_hash IS NULL
   AND s.password_hash IS NOT NULL;


-- A person who can sign in must also belong to somewhere, or the token has no
-- organisation and every tenant-scoped write falls back to deriving one.
DO $$
DECLARE
  can_sign_in int;
  no_password int;
  no_membership int;
BEGIN
  SELECT count(*) INTO can_sign_in   FROM platform.users WHERE password_hash IS NOT NULL;
  SELECT count(*) INTO no_password   FROM platform.users WHERE password_hash IS NULL;

  SELECT count(*) INTO no_membership
    FROM platform.users u
   WHERE u.password_hash IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM platform.org_members m WHERE m.user_id = u.id);

  RAISE NOTICE 'platform.users: % can sign in', can_sign_in;

  IF no_password > 0 THEN
    RAISE WARNING '% users have no password and cannot sign in. They could not before', no_password;
    RAISE WARNING '   either — they exist in public.users but not syntra.users. Set a';
    RAISE WARNING '   password or invite them.';
  END IF;

  IF no_membership > 0 THEN
    RAISE WARNING '% users can sign in but belong to no organisation. Their token will', no_membership;
    RAISE WARNING '   carry no orgId and their writes will fall back to the insert trigger.';
  END IF;
END $$;
