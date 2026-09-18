-- A requirement that arrived by email has a body and no file. Keep the body.
--
-- WHAT WAS WRONG
--
-- core.source_files.file_path is NOT NULL, and every writer respected it by
-- writing nothing when there was no path: app.mirror_source_file (V20260909.19
-- line 118, "a subject without one gets no row"), the incremental copy that
-- followed the same rule, and node-api's core-writes.addSourceFile.
--
-- But most requirements have no file. Measured on the old project on
-- 2026-09-18 (ref/ASTRA_Onboarding.md stage 4): of 3,846 syntra.jobs, 3,531
-- have no file_path, and 3,362 of those have raw_text — the email that ASTRA
-- parsed — and 3,482 have a summary_hash, the content fingerprint ASTRA
-- dedups on. On this project, all 3,534 requirements without a file row have
-- neither: the text that the requirement IS was dropped at the door, and the
-- dedup key with it, so the same email arriving twice would be accepted twice.
--
-- WHAT THIS DOES
--
-- Lets a source_files row have no file_path, and requires instead that a row
-- carries SOMETHING — a path or text. The backfill of the 3,362 bodies is
-- data and comes from the old project through scripts/copy-delta.mjs
-- (its source_files rule now matches this one).
--
-- SAFE TO RE-RUN.

BEGIN;

ALTER TABLE core.source_files ALTER COLUMN file_path DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'source_files_has_content_ck' AND conrelid = 'core.source_files'::regclass
  ) THEN
    ALTER TABLE core.source_files
      ADD CONSTRAINT source_files_has_content_ck
      CHECK ((file_path IS NOT NULL OR raw_text IS NOT NULL) IS TRUE);
  END IF;
END $$;

COMMENT ON COLUMN core.source_files.file_path IS
  'Where the uploaded file is stored. NULL for a document that arrived as text '
  '(an email body): then raw_text is the document (V20260909.70).';

DO $$
DECLARE nn boolean;
BEGIN
  SELECT attnotnull INTO nn FROM pg_attribute
   WHERE attrelid = 'core.source_files'::regclass AND attname = 'file_path';
  IF nn THEN RAISE EXCEPTION 'core.source_files.file_path is still NOT NULL'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'source_files_has_content_ck') THEN
    RAISE EXCEPTION 'source_files_has_content_ck missing';
  END IF;
  RAISE NOTICE 'core.source_files: a row may have no file_path; it must have a path or text.';
END $$;

COMMIT;
