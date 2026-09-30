-- Migration: V20260909.77__cascade_email_child_records.sql
-- Purpose: Set ON DELETE CASCADE for email_classifications and followups message_id foreign key constraints

ALTER TABLE relay.email_classifications
  DROP CONSTRAINT IF EXISTS email_classifications_message_id_fkey,
  ADD CONSTRAINT email_classifications_message_id_fkey
    FOREIGN KEY (message_id) REFERENCES relay.email_messages(id) ON DELETE CASCADE;

ALTER TABLE relay.followups
  DROP CONSTRAINT IF EXISTS followups_message_id_fkey,
  ADD CONSTRAINT followups_message_id_fkey
    FOREIGN KEY (message_id) REFERENCES relay.email_messages(id) ON DELETE CASCADE;
