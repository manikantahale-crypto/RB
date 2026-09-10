--
-- BASELINE — the schema as it actually stood in production on 2026-09-09.
--
-- WHY THIS FILE EXISTS
--
-- This database was never built by its migrations. There is no
-- flyway_schema_history in any schema, packages/db/migrations held two files
-- claiming V11 with different primary key types, and eight versions existed
-- twice under two naming conventions. Flyway could not have run even if
-- someone had tried, and the tables were created by hand and by the
-- application at boot instead.
--
-- So the history is squashed rather than repaired. This file is a pg_dump of
-- the live schema — 100 tables across five schemas — and it is the starting
-- point for every rebuild from here. The old files are kept, unchanged and
-- unused, in packages/db/legacy-migrations/ as a record of intent.
--
-- This also closes the V28 hole. V28__ml_scoring_log.sql was recorded as
-- applied while existing in no branch; the table it created is in this dump
-- like every other, so the missing file stops mattering.
--
-- HOW IT IS USED
--
--   production   flyway baseline -baselineVersion=20260909.01
--                marks it applied WITHOUT running it. Nothing is re-created.
--
--   anywhere else  flyway migrate
--                  runs it, then everything after it.
--
-- Regenerate with scripts/dump-baseline.sh — but do not, unless you are
-- deliberately re-baselining. Changes belong in a new migration after this one.
--

-- The dump names types and operator classes from these extensions but cannot
-- create them: extensions live outside the dumped schemas.
CREATE EXTENSION IF NOT EXISTS vector;   -- vector columns, hnsw, vector_cosine_ops
CREATE EXTENSION IF NOT EXISTS citext;   -- case-insensitive email columns
CREATE EXTENSION IF NOT EXISTS pg_trgm;  -- gin_trgm_ops, on the fuzzy-name indexes

-- Roles the policies below grant to. Cluster-level, so no dump contains them.
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['syntra_relay','syntra_app','syntra_migrator','anon'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('CREATE ROLE %I NOLOGIN', r);
    END IF;
  END LOOP;
END $$;

--
-- PostgreSQL database dump
--


-- Dumped from database version 17.6
-- Dumped by pg_dump version 18.0

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: app; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS app;


--
-- Name: interview_agent; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS interview_agent;


--
-- Name: orch; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS orch;


--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS public;


--
-- Name: relay; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS relay;


--
-- Name: syntra; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS syntra;


--
-- Name: current_org_id(); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.current_org_id() RETURNS uuid
    LANGUAGE sql STABLE
    AS $$
    SELECT NULLIF(current_setting('app.org_id', true), '')::uuid
  $$;


--
-- Name: FUNCTION current_org_id(); Type: COMMENT; Schema: app; Owner: -
--

COMMENT ON FUNCTION app.current_org_id() IS 'Current tenant from the app.org_id GUC. NULL when unset, so RLS fails closed.';


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: app; Owner: -
--

CREATE FUNCTION app.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
  BEGIN
    NEW.updated_at := now();
    RETURN NEW;
  END
  $$;


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: interview_agent; Owner: -
--

CREATE FUNCTION interview_agent.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


--
-- Name: prevent_event_update_delete(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_event_update_delete() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    RAISE EXCEPTION 'Events are immutable. Updates and deletes are forbidden.';
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: bank_questions; Type: TABLE; Schema: interview_agent; Owner: -
--

CREATE TABLE interview_agent.bank_questions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    job_id uuid,
    skill text NOT NULL,
    level text NOT NULL,
    question_text text NOT NULL,
    ideal_answer_rubric text NOT NULL,
    source text NOT NULL,
    embedding public.vector(1536),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    follow_up_question text,
    rubric_grounded_from uuid[],
    CONSTRAINT bank_questions_level_check CHECK ((level = ANY (ARRAY['foundational'::text, 'intermediate'::text, 'advanced'::text, 'expert'::text]))),
    CONSTRAINT bank_questions_source_check CHECK ((source = ANY (ARRAY['retrieved'::text, 'generated'::text, 'resume_anchored'::text])))
);


--
-- Name: calendar_events; Type: TABLE; Schema: interview_agent; Owner: -
--

CREATE TABLE interview_agent.calendar_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    roster_id uuid NOT NULL,
    slot_id text NOT NULL,
    provider_event_id text,
    start_time timestamp with time zone NOT NULL,
    duration_minutes integer DEFAULT 15 NOT NULL,
    candidate_name text DEFAULT ''::text NOT NULL,
    candidate_email text DEFAULT ''::text NOT NULL,
    job_title text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: email_activity; Type: TABLE; Schema: interview_agent; Owner: -
--

CREATE TABLE interview_agent.email_activity (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    roster_id uuid,
    session_id uuid,
    candidate_name text DEFAULT ''::text NOT NULL,
    candidate_email text NOT NULL,
    activity_type text NOT NULL,
    status text DEFAULT 'sent'::text NOT NULL,
    message_id text,
    sent_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: integrity_signals; Type: TABLE; Schema: interview_agent; Owner: -
--

CREATE TABLE interview_agent.integrity_signals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    signal_type text NOT NULL,
    severity text NOT NULL,
    metadata jsonb,
    detected_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT integrity_signals_severity_check CHECK ((severity = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text])))
);


--
-- Name: interview_sessions; Type: TABLE; Schema: interview_agent; Owner: -
--

CREATE TABLE interview_agent.interview_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    roster_id uuid NOT NULL,
    agent_run_id uuid,
    status text DEFAULT 'in_progress'::text NOT NULL,
    stop_reason text,
    question_count integer DEFAULT 0 NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    ended_at timestamp with time zone,
    question_plan uuid[],
    planned_skills text[],
    CONSTRAINT interview_sessions_status_check CHECK ((status = ANY (ARRAY['in_progress'::text, 'completed'::text, 'early_exited'::text, 'hard_capped'::text, 'time_capped'::text])))
);


--
-- Name: reports; Type: TABLE; Schema: interview_agent; Owner: -
--

CREATE TABLE interview_agent.reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    report_url text,
    per_topic_rollup jsonb,
    study_plan jsonb,
    generated_at timestamp with time zone DEFAULT now() NOT NULL,
    sent_at timestamp with time zone
);


--
-- Name: roster; Type: TABLE; Schema: interview_agent; Owner: -
--

CREATE TABLE interview_agent.roster (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    match_id uuid NOT NULL,
    job_id uuid NOT NULL,
    candidate_id uuid NOT NULL,
    status text DEFAULT 'not_started'::text NOT NULL,
    invited_at timestamp with time zone,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    retake_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT roster_status_check CHECK ((status = ANY (ARRAY['not_started'::text, 'invited'::text, 'in_progress'::text, 'completed'::text, 'retake_requested'::text])))
);


--
-- Name: roster_access_tokens; Type: TABLE; Schema: interview_agent; Owner: -
--

CREATE TABLE interview_agent.roster_access_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    roster_id uuid NOT NULL,
    token_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: session_answers; Type: TABLE; Schema: interview_agent; Owner: -
--

CREATE TABLE interview_agent.session_answers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_question_id uuid NOT NULL,
    answer_text text,
    audio_url text,
    answered_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: session_questions; Type: TABLE; Schema: interview_agent; Owner: -
--

CREATE TABLE interview_agent.session_questions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    bank_question_id uuid NOT NULL,
    sequence integer NOT NULL,
    is_follow_up boolean DEFAULT false NOT NULL,
    asked_at timestamp with time zone DEFAULT now() NOT NULL,
    skill text,
    is_adaptive boolean DEFAULT false NOT NULL
);


--
-- Name: session_scores; Type: TABLE; Schema: interview_agent; Owner: -
--

CREATE TABLE interview_agent.session_scores (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_question_id uuid NOT NULL,
    content_score numeric(3,1) NOT NULL,
    communication_score numeric(3,1) NOT NULL,
    confidence_signal numeric(3,2) NOT NULL,
    scored_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT session_scores_communication_score_check CHECK (((communication_score >= (0)::numeric) AND (communication_score <= (10)::numeric))),
    CONSTRAINT session_scores_confidence_signal_check CHECK (((confidence_signal >= (0)::numeric) AND (confidence_signal <= (1)::numeric))),
    CONSTRAINT session_scores_content_score_check CHECK (((content_score >= (0)::numeric) AND (content_score <= (10)::numeric)))
);


--
-- Name: node_executions; Type: TABLE; Schema: orch; Owner: -
--

CREATE TABLE orch.node_executions (
    run_id uuid NOT NULL,
    node_id text NOT NULL,
    status text NOT NULL,
    patch_ref jsonb,
    emitted_events jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: runs; Type: TABLE; Schema: orch; Owner: -
--

CREATE TABLE orch.runs (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    agent_name text NOT NULL,
    trigger_event_id uuid,
    graph_key text NOT NULL,
    status text NOT NULL,
    langgraph_thread_id text,
    input_ref jsonb DEFAULT '{}'::jsonb NOT NULL,
    error jsonb,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    graph_version integer
);


--
-- Name: steps; Type: TABLE; Schema: orch; Owner: -
--

CREATE TABLE orch.steps (
    id uuid NOT NULL,
    run_id uuid NOT NULL,
    seq integer NOT NULL,
    node text NOT NULL,
    tool_name text,
    input jsonb,
    output_ref jsonb,
    latency_ms integer,
    status text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: activities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.activities (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    entity_type text NOT NULL,
    entity_id uuid NOT NULL,
    activity_type text NOT NULL,
    actor_type text NOT NULL,
    actor_id uuid,
    agent_run_id uuid,
    summary text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    dedupe_key text,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT activities_actor_type_check CHECK ((actor_type = ANY (ARRAY['USER'::text, 'AGENT'::text, 'SYSTEM'::text])))
);

ALTER TABLE ONLY public.activities FORCE ROW LEVEL SECURITY;


--
-- Name: admin_agent_entitlements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_agent_entitlements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    admin_id text NOT NULL,
    agent_id uuid NOT NULL,
    org_id uuid,
    can_edit boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.admin_agent_entitlements FORCE ROW LEVEL SECURITY;


--
-- Name: agent_definitions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_definitions (
    id uuid NOT NULL,
    name text NOT NULL,
    version text NOT NULL,
    purpose text NOT NULL,
    system_prompt_ref text NOT NULL,
    allowed_tools jsonb NOT NULL,
    autonomy jsonb NOT NULL,
    model_config jsonb NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: agent_policies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_policies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid,
    agent_id uuid NOT NULL,
    policy jsonb NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    version integer NOT NULL,
    checksum text,
    created_by text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT agent_policies_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'generated'::text, 'pending_go_live'::text, 'compiled'::text, 'published'::text, 'active'::text])))
);

ALTER TABLE ONLY public.agent_policies FORCE ROW LEVEL SECURITY;


--
-- Name: agent_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_runs (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    agent_definition_id uuid NOT NULL,
    trigger_type text NOT NULL,
    triggered_by uuid,
    trigger_event_id uuid,
    input_ref jsonb NOT NULL,
    status text DEFAULT 'QUEUED'::text NOT NULL,
    thread_id text NOT NULL,
    cost jsonb DEFAULT '{}'::jsonb NOT NULL,
    error jsonb,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT agent_runs_status_check CHECK ((status = ANY (ARRAY['QUEUED'::text, 'RUNNING'::text, 'PARKED'::text, 'WAITING_APPROVAL'::text, 'COMPLETED'::text, 'FAILED'::text, 'CANCELLED'::text, 'EXPIRED'::text]))),
    CONSTRAINT agent_runs_thread_id_format CHECK ((thread_id = (((organization_id)::text || ':'::text) || (id)::text))),
    CONSTRAINT agent_runs_trigger_type_check CHECK ((trigger_type = ANY (ARRAY['EVENT'::text, 'USER'::text, 'SCHEDULE'::text])))
);

ALTER TABLE ONLY public.agent_runs FORCE ROW LEVEL SECURITY;


--
-- Name: agent_steps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_steps (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    agent_run_id uuid NOT NULL,
    seq integer NOT NULL,
    node text NOT NULL,
    tool_name text,
    tool_version text,
    input jsonb,
    output_ref jsonb,
    tokens_in integer,
    tokens_out integer,
    latency_ms integer,
    status text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT agent_steps_status_check CHECK ((status = ANY (ARRAY['OK'::text, 'RETRIED'::text, 'FAILED'::text, 'SKIPPED'::text])))
);

ALTER TABLE ONLY public.agent_steps FORCE ROW LEVEL SECURITY;


--
-- Name: agent_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    agent_key text NOT NULL,
    agent_id uuid,
    display_name text NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    template jsonb NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: agent_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    agent_id uuid NOT NULL,
    org_id uuid,
    policy_id uuid NOT NULL,
    version integer NOT NULL,
    artifact_ref text NOT NULL,
    artifact_source text NOT NULL,
    checksum text NOT NULL,
    status text NOT NULL,
    generated_by text NOT NULL,
    generated_at timestamp with time zone DEFAULT now() NOT NULL,
    meta jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT agent_versions_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'generated'::text, 'pending_go_live'::text, 'compiled'::text, 'published'::text, 'active'::text])))
);

ALTER TABLE ONLY public.agent_versions FORCE ROW LEVEL SECURITY;


--
-- Name: approvals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.approvals (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    agent_run_id uuid NOT NULL,
    action_class text NOT NULL,
    entity_type text NOT NULL,
    entity_id uuid,
    proposed_action jsonb NOT NULL,
    rationale text NOT NULL,
    status text DEFAULT 'PENDING'::text NOT NULL,
    decided_by uuid,
    decided_at timestamp with time zone,
    decision_note text,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT approvals_status_check CHECK ((status = ANY (ARRAY['PENDING'::text, 'APPROVED'::text, 'MODIFIED'::text, 'REJECTED'::text, 'EXPIRED'::text])))
);

ALTER TABLE ONLY public.approvals FORCE ROW LEVEL SECURITY;


--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_logs (
    id bigint NOT NULL,
    organization_id uuid NOT NULL,
    actor_type text NOT NULL,
    actor_id uuid,
    action text NOT NULL,
    entity_type text NOT NULL,
    entity_id uuid,
    before jsonb,
    after jsonb,
    at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT audit_logs_actor_type_check CHECK ((actor_type = ANY (ARRAY['USER'::text, 'AGENT'::text, 'SYSTEM'::text])))
);

ALTER TABLE ONLY public.audit_logs FORCE ROW LEVEL SECURITY;


--
-- Name: audit_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.audit_logs ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.audit_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: candidate_identities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.candidate_identities (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    candidate_id uuid NOT NULL,
    identity_type text NOT NULL,
    identity_value text NOT NULL,
    source text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT candidate_identities_identity_type_check CHECK ((identity_type = ANY (ARRAY['EMAIL'::text, 'PHONE'::text, 'LINKEDIN'::text, 'DICE'::text, 'MONSTER'::text, 'ATS_ID'::text, 'RESUME_SHA256'::text])))
);

ALTER TABLE ONLY public.candidate_identities FORCE ROW LEVEL SECURITY;


--
-- Name: candidate_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.candidate_profiles (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    candidate_id uuid NOT NULL,
    source_document_id uuid NOT NULL,
    profile_version integer NOT NULL,
    parsed jsonb NOT NULL,
    parser_version text NOT NULL,
    is_current boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT candidate_profiles_profile_version_check CHECK ((profile_version >= 1))
);

ALTER TABLE ONLY public.candidate_profiles FORCE ROW LEVEL SECURITY;


--
-- Name: candidate_skills; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.candidate_skills (
    organization_id uuid NOT NULL,
    candidate_id uuid NOT NULL,
    skill_id uuid NOT NULL,
    years numeric(4,1),
    last_used date,
    evidence jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT candidate_skills_years_check CHECK ((years >= (0)::numeric))
);

ALTER TABLE ONLY public.candidate_skills FORCE ROW LEVEL SECURITY;


--
-- Name: candidates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.candidates (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    full_name text NOT NULL,
    primary_email public.citext,
    primary_phone text,
    location_city text,
    location_state text,
    location_country text,
    work_authorization text,
    relocation text,
    availability text DEFAULT 'AVAILABLE'::text NOT NULL,
    available_from date,
    bench_since date,
    experience_years numeric(4,1),
    title_headline text,
    rate jsonb DEFAULT '{}'::jsonb NOT NULL,
    rate_min numeric GENERATED ALWAYS AS ((NULLIF((rate ->> 'min'::text), ''::text))::numeric) STORED,
    employment_model text,
    marketing_status text DEFAULT 'ACTIVE'::text NOT NULL,
    owner_user_id uuid,
    merged_into_id uuid,
    resume_text text,
    search_tsv tsvector GENERATED ALWAYS AS (((setweight(to_tsvector('english'::regconfig, COALESCE(full_name, ''::text)), 'A'::"char") || setweight(to_tsvector('english'::regconfig, COALESCE(title_headline, ''::text)), 'B'::"char")) || setweight(to_tsvector('english'::regconfig, COALESCE(resume_text, ''::text)), 'C'::"char"))) STORED,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT candidates_availability_check CHECK ((availability = ANY (ARRAY['AVAILABLE'::text, 'AVAILABLE_SOON'::text, 'ENGAGED'::text, 'PLACED'::text, 'INACTIVE'::text]))),
    CONSTRAINT candidates_employment_model_check CHECK ((employment_model = ANY (ARRAY['W2'::text, 'C2C'::text, '1099'::text, 'ANY'::text]))),
    CONSTRAINT candidates_experience_years_check CHECK ((experience_years >= (0)::numeric)),
    CONSTRAINT candidates_marketing_status_check CHECK ((marketing_status = ANY (ARRAY['ACTIVE'::text, 'PAUSED'::text, 'DO_NOT_MARKET'::text]))),
    CONSTRAINT candidates_not_self_merged CHECK (((merged_into_id IS NULL) OR (merged_into_id <> id))),
    CONSTRAINT candidates_relocation_check CHECK ((relocation = ANY (ARRAY['YES'::text, 'NO'::text, 'REMOTE_ONLY'::text, 'HYBRID_OK'::text]))),
    CONSTRAINT candidates_work_authorization_check CHECK ((work_authorization = ANY (ARRAY['USC'::text, 'GC'::text, 'GC_EAD'::text, 'H1B'::text, 'H4_EAD'::text, 'OPT'::text, 'CPT'::text, 'TN'::text, 'OTHER'::text])))
);

ALTER TABLE ONLY public.candidates FORCE ROW LEVEL SECURITY;


--
-- Name: channel_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.channel_accounts (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    channel_id uuid NOT NULL,
    label text NOT NULL,
    credentials_ref text,
    config jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'ACTIVE'::text NOT NULL,
    last_sync_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT channel_accounts_status_check CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'PAUSED'::text, 'ERROR'::text, 'DISABLED'::text])))
);

ALTER TABLE ONLY public.channel_accounts FORCE ROW LEVEL SECURITY;


--
-- Name: channels; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.channels (
    id uuid NOT NULL,
    channel_type text NOT NULL,
    display_name text NOT NULL,
    is_enabled boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT channels_channel_type_check CHECK ((channel_type = ANY (ARRAY['EMAIL'::text, 'LINKEDIN'::text, 'DICE'::text, 'MONSTER'::text, 'INDEED'::text, 'PORTAL'::text, 'WHATSAPP'::text, 'MANUAL'::text, 'API'::text])))
);


--
-- Name: checkpoint_blobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.checkpoint_blobs (
    thread_id text NOT NULL,
    checkpoint_ns text DEFAULT ''::text NOT NULL,
    channel text NOT NULL,
    version text NOT NULL,
    type text NOT NULL,
    blob bytea
);


--
-- Name: checkpoint_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.checkpoint_migrations (
    v integer NOT NULL
);


--
-- Name: checkpoint_writes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.checkpoint_writes (
    thread_id text NOT NULL,
    checkpoint_ns text DEFAULT ''::text NOT NULL,
    checkpoint_id text NOT NULL,
    task_id text NOT NULL,
    idx integer NOT NULL,
    channel text NOT NULL,
    type text,
    blob bytea NOT NULL
);


--
-- Name: checkpoints; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.checkpoints (
    thread_id text NOT NULL,
    checkpoint_ns text DEFAULT ''::text NOT NULL,
    checkpoint_id text NOT NULL,
    parent_checkpoint_id text,
    type text,
    checkpoint jsonb NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.documents (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    entity_type text NOT NULL,
    entity_id uuid NOT NULL,
    doc_type text NOT NULL,
    storage_key text NOT NULL,
    file_name text NOT NULL,
    mime_type text NOT NULL,
    byte_size bigint NOT NULL,
    sha256 text NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    uploaded_by uuid,
    source text DEFAULT 'UPLOAD'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT documents_byte_size_check CHECK ((byte_size >= 0)),
    CONSTRAINT documents_doc_type_check CHECK ((doc_type = ANY (ARRAY['RESUME'::text, 'FORMATTED_RESUME'::text, 'JD'::text, 'RTR'::text, 'MSA'::text, 'NDA'::text, 'PO'::text, 'TIMESHEET'::text, 'INVOICE'::text, 'OFFER_LETTER'::text, 'OTHER'::text]))),
    CONSTRAINT documents_sha256_check CHECK ((sha256 ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT documents_source_check CHECK ((source = ANY (ARRAY['UPLOAD'::text, 'EMAIL'::text, 'CHANNEL'::text, 'AGENT'::text]))),
    CONSTRAINT documents_version_check CHECK ((version >= 1))
);

ALTER TABLE ONLY public.documents FORCE ROW LEVEL SECURITY;


--
-- Name: duplicate_reviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.duplicate_reviews (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    candidate_a uuid NOT NULL,
    candidate_b uuid NOT NULL,
    signals jsonb NOT NULL,
    approval_id uuid,
    status text DEFAULT 'PENDING'::text NOT NULL,
    decided_by uuid,
    decided_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT duplicate_reviews_distinct_pair CHECK ((candidate_a <> candidate_b)),
    CONSTRAINT duplicate_reviews_status_check CHECK ((status = ANY (ARRAY['PENDING'::text, 'MERGED'::text, 'DISTINCT'::text, 'EXPIRED'::text])))
);

ALTER TABLE ONLY public.duplicate_reviews FORCE ROW LEVEL SECURITY;


--
-- Name: email_classifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_classifications (
    message_id character varying(255) NOT NULL,
    thread_id character varying(255),
    main_bucket character varying(100),
    reply_intent character varying(100),
    sender_type character varying(50),
    priority character varying(50),
    requires_followup boolean DEFAULT false,
    candidate_id uuid,
    vendor_id uuid,
    classification_reason text,
    confidence_source character varying(50)
);


--
-- Name: email_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_messages (
    id character varying(255) NOT NULL,
    thread_id character varying(255),
    from_email character varying(255),
    from_name text,
    to_email character varying(255),
    subject text,
    raw_body text,
    cleaned_body text,
    direction character varying(50),
    date timestamp without time zone,
    provider_message_id character varying(255),
    is_bounce boolean DEFAULT false
);


--
-- Name: email_threads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_threads (
    thread_id character varying(255) NOT NULL,
    subject text,
    latest_sender text,
    latest_sender_email character varying(255),
    latest_date timestamp without time zone,
    reply_intent character varying(100),
    requires_followup boolean DEFAULT false,
    status character varying(50),
    priority character varying(50),
    candidate_id uuid,
    vendor_id uuid
);


--
-- Name: embeddings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.embeddings (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    entity_type text NOT NULL,
    entity_id uuid NOT NULL,
    entity_version integer NOT NULL,
    model text NOT NULL,
    dims integer NOT NULL,
    embedding public.vector(1024) NOT NULL,
    source_hash text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT embeddings_dims_match CHECK ((dims = public.vector_dims(embedding))),
    CONSTRAINT embeddings_entity_type_check CHECK ((entity_type = ANY (ARRAY['CANDIDATE_PROFILE'::text, 'REQUIREMENT'::text])))
);

ALTER TABLE ONLY public.embeddings FORCE ROW LEVEL SECURITY;


--
-- Name: event_outbox; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.event_outbox (
    id bigint NOT NULL,
    event_id uuid NOT NULL,
    event_type text NOT NULL,
    schema_version text DEFAULT '1.0'::text NOT NULL,
    organization_id uuid NOT NULL,
    aggregate_type text NOT NULL,
    aggregate_id uuid NOT NULL,
    correlation_id uuid NOT NULL,
    causation_id uuid,
    producer text DEFAULT 'api'::text NOT NULL,
    payload_ref jsonb NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    published_at timestamp with time zone
);

ALTER TABLE ONLY public.event_outbox FORCE ROW LEVEL SECURITY;


--
-- Name: event_outbox_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.event_outbox ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.event_outbox_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: event_registry; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.event_registry (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_type text NOT NULL,
    schema_version text NOT NULL,
    producer text NOT NULL,
    consumer text NOT NULL,
    description text NOT NULL,
    status text DEFAULT 'ACTIVE'::text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT event_registry_status_check CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'DEPRECATED'::text])))
);


--
-- Name: event_schemas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.event_schemas (
    event_type text NOT NULL,
    schema_version text NOT NULL,
    description text NOT NULL,
    payload_schema jsonb NOT NULL,
    envelope_fields jsonb NOT NULL,
    produced_when text,
    primary_consumer text,
    status text DEFAULT 'ACTIVE'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT event_schemas_status_check CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'DEPRECATED'::text])))
);


--
-- Name: events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.events (
    event_id uuid NOT NULL,
    org_id uuid NOT NULL,
    event_type text NOT NULL,
    schema_version text NOT NULL,
    aggregate_type text NOT NULL,
    aggregate_id uuid NOT NULL,
    correlation_id uuid NOT NULL,
    causation_id uuid,
    source_module text NOT NULL,
    payload jsonb NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: failed_workflows; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.failed_workflows (
    id text NOT NULL,
    organization_id text NOT NULL,
    event_id text NOT NULL,
    thread_id text NOT NULL,
    graph_key text NOT NULL,
    graph_version integer,
    queue text NOT NULL,
    error_class text NOT NULL,
    error_message text NOT NULL,
    pinned_payload jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    replayed_at timestamp with time zone
);


--
-- Name: followups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.followups (
    id character varying(255) NOT NULL,
    thread_id character varying(255),
    message_id character varying(255),
    candidate_id uuid,
    vendor_id uuid,
    main_category character varying(100),
    reply_type character varying(100),
    priority character varying(50),
    status character varying(50),
    due_date timestamp without time zone,
    suggested_reply text,
    followup_reason text
);


--
-- Name: graph_definitions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.graph_definitions (
    id text NOT NULL,
    org_id text,
    graph_key text NOT NULL,
    version integer NOT NULL,
    definition jsonb NOT NULL,
    checksum text NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    created_by text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    activated_at timestamp with time zone,
    CONSTRAINT graph_definitions_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'active'::text, 'retired'::text])))
);

ALTER TABLE ONLY public.graph_definitions FORCE ROW LEVEL SECURITY;


--
-- Name: graph_event_bindings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.graph_event_bindings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_type text NOT NULL,
    org_id uuid,
    graph_key text NOT NULL,
    module_queue text NOT NULL,
    agent_id uuid,
    version integer,
    status text DEFAULT 'active'::text NOT NULL,
    source text DEFAULT 'authoring'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT graph_event_bindings_source_check CHECK ((source = ANY (ARRAY['seed'::text, 'authoring'::text]))),
    CONSTRAINT graph_event_bindings_status_check CHECK ((status = ANY (ARRAY['active'::text, 'retired'::text])))
);


--
-- Name: graph_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.graph_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id text,
    graph_id text NOT NULL,
    graph_key text NOT NULL,
    version integer NOT NULL,
    definition jsonb NOT NULL,
    checksum text NOT NULL,
    status text DEFAULT 'compiled'::text NOT NULL,
    compiled_by text NOT NULL,
    compiled_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT graph_versions_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'compiled'::text, 'published'::text, 'active'::text, 'retired'::text])))
);

ALTER TABLE ONLY public.graph_versions FORCE ROW LEVEL SECURITY;


--
-- Name: ingestion_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ingestion_events (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    channel_account_id uuid NOT NULL,
    external_ref text,
    payload_ref jsonb NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    status text DEFAULT 'PENDING'::text NOT NULL,
    resolved_entity_type text,
    resolved_entity_id uuid,
    agent_run_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ingestion_events_status_check CHECK ((status = ANY (ARRAY['PENDING'::text, 'PROCESSED'::text, 'NEEDS_REVIEW'::text, 'REJECTED'::text, 'DUPLICATE'::text])))
);

ALTER TABLE ONLY public.ingestion_events FORCE ROW LEVEL SECURITY;


--
-- Name: job_descriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.job_descriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    client text,
    job_title text,
    description text,
    department text,
    location text,
    skills jsonb DEFAULT '[]'::jsonb,
    salary text,
    experience text,
    work_visa text,
    work_visa_muted text,
    channel text,
    quality text,
    grade text,
    confidence text,
    duplicate_status text,
    status text DEFAULT 'Published'::text,
    updated_at timestamp with time zone DEFAULT now(),
    parsed_data jsonb DEFAULT '{}'::jsonb
);


--
-- Name: job_vector_embeddings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.job_vector_embeddings (
    job_id uuid NOT NULL,
    embedding public.vector(1536),
    embedding_model text DEFAULT 'text-embedding-3-small'::text,
    embedding_version text DEFAULT 'v1'::text,
    summary_hash text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text,
    original_file_name text,
    file_path text,
    raw_text text,
    jd_summary text,
    required_skills jsonb,
    primary_role text,
    seniority text,
    company text,
    location text,
    score_threshold integer DEFAULT 50,
    processing_status text DEFAULT 'processed'::text,
    uploaded_at timestamp with time zone DEFAULT now(),
    processed_at timestamp with time zone DEFAULT now(),
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    summary_hash text,
    embedding public.vector(1536),
    embedding_model text DEFAULT 'text-embedding-3-small'::text,
    embedding_version text DEFAULT 'v1'::text,
    embedding_updated_at timestamp with time zone,
    source_email text,
    message_id text,
    source_type text,
    source_name text
);


--
-- Name: match_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.match_jobs (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    requirement_id uuid NOT NULL,
    agent_run_id uuid NOT NULL,
    policy_id uuid NOT NULL,
    trigger_event_id uuid,
    status text DEFAULT 'RUNNING'::text NOT NULL,
    stats jsonb DEFAULT '{}'::jsonb NOT NULL,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT match_jobs_status_check CHECK ((status = ANY (ARRAY['RUNNING'::text, 'COMPLETED'::text, 'FAILED'::text, 'CANCELLED'::text])))
);

ALTER TABLE ONLY public.match_jobs FORCE ROW LEVEL SECURITY;


--
-- Name: match_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.match_results (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    match_job_id uuid NOT NULL,
    candidate_id uuid NOT NULL,
    rank integer NOT NULL,
    total_score numeric(5,4) NOT NULL,
    score_breakdown jsonb NOT NULL,
    matched_skills jsonb NOT NULL,
    missing_skills jsonb NOT NULL,
    similarity numeric(5,4),
    explanation text,
    versions jsonb NOT NULL,
    recruiter_action text,
    action_reason text,
    acted_by uuid,
    acted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT match_results_rank_check CHECK ((rank >= 1)),
    CONSTRAINT match_results_recruiter_action_check CHECK ((recruiter_action = ANY (ARRAY['SHORTLISTED'::text, 'SUBMITTED'::text, 'REJECTED'::text, 'IGNORED'::text]))),
    CONSTRAINT match_results_total_score_check CHECK (((total_score >= (0)::numeric) AND (total_score <= (1)::numeric)))
);

ALTER TABLE ONLY public.match_results FORCE ROW LEVEL SECURITY;


--
-- Name: matching_policies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.matching_policies (
    id uuid NOT NULL,
    organization_id uuid,
    version integer NOT NULL,
    weights jsonb NOT NULL,
    thresholds jsonb NOT NULL,
    embedding_model text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT matching_policies_version_check CHECK ((version >= 1))
);

ALTER TABLE ONLY public.matching_policies FORCE ROW LEVEL SECURITY;


--
-- Name: ml_shadow_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ml_shadow_logs (
    id character varying(255) NOT NULL,
    message_id character varying(255),
    rule_intent character varying(100),
    ml_intent character varying(100),
    ml_confidence character varying(50),
    llm_intent character varying(100),
    "timestamp" timestamp without time zone DEFAULT now()
);


--
-- Name: module_dependency; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.module_dependency (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_type text NOT NULL,
    target_module text NOT NULL,
    target_workflow text NOT NULL,
    priority text DEFAULT 'normal'::text,
    enabled boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT module_dependency_priority_check CHECK ((priority = ANY (ARRAY['low'::text, 'normal'::text, 'high'::text, 'critical'::text])))
);


--
-- Name: node_registry; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.node_registry (
    registry_key text NOT NULL,
    key text NOT NULL,
    version text NOT NULL,
    module text NOT NULL,
    shareable boolean DEFAULT false NOT NULL,
    title text NOT NULL,
    description text NOT NULL,
    tags jsonb DEFAULT '[]'::jsonb NOT NULL,
    input_schema jsonb,
    output_schema jsonb,
    config_schema jsonb,
    admin_exposed jsonb DEFAULT '[]'::jsonb NOT NULL,
    side_effect text,
    idempotency jsonb,
    execution jsonb,
    llm jsonb,
    dependencies jsonb DEFAULT '[]'::jsonb NOT NULL,
    persistence jsonb,
    fixture_names jsonb DEFAULT '[]'::jsonb NOT NULL,
    has_stub boolean DEFAULT false NOT NULL,
    source text DEFAULT 'contract'::text NOT NULL,
    checksum text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    emits jsonb
);


--
-- Name: orbit_activities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.orbit_activities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    candidate_id uuid NOT NULL,
    activity_type text NOT NULL,
    actor_type text DEFAULT 'USER'::text NOT NULL,
    actor_id uuid,
    summary text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: orbit_interviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.orbit_interviews (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    candidate_id uuid NOT NULL,
    submission_id uuid,
    interview_type text DEFAULT 'TECHNICAL'::text NOT NULL,
    scheduled_at timestamp with time zone,
    duration_minutes integer,
    status text DEFAULT 'SCHEDULED'::text NOT NULL,
    interviewer_name text,
    feedback text,
    outcome text,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT orbit_interviews_interview_type_check CHECK ((interview_type = ANY (ARRAY['PHONE_SCREEN'::text, 'TECHNICAL'::text, 'HR'::text, 'FINAL'::text, 'PANEL'::text, 'CLIENT'::text, 'OTHER'::text]))),
    CONSTRAINT orbit_interviews_outcome_check CHECK ((outcome = ANY (ARRAY['PASSED'::text, 'FAILED'::text, 'ON_HOLD'::text, 'PENDING'::text]))),
    CONSTRAINT orbit_interviews_status_check CHECK ((status = ANY (ARRAY['SCHEDULED'::text, 'COMPLETED'::text, 'CANCELLED'::text, 'RESCHEDULED'::text, 'NO_SHOW'::text])))
);


--
-- Name: orbit_lifecycle_states; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.orbit_lifecycle_states (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    candidate_id uuid NOT NULL,
    state text NOT NULL,
    previous_state text,
    transitioned_at timestamp with time zone DEFAULT now() NOT NULL,
    transitioned_by uuid,
    note text,
    context jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT orbit_lifecycle_states_state_check CHECK ((state = ANY (ARRAY['AVAILABLE'::text, 'BENCH'::text, 'NOTICE'::text, 'PLACED'::text, 'HOLD'::text, 'PRIORITIZE'::text, 'OLD'::text, 'IGNORE'::text, 'MATCH_REQUESTED'::text, 'MATCHED'::text, 'SUBMITTED'::text, 'INTERVIEW'::text, 'OFFER'::text, 'JOINING'::text, 'ACTIVE_ASSIGNMENT'::text, 'ASSIGNMENT_ENDED'::text, 'INACTIVE'::text])))
);


--
-- Name: orbit_placements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.orbit_placements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    candidate_id uuid NOT NULL,
    requirement_id uuid,
    client_name text NOT NULL,
    client_party_id uuid,
    vendor_party_id uuid,
    start_date date NOT NULL,
    end_date date,
    confirmed_bill_rate numeric NOT NULL,
    confirmed_pay_rate numeric NOT NULL,
    employment_model text DEFAULT 'C2C'::text NOT NULL,
    work_mode text,
    location text,
    status text DEFAULT 'ACTIVE'::text NOT NULL,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    package_ctc numeric,
    monthly_profit numeric,
    vendor_id uuid,
    CONSTRAINT orbit_placements_confirmed_bill_rate_check CHECK ((confirmed_bill_rate > (0)::numeric)),
    CONSTRAINT orbit_placements_confirmed_pay_rate_check CHECK ((confirmed_pay_rate > (0)::numeric)),
    CONSTRAINT orbit_placements_employment_model_check CHECK ((employment_model = ANY (ARRAY['W2'::text, 'C2C'::text, '1099'::text, 'FTE'::text]))),
    CONSTRAINT orbit_placements_status_check CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'ENDED'::text, 'CANCELLED'::text]))),
    CONSTRAINT orbit_placements_work_mode_check CHECK ((work_mode = ANY (ARRAY['ONSITE'::text, 'HYBRID'::text, 'REMOTE'::text])))
);


--
-- Name: orbit_revenue_arrangements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.orbit_revenue_arrangements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    placement_id uuid NOT NULL,
    arrangement_type text NOT NULL,
    value numeric NOT NULL,
    calculated_hourly_amount numeric,
    calculated_monthly_amount numeric,
    calculation_note text,
    notes text,
    custom_formula text,
    is_current boolean DEFAULT true NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT orbit_revenue_arrangements_arrangement_type_check CHECK ((arrangement_type = ANY (ARRAY['MARKUP'::text, 'MARGIN'::text, 'FLAT_FEE'::text, 'SPREAD'::text, 'CUSTOM'::text])))
);


--
-- Name: orbit_submissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.orbit_submissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    candidate_id uuid NOT NULL,
    requirement_id uuid,
    requirement_title text,
    client_name text,
    vendor_party_id uuid,
    submitted_by uuid,
    submitted_at timestamp with time zone DEFAULT now() NOT NULL,
    status text DEFAULT 'SUBMITTED'::text NOT NULL,
    rate_submitted numeric,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT orbit_submissions_status_check CHECK ((status = ANY (ARRAY['SUBMITTED'::text, 'SHORTLISTED'::text, 'INTERVIEW_SCHEDULED'::text, 'REJECTED'::text, 'ON_HOLD'::text, 'OFFER_EXTENDED'::text, 'WITHDRAWN'::text])))
);


--
-- Name: orchestration_artifacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.orchestration_artifacts (
    organization_id text NOT NULL,
    kind text NOT NULL,
    natural_key text NOT NULL,
    payload jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: orchestration_job_pins; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.orchestration_job_pins (
    boss_job_id text NOT NULL,
    graph_key text NOT NULL,
    graph_version integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: orchestration_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.orchestration_runs (
    run_id uuid NOT NULL,
    org_id uuid,
    event_id uuid,
    workflow_name text NOT NULL,
    status text DEFAULT 'QUEUED'::text,
    started_at timestamp with time zone,
    ended_at timestamp with time zone,
    error jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT orchestration_runs_status_check CHECK ((status = ANY (ARRAY['QUEUED'::text, 'RUNNING'::text, 'COMPLETED'::text, 'FAILED'::text, 'CANCELLED'::text])))
);


--
-- Name: orchestration_steps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.orchestration_steps (
    step_id uuid NOT NULL,
    run_id uuid,
    node_name text NOT NULL,
    status text DEFAULT 'PENDING'::text,
    started_at timestamp with time zone,
    ended_at timestamp with time zone,
    error jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT orchestration_steps_status_check CHECK ((status = ANY (ARRAY['PENDING'::text, 'RUNNING'::text, 'COMPLETED'::text, 'FAILED'::text])))
);


--
-- Name: organizations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organizations (
    id uuid NOT NULL,
    name text NOT NULL,
    settings jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone
);

ALTER TABLE ONLY public.organizations FORCE ROW LEVEL SECURITY;


--
-- Name: parties; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.parties (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    party_type text NOT NULL,
    name text NOT NULL,
    website text,
    status text DEFAULT 'ACTIVE'::text NOT NULL,
    tier text,
    terms jsonb DEFAULT '{}'::jsonb NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT parties_party_type_check CHECK ((party_type = ANY (ARRAY['VENDOR'::text, 'PRIME_VENDOR'::text, 'CLIENT'::text, 'END_CLIENT'::text, 'MSP'::text, 'IMPLEMENTATION_PARTNER'::text, 'OTHER'::text]))),
    CONSTRAINT parties_status_check CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'WATCHLIST'::text, 'BLOCKED'::text, 'INACTIVE'::text]))),
    CONSTRAINT parties_tier_check CHECK ((tier = ANY (ARRAY['A'::text, 'B'::text, 'C'::text])))
);

ALTER TABLE ONLY public.parties FORCE ROW LEVEL SECURITY;


--
-- Name: prism_approvals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.prism_approvals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    submission_id uuid NOT NULL,
    status text DEFAULT 'PENDING'::text NOT NULL,
    notes text,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT prism_approvals_status_check CHECK ((status = ANY (ARRAY['PENDING'::text, 'REQUESTED'::text, 'APPROVED'::text, 'REJECTED'::text])))
);


--
-- Name: prism_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.prism_audit (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    entity_type text NOT NULL,
    entity_id uuid NOT NULL,
    previous_status text,
    new_status text NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: prism_consents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.prism_consents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    submission_id uuid NOT NULL,
    status text DEFAULT 'PENDING'::text NOT NULL,
    notes text,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT prism_consents_status_check CHECK ((status = ANY (ARRAY['PENDING'::text, 'REQUESTED'::text, 'APPROVED'::text, 'REJECTED'::text])))
);


--
-- Name: prism_rtr; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.prism_rtr (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    submission_id uuid NOT NULL,
    status text DEFAULT 'PENDING'::text NOT NULL,
    document_url text,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT prism_rtr_status_check CHECK ((status = ANY (ARRAY['PENDING'::text, 'SENT'::text, 'SIGNED'::text, 'DECLINED'::text])))
);


--
-- Name: prism_submissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.prism_submissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    candidate_id uuid NOT NULL,
    resume_id uuid NOT NULL,
    job_id uuid NOT NULL,
    match_id uuid,
    status text DEFAULT 'DRAFT'::text NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    candidate_validation_results jsonb DEFAULT '{}'::jsonb,
    vendor_validation_results jsonb DEFAULT '{}'::jsonb,
    masked_profile jsonb DEFAULT '{}'::jsonb,
    interview_details jsonb DEFAULT '{}'::jsonb,
    rate numeric,
    rate_type text,
    availability text,
    recruiter_label text,
    last_consent_sent_at timestamp with time zone,
    consent_resend_count integer DEFAULT 0 NOT NULL,
    CONSTRAINT chk_prism_submissions_consent_resend_count_nonneg CHECK ((consent_resend_count >= 0)),
    CONSTRAINT prism_submissions_status_check CHECK ((status = ANY (ARRAY['DRAFT'::text, 'PENDING_CONSENT'::text, 'CONSENT_REJECTED'::text, 'CANDIDATE_VALIDATED'::text, 'MASKED'::text, 'VENDOR_SUBMITTED'::text, 'VENDOR_ACCEPTED'::text, 'VENDOR_VALIDATED'::text, 'AVAILABILITY_CONFIRMED'::text, 'RATE_CONFIRMED'::text, 'PENDING_RTR'::text, 'RTR_CONFIRMED'::text, 'INTERVIEW_SCHEDULED'::text, 'READY'::text, 'SUBMITTED'::text, 'REJECTED'::text, 'WITHDRAWN'::text])))
);


--
-- Name: processed_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.processed_events (
    event_id uuid NOT NULL,
    consumer text NOT NULL,
    processed_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.processed_events FORCE ROW LEVEL SECURITY;


--
-- Name: recruiter_review_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.recruiter_review_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    organization_id uuid,
    action_type text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    title text NOT NULL,
    message text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    source_event_type text,
    source_event_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    decided_at timestamp with time zone,
    decided_by uuid,
    decision_note text,
    CONSTRAINT recruiter_review_items_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'dismissed'::text])))
);


--
-- Name: requirement_skills; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.requirement_skills (
    organization_id uuid NOT NULL,
    requirement_id uuid NOT NULL,
    skill_id uuid NOT NULL,
    is_mandatory boolean DEFAULT true NOT NULL,
    min_years numeric(4,1),
    weight numeric(4,3),
    source_text text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT requirement_skills_min_years_check CHECK ((min_years >= (0)::numeric)),
    CONSTRAINT requirement_skills_weight_check CHECK (((weight >= (0)::numeric) AND (weight <= (1)::numeric)))
);

ALTER TABLE ONLY public.requirement_skills FORCE ROW LEVEL SECURITY;


--
-- Name: requirements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.requirements (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    title text NOT NULL,
    status text DEFAULT 'NEW'::text NOT NULL,
    source_channel_id uuid,
    ingestion_id uuid,
    vendor_party_id uuid,
    client_party_id uuid,
    end_client_name text,
    jd_document_id uuid,
    raw_text text NOT NULL,
    parsed jsonb,
    parser_version text,
    location_city text,
    location_state text,
    work_mode text,
    employment_type text,
    rate jsonb DEFAULT '{}'::jsonb NOT NULL,
    rate_max numeric GENERATED ALWAYS AS ((NULLIF((rate ->> 'max'::text), ''::text))::numeric) STORED,
    positions_count integer DEFAULT 1 NOT NULL,
    priority text DEFAULT 'NORMAL'::text NOT NULL,
    owner_user_id uuid,
    idempotency_key text,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    respond_by timestamp with time zone,
    search_tsv tsvector GENERATED ALWAYS AS ((setweight(to_tsvector('english'::regconfig, COALESCE(title, ''::text)), 'A'::"char") || setweight(to_tsvector('english'::regconfig, COALESCE(raw_text, ''::text)), 'B'::"char"))) STORED,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT requirements_employment_type_check CHECK ((employment_type = ANY (ARRAY['C2C'::text, 'W2'::text, '1099'::text, 'FTE'::text, 'ANY'::text]))),
    CONSTRAINT requirements_positions_count_check CHECK ((positions_count >= 1)),
    CONSTRAINT requirements_priority_check CHECK ((priority = ANY (ARRAY['HOT'::text, 'NORMAL'::text, 'LOW'::text]))),
    CONSTRAINT requirements_status_check CHECK ((status = ANY (ARRAY['NEW'::text, 'PARSING'::text, 'ACTIVE'::text, 'ON_HOLD'::text, 'FILLED'::text, 'CLOSED'::text, 'EXPIRED'::text]))),
    CONSTRAINT requirements_work_mode_check CHECK ((work_mode = ANY (ARRAY['ONSITE'::text, 'HYBRID'::text, 'REMOTE'::text])))
);

ALTER TABLE ONLY public.requirements FORCE ROW LEVEL SECURITY;


--
-- Name: resume_vector_embeddings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.resume_vector_embeddings (
    resume_id uuid NOT NULL,
    candidate_id uuid,
    embedding public.vector(1536),
    embedding_model text DEFAULT 'text-embedding-3-small'::text,
    embedding_version text DEFAULT 'v1'::text,
    summary_hash text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: skill_aliases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.skill_aliases (
    id uuid NOT NULL,
    organization_id uuid,
    alias public.citext NOT NULL,
    skill_id uuid NOT NULL,
    source text DEFAULT 'SEED'::text NOT NULL,
    reviewed_at timestamp with time zone,
    reviewed_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT skill_aliases_source_check CHECK ((source = ANY (ARRAY['SEED'::text, 'LLM'::text, 'RECRUITER'::text])))
);

ALTER TABLE ONLY public.skill_aliases FORCE ROW LEVEL SECURITY;


--
-- Name: skills; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.skills (
    id uuid NOT NULL,
    canonical_name text NOT NULL,
    category text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    email public.citext NOT NULL,
    full_name text NOT NULL,
    role text NOT NULL,
    preferences jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT users_role_check CHECK ((role = ANY (ARRAY['RECRUITER'::text, 'LEAD'::text, 'ADMIN'::text])))
);

ALTER TABLE ONLY public.users FORCE ROW LEVEL SECURITY;


--
-- Name: vendors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vendors (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    vendor_type text,
    status text DEFAULT 'PENDING'::text NOT NULL,
    website text,
    email text,
    phone text,
    linkedin text,
    location text,
    timezone text,
    payment_terms text,
    preferred_technologies text,
    preferred_immigration_types text,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT vendors_status_check CHECK ((status = ANY (ARRAY['PENDING'::text, 'ACTIVE'::text, 'REJECTED'::text, 'INACTIVE'::text]))),
    CONSTRAINT vendors_vendor_type_check CHECK ((vendor_type = ANY (ARRAY['DIRECT_CLIENT'::text, 'PRIME_VENDOR'::text, 'TIER_1'::text, 'TIER_2'::text, 'STAFFING_AGENCY'::text])))
);


--
-- Name: email_classifications; Type: TABLE; Schema: relay; Owner: -
--

CREATE TABLE relay.email_classifications (
    message_id character varying(255) NOT NULL,
    thread_id character varying(255) NOT NULL,
    main_bucket character varying(100),
    reply_intent character varying(100),
    sender_type character varying(50),
    priority character varying(50),
    requires_followup boolean DEFAULT false NOT NULL,
    candidate_id uuid,
    vendor_id uuid,
    classification_reason text,
    confidence_source character varying(50)
);


--
-- Name: email_messages; Type: TABLE; Schema: relay; Owner: -
--

CREATE TABLE relay.email_messages (
    id character varying(255) NOT NULL,
    thread_id character varying(255) NOT NULL,
    from_email character varying(255),
    from_name text,
    to_email character varying(255),
    subject text,
    raw_body text,
    cleaned_body text,
    direction character varying(50),
    date timestamp with time zone,
    provider_message_id character varying(255),
    is_bounce boolean DEFAULT false NOT NULL,
    html_body text,
    attachments jsonb DEFAULT '[]'::jsonb NOT NULL
);


--
-- Name: email_threads; Type: TABLE; Schema: relay; Owner: -
--

CREATE TABLE relay.email_threads (
    thread_id character varying(255) NOT NULL,
    subject text,
    latest_sender text,
    latest_sender_email character varying(255),
    latest_date timestamp with time zone,
    reply_intent character varying(100),
    requires_followup boolean DEFAULT false NOT NULL,
    status character varying(50),
    priority character varying(50),
    candidate_id uuid,
    vendor_id uuid,
    correlation_id character varying(255),
    workflow_context jsonb DEFAULT '{}'::jsonb,
    draft_body text,
    draft_subject text,
    draft_source character varying(50),
    draft_message_id character varying(255),
    draft_attachments jsonb DEFAULT '[]'::jsonb NOT NULL
);


--
-- Name: followups; Type: TABLE; Schema: relay; Owner: -
--

CREATE TABLE relay.followups (
    id character varying(255) NOT NULL,
    thread_id character varying(255) NOT NULL,
    message_id character varying(255),
    candidate_id uuid,
    vendor_id uuid,
    main_category character varying(100),
    reply_type character varying(100),
    priority character varying(50),
    status character varying(50),
    due_date timestamp with time zone,
    suggested_reply text,
    followup_reason text
);


--
-- Name: candidates; Type: TABLE; Schema: syntra; Owner: -
--

CREATE TABLE syntra.candidates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    full_name text,
    email text,
    phone text,
    current_title text,
    current_location text,
    availability text,
    candidate_source text DEFAULT 'external_applicant'::text,
    location text,
    immigration_status text,
    linkedin text,
    github text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    status text DEFAULT 'Active'::text,
    CONSTRAINT candidates_availability_check CHECK (((availability IS NULL) OR (availability = ANY (ARRAY['Immediate'::text, '15 Days'::text, '30 Days'::text, '60 Days'::text])))),
    CONSTRAINT candidates_candidate_source_check CHECK (((candidate_source IS NULL) OR (candidate_source = ANY (ARRAY['internal_consultant'::text, 'external_applicant'::text]))))
);


--
-- Name: event_log; Type: TABLE; Schema: syntra; Owner: -
--

CREATE TABLE syntra.event_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_type text NOT NULL,
    entity_type text NOT NULL,
    entity_id uuid NOT NULL,
    status text NOT NULL,
    detail text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: job_board_staging; Type: TABLE; Schema: syntra; Owner: -
--

CREATE TABLE syntra.job_board_staging (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    title text NOT NULL,
    company_name text,
    location text,
    source_url text,
    source_name text,
    description text,
    skills jsonb DEFAULT '[]'::jsonb NOT NULL,
    employment_type text,
    remote_policy text,
    external_id text,
    discovered_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: jobs; Type: TABLE; Schema: syntra; Owner: -
--

CREATE TABLE syntra.jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text,
    company_name text,
    original_file_name text,
    file_path text,
    mime_type text,
    raw_text text,
    jd_summary text,
    required_skills jsonb DEFAULT '[]'::jsonb,
    primary_role text,
    score_threshold integer DEFAULT 60,
    skill_weights jsonb DEFAULT '{}'::jsonb,
    min_experience integer,
    max_experience integer,
    visa_requirement text,
    employment_type text,
    location text,
    remote_policy text,
    processing_status text DEFAULT 'uploaded'::text NOT NULL,
    uploaded_at timestamp with time zone DEFAULT now() NOT NULL,
    processed_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    summary_hash text,
    processing_started_at timestamp with time zone,
    processing_failed_at timestamp with time zone,
    processing_error text,
    status text DEFAULT 'Active'::text,
    source_email text,
    message_id text,
    embedding_model text,
    embedding_version text,
    source_type text,
    source_name text,
    source_url text,
    embedding public.vector(1536),
    vendor_id uuid,
    relay_thread_id character varying(255),
    mandatory_skills jsonb DEFAULT '[]'::jsonb NOT NULL,
    preferred_skills jsonb DEFAULT '[]'::jsonb NOT NULL,
    storage_key text,
    CONSTRAINT jobs_employment_type_check CHECK (((employment_type IS NULL) OR (employment_type = ANY (ARRAY['W2'::text, 'C2C'::text, '1099'::text])))),
    CONSTRAINT jobs_processing_status_check CHECK ((processing_status = ANY (ARRAY['uploaded'::text, 'processing'::text, 'processed'::text, 'failed'::text]))),
    CONSTRAINT jobs_remote_policy_check CHECK (((remote_policy IS NULL) OR (remote_policy = ANY (ARRAY['Remote'::text, 'Hybrid'::text, 'Onsite'::text]))))
);


--
-- Name: COLUMN jobs.mandatory_skills; Type: COMMENT; Schema: syntra; Owner: -
--

COMMENT ON COLUMN syntra.jobs.mandatory_skills IS 'Skills parsed as mandatory / must-have / required from the JD';


--
-- Name: COLUMN jobs.preferred_skills; Type: COMMENT; Schema: syntra; Owner: -
--

COMMENT ON COLUMN syntra.jobs.preferred_skills IS 'Skills parsed as preferred / nice-to-have from the JD';


--
-- Name: COLUMN jobs.storage_key; Type: COMMENT; Schema: syntra; Owner: -
--

COMMENT ON COLUMN syntra.jobs.storage_key IS 'Supabase Storage object key (jd bucket). Local file_path is still the primary upload path.';


--
-- Name: matches; Type: TABLE; Schema: syntra; Owner: -
--

CREATE TABLE syntra.matches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    job_id uuid NOT NULL,
    candidate_id uuid NOT NULL,
    resume_id uuid NOT NULL,
    policy_id uuid,
    match_status text DEFAULT 'requested'::text NOT NULL,
    eligibility_score numeric(5,2),
    skill_match_score numeric(5,2),
    score numeric(5,2),
    tier text,
    final_decision text,
    reasoning text,
    strengths jsonb DEFAULT '[]'::jsonb,
    gaps jsonb DEFAULT '[]'::jsonb,
    green_flags jsonb DEFAULT '[]'::jsonb,
    red_flags jsonb DEFAULT '[]'::jsonb,
    confidence_score integer,
    breakdown jsonb DEFAULT '{}'::jsonb,
    evidence jsonb DEFAULT '{}'::jsonb,
    model_name text,
    prompt_version text,
    match_requested_at timestamp with time zone,
    matched_at timestamp with time zone,
    matching_error text,
    retry_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    matching_started_at timestamp with time zone,
    matching_failed_at timestamp with time zone,
    llm_score numeric,
    score_source text,
    CONSTRAINT matches_final_decision_check CHECK (((final_decision IS NULL) OR (final_decision = ANY (ARRAY['auto_shortlist'::text, 'recruiter_review'::text, 'reject'::text])))),
    CONSTRAINT matches_match_status_check CHECK ((match_status = ANY (ARRAY['requested'::text, 'processing'::text, 'completed'::text, 'failed'::text]))),
    CONSTRAINT matches_tier_check CHECK (((tier IS NULL) OR (tier = ANY (ARRAY['strong'::text, 'moderate'::text, 'weak'::text, 'reject'::text]))))
);


--
-- Name: matching_policies; Type: TABLE; Schema: syntra; Owner: -
--

CREATE TABLE syntra.matching_policies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    policy_name text NOT NULL,
    eligibility_threshold integer NOT NULL,
    capability_weight numeric NOT NULL,
    ai_weight numeric NOT NULL,
    auto_shortlist_threshold integer NOT NULL,
    recruiter_review_threshold integer NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ml_scoring_log; Type: TABLE; Schema: syntra; Owner: -
--

CREATE TABLE syntra.ml_scoring_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    job_id uuid NOT NULL,
    resume_id uuid NOT NULL,
    candidate_id uuid,
    model_name text,
    model_version text,
    score numeric(5,2),
    tier text,
    features jsonb DEFAULT '{}'::jsonb NOT NULL,
    top_features jsonb,
    used_fallback boolean DEFAULT false NOT NULL,
    fallback_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: recruiter_review_items; Type: TABLE; Schema: syntra; Owner: -
--

CREATE TABLE syntra.recruiter_review_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    organization_id uuid,
    action_type text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    title text NOT NULL,
    message text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    source_event_type text,
    source_event_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    decided_at timestamp with time zone,
    decided_by uuid,
    decision_note text,
    CONSTRAINT recruiter_review_items_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'dismissed'::text])))
);


--
-- Name: resumes; Type: TABLE; Schema: syntra; Owner: -
--

CREATE TABLE syntra.resumes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    candidate_id uuid NOT NULL,
    original_file_name text,
    file_path text NOT NULL,
    mime_type text,
    raw_text text,
    resume_summary text,
    skills jsonb DEFAULT '[]'::jsonb,
    primary_role text,
    summary_hash text,
    years_experience integer,
    min_rate text,
    current_company text,
    "current_role" text,
    education jsonb DEFAULT '[]'::jsonb,
    experience jsonb DEFAULT '[]'::jsonb,
    total_experience text,
    version_number integer DEFAULT 1 NOT NULL,
    is_current boolean DEFAULT true NOT NULL,
    processing_status text DEFAULT 'uploaded'::text NOT NULL,
    uploaded_at timestamp with time zone DEFAULT now() NOT NULL,
    processed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    processing_started_at timestamp with time zone,
    processing_failed_at timestamp with time zone,
    processing_error text,
    profile_summary text,
    embedding_model text,
    embedding_version text,
    embedding public.vector(1536),
    status character varying(50) DEFAULT 'Active'::character varying,
    storage_key text,
    CONSTRAINT resumes_processing_status_check CHECK ((processing_status = ANY (ARRAY['uploaded'::text, 'processing'::text, 'processed'::text, 'failed'::text])))
);


--
-- Name: COLUMN resumes.storage_key; Type: COMMENT; Schema: syntra; Owner: -
--

COMMENT ON COLUMN syntra.resumes.storage_key IS 'Supabase Storage object key (resumes bucket). Local file_path is still the primary upload path.';


--
-- Name: schema_migrations; Type: TABLE; Schema: syntra; Owner: -
--

CREATE TABLE syntra.schema_migrations (
    filename text NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: syntra; Owner: -
--

CREATE TABLE syntra.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    full_name text NOT NULL,
    email text NOT NULL,
    password_hash text NOT NULL,
    company_name text,
    role text DEFAULT 'Recruiter'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT users_role_check CHECK ((role = ANY (ARRAY['Admin'::text, 'Recruiter'::text, 'Staffing Manager'::text])))
);


--
-- Name: bank_questions bank_questions_pkey; Type: CONSTRAINT; Schema: interview_agent; Owner: -
--

ALTER TABLE ONLY interview_agent.bank_questions
    ADD CONSTRAINT bank_questions_pkey PRIMARY KEY (id);


--
-- Name: calendar_events calendar_events_pkey; Type: CONSTRAINT; Schema: interview_agent; Owner: -
--

ALTER TABLE ONLY interview_agent.calendar_events
    ADD CONSTRAINT calendar_events_pkey PRIMARY KEY (id);


--
-- Name: email_activity email_activity_pkey; Type: CONSTRAINT; Schema: interview_agent; Owner: -
--

ALTER TABLE ONLY interview_agent.email_activity
    ADD CONSTRAINT email_activity_pkey PRIMARY KEY (id);


--
-- Name: integrity_signals integrity_signals_pkey; Type: CONSTRAINT; Schema: interview_agent; Owner: -
--

ALTER TABLE ONLY interview_agent.integrity_signals
    ADD CONSTRAINT integrity_signals_pkey PRIMARY KEY (id);


--
-- Name: interview_sessions interview_sessions_pkey; Type: CONSTRAINT; Schema: interview_agent; Owner: -
--

ALTER TABLE ONLY interview_agent.interview_sessions
    ADD CONSTRAINT interview_sessions_pkey PRIMARY KEY (id);


--
-- Name: reports reports_pkey; Type: CONSTRAINT; Schema: interview_agent; Owner: -
--

ALTER TABLE ONLY interview_agent.reports
    ADD CONSTRAINT reports_pkey PRIMARY KEY (id);


--
-- Name: reports reports_session_id_key; Type: CONSTRAINT; Schema: interview_agent; Owner: -
--

ALTER TABLE ONLY interview_agent.reports
    ADD CONSTRAINT reports_session_id_key UNIQUE (session_id);


--
-- Name: roster_access_tokens roster_access_tokens_pkey; Type: CONSTRAINT; Schema: interview_agent; Owner: -
--

ALTER TABLE ONLY interview_agent.roster_access_tokens
    ADD CONSTRAINT roster_access_tokens_pkey PRIMARY KEY (id);


--
-- Name: roster roster_match_id_key; Type: CONSTRAINT; Schema: interview_agent; Owner: -
--

ALTER TABLE ONLY interview_agent.roster
    ADD CONSTRAINT roster_match_id_key UNIQUE (match_id);


--
-- Name: roster roster_pkey; Type: CONSTRAINT; Schema: interview_agent; Owner: -
--

ALTER TABLE ONLY interview_agent.roster
    ADD CONSTRAINT roster_pkey PRIMARY KEY (id);


--
-- Name: session_answers session_answers_pkey; Type: CONSTRAINT; Schema: interview_agent; Owner: -
--

ALTER TABLE ONLY interview_agent.session_answers
    ADD CONSTRAINT session_answers_pkey PRIMARY KEY (id);


--
-- Name: session_answers session_answers_session_question_id_key; Type: CONSTRAINT; Schema: interview_agent; Owner: -
--

ALTER TABLE ONLY interview_agent.session_answers
    ADD CONSTRAINT session_answers_session_question_id_key UNIQUE (session_question_id);


--
-- Name: session_questions session_questions_pkey; Type: CONSTRAINT; Schema: interview_agent; Owner: -
--

ALTER TABLE ONLY interview_agent.session_questions
    ADD CONSTRAINT session_questions_pkey PRIMARY KEY (id);


--
-- Name: session_questions session_questions_session_id_sequence_key; Type: CONSTRAINT; Schema: interview_agent; Owner: -
--

ALTER TABLE ONLY interview_agent.session_questions
    ADD CONSTRAINT session_questions_session_id_sequence_key UNIQUE (session_id, sequence);


--
-- Name: session_scores session_scores_pkey; Type: CONSTRAINT; Schema: interview_agent; Owner: -
--

ALTER TABLE ONLY interview_agent.session_scores
    ADD CONSTRAINT session_scores_pkey PRIMARY KEY (id);


--
-- Name: session_scores session_scores_session_question_id_key; Type: CONSTRAINT; Schema: interview_agent; Owner: -
--

ALTER TABLE ONLY interview_agent.session_scores
    ADD CONSTRAINT session_scores_session_question_id_key UNIQUE (session_question_id);


--
-- Name: node_executions node_executions_pkey; Type: CONSTRAINT; Schema: orch; Owner: -
--

ALTER TABLE ONLY orch.node_executions
    ADD CONSTRAINT node_executions_pkey PRIMARY KEY (run_id, node_id);


--
-- Name: runs runs_pkey; Type: CONSTRAINT; Schema: orch; Owner: -
--

ALTER TABLE ONLY orch.runs
    ADD CONSTRAINT runs_pkey PRIMARY KEY (id);


--
-- Name: steps steps_pkey; Type: CONSTRAINT; Schema: orch; Owner: -
--

ALTER TABLE ONLY orch.steps
    ADD CONSTRAINT steps_pkey PRIMARY KEY (id);


--
-- Name: steps steps_run_id_seq_key; Type: CONSTRAINT; Schema: orch; Owner: -
--

ALTER TABLE ONLY orch.steps
    ADD CONSTRAINT steps_run_id_seq_key UNIQUE (run_id, seq);


--
-- Name: activities activities_org_dedupe_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activities
    ADD CONSTRAINT activities_org_dedupe_key UNIQUE (organization_id, dedupe_key);


--
-- Name: activities activities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activities
    ADD CONSTRAINT activities_pkey PRIMARY KEY (id);


--
-- Name: admin_agent_entitlements admin_agent_entitlements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_agent_entitlements
    ADD CONSTRAINT admin_agent_entitlements_pkey PRIMARY KEY (id);


--
-- Name: agent_definitions agent_definitions_name_version_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_definitions
    ADD CONSTRAINT agent_definitions_name_version_key UNIQUE (name, version);


--
-- Name: agent_definitions agent_definitions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_definitions
    ADD CONSTRAINT agent_definitions_pkey PRIMARY KEY (id);


--
-- Name: agent_policies agent_policies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_policies
    ADD CONSTRAINT agent_policies_pkey PRIMARY KEY (id);


--
-- Name: agent_runs agent_runs_org_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_runs
    ADD CONSTRAINT agent_runs_org_id_key UNIQUE (organization_id, id);


--
-- Name: agent_runs agent_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_runs
    ADD CONSTRAINT agent_runs_pkey PRIMARY KEY (id);


--
-- Name: agent_runs agent_runs_thread_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_runs
    ADD CONSTRAINT agent_runs_thread_id_key UNIQUE (thread_id);


--
-- Name: agent_steps agent_steps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_steps
    ADD CONSTRAINT agent_steps_pkey PRIMARY KEY (id);


--
-- Name: agent_steps agent_steps_run_seq_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_steps
    ADD CONSTRAINT agent_steps_run_seq_key UNIQUE (agent_run_id, seq);


--
-- Name: agent_templates agent_templates_key_version_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_templates
    ADD CONSTRAINT agent_templates_key_version_key UNIQUE (agent_key, version);


--
-- Name: agent_templates agent_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_templates
    ADD CONSTRAINT agent_templates_pkey PRIMARY KEY (id);


--
-- Name: agent_versions agent_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_versions
    ADD CONSTRAINT agent_versions_pkey PRIMARY KEY (id);


--
-- Name: approvals approvals_org_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approvals
    ADD CONSTRAINT approvals_org_id_key UNIQUE (organization_id, id);


--
-- Name: approvals approvals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approvals
    ADD CONSTRAINT approvals_pkey PRIMARY KEY (id);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: candidate_identities candidate_identities_org_type_value_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidate_identities
    ADD CONSTRAINT candidate_identities_org_type_value_key UNIQUE (organization_id, identity_type, identity_value);


--
-- Name: candidate_identities candidate_identities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidate_identities
    ADD CONSTRAINT candidate_identities_pkey PRIMARY KEY (id);


--
-- Name: candidate_profiles candidate_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidate_profiles
    ADD CONSTRAINT candidate_profiles_pkey PRIMARY KEY (id);


--
-- Name: candidate_profiles candidate_profiles_version_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidate_profiles
    ADD CONSTRAINT candidate_profiles_version_key UNIQUE (candidate_id, profile_version);


--
-- Name: candidate_skills candidate_skills_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidate_skills
    ADD CONSTRAINT candidate_skills_pkey PRIMARY KEY (candidate_id, skill_id);


--
-- Name: candidates candidates_org_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidates
    ADD CONSTRAINT candidates_org_id_key UNIQUE (organization_id, id);


--
-- Name: candidates candidates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidates
    ADD CONSTRAINT candidates_pkey PRIMARY KEY (id);


--
-- Name: channel_accounts channel_accounts_org_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.channel_accounts
    ADD CONSTRAINT channel_accounts_org_id_key UNIQUE (organization_id, id);


--
-- Name: channel_accounts channel_accounts_org_label_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.channel_accounts
    ADD CONSTRAINT channel_accounts_org_label_key UNIQUE (organization_id, label);


--
-- Name: channel_accounts channel_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.channel_accounts
    ADD CONSTRAINT channel_accounts_pkey PRIMARY KEY (id);


--
-- Name: channels channels_channel_type_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.channels
    ADD CONSTRAINT channels_channel_type_key UNIQUE (channel_type);


--
-- Name: channels channels_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.channels
    ADD CONSTRAINT channels_pkey PRIMARY KEY (id);


--
-- Name: checkpoint_blobs checkpoint_blobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checkpoint_blobs
    ADD CONSTRAINT checkpoint_blobs_pkey PRIMARY KEY (thread_id, checkpoint_ns, channel, version);


--
-- Name: checkpoint_migrations checkpoint_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checkpoint_migrations
    ADD CONSTRAINT checkpoint_migrations_pkey PRIMARY KEY (v);


--
-- Name: checkpoint_writes checkpoint_writes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checkpoint_writes
    ADD CONSTRAINT checkpoint_writes_pkey PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx);


--
-- Name: checkpoints checkpoints_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checkpoints
    ADD CONSTRAINT checkpoints_pkey PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id);


--
-- Name: documents documents_entity_version_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_entity_version_key UNIQUE (organization_id, entity_type, entity_id, version);


--
-- Name: documents documents_org_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_org_id_key UNIQUE (organization_id, id);


--
-- Name: documents documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_pkey PRIMARY KEY (id);


--
-- Name: duplicate_reviews duplicate_reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.duplicate_reviews
    ADD CONSTRAINT duplicate_reviews_pkey PRIMARY KEY (id);


--
-- Name: email_classifications email_classifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_classifications
    ADD CONSTRAINT email_classifications_pkey PRIMARY KEY (message_id);


--
-- Name: email_messages email_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_messages
    ADD CONSTRAINT email_messages_pkey PRIMARY KEY (id);


--
-- Name: email_threads email_threads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_threads
    ADD CONSTRAINT email_threads_pkey PRIMARY KEY (thread_id);


--
-- Name: embeddings embeddings_entity_model_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.embeddings
    ADD CONSTRAINT embeddings_entity_model_key UNIQUE (organization_id, entity_type, entity_id, entity_version, model);


--
-- Name: embeddings embeddings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.embeddings
    ADD CONSTRAINT embeddings_pkey PRIMARY KEY (id);


--
-- Name: event_outbox event_outbox_event_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_outbox
    ADD CONSTRAINT event_outbox_event_id_key UNIQUE (event_id);


--
-- Name: event_outbox event_outbox_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_outbox
    ADD CONSTRAINT event_outbox_pkey PRIMARY KEY (id);


--
-- Name: event_registry event_registry_event_type_schema_version_consumer_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_registry
    ADD CONSTRAINT event_registry_event_type_schema_version_consumer_key UNIQUE (event_type, schema_version, consumer);


--
-- Name: event_registry event_registry_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_registry
    ADD CONSTRAINT event_registry_pkey PRIMARY KEY (id);


--
-- Name: event_schemas event_schemas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_schemas
    ADD CONSTRAINT event_schemas_pkey PRIMARY KEY (event_type, schema_version);


--
-- Name: events events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_pkey PRIMARY KEY (event_id);


--
-- Name: failed_workflows failed_workflows_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.failed_workflows
    ADD CONSTRAINT failed_workflows_pkey PRIMARY KEY (id);


--
-- Name: followups followups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.followups
    ADD CONSTRAINT followups_pkey PRIMARY KEY (id);


--
-- Name: graph_definitions graph_definitions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.graph_definitions
    ADD CONSTRAINT graph_definitions_pkey PRIMARY KEY (id);


--
-- Name: graph_event_bindings graph_event_bindings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.graph_event_bindings
    ADD CONSTRAINT graph_event_bindings_pkey PRIMARY KEY (id);


--
-- Name: graph_versions graph_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.graph_versions
    ADD CONSTRAINT graph_versions_pkey PRIMARY KEY (id);


--
-- Name: ingestion_events ingestion_events_account_ref_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ingestion_events
    ADD CONSTRAINT ingestion_events_account_ref_key UNIQUE NULLS NOT DISTINCT (channel_account_id, external_ref);


--
-- Name: ingestion_events ingestion_events_org_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ingestion_events
    ADD CONSTRAINT ingestion_events_org_id_key UNIQUE (organization_id, id);


--
-- Name: ingestion_events ingestion_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ingestion_events
    ADD CONSTRAINT ingestion_events_pkey PRIMARY KEY (id);


--
-- Name: job_descriptions job_descriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_descriptions
    ADD CONSTRAINT job_descriptions_pkey PRIMARY KEY (id);


--
-- Name: job_vector_embeddings job_vector_embeddings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_vector_embeddings
    ADD CONSTRAINT job_vector_embeddings_pkey PRIMARY KEY (job_id);


--
-- Name: jobs jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jobs
    ADD CONSTRAINT jobs_pkey PRIMARY KEY (id);


--
-- Name: match_jobs match_jobs_org_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_jobs
    ADD CONSTRAINT match_jobs_org_id_key UNIQUE (organization_id, id);


--
-- Name: match_jobs match_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_jobs
    ADD CONSTRAINT match_jobs_pkey PRIMARY KEY (id);


--
-- Name: match_results match_results_job_candidate_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_results
    ADD CONSTRAINT match_results_job_candidate_key UNIQUE (match_job_id, candidate_id);


--
-- Name: match_results match_results_job_rank_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_results
    ADD CONSTRAINT match_results_job_rank_key UNIQUE (match_job_id, rank);


--
-- Name: match_results match_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_results
    ADD CONSTRAINT match_results_pkey PRIMARY KEY (id);


--
-- Name: matching_policies matching_policies_org_version_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.matching_policies
    ADD CONSTRAINT matching_policies_org_version_key UNIQUE NULLS NOT DISTINCT (organization_id, version);


--
-- Name: matching_policies matching_policies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.matching_policies
    ADD CONSTRAINT matching_policies_pkey PRIMARY KEY (id);


--
-- Name: ml_shadow_logs ml_shadow_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ml_shadow_logs
    ADD CONSTRAINT ml_shadow_logs_pkey PRIMARY KEY (id);


--
-- Name: module_dependency module_dependency_event_type_target_module_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.module_dependency
    ADD CONSTRAINT module_dependency_event_type_target_module_key UNIQUE (event_type, target_module);


--
-- Name: module_dependency module_dependency_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.module_dependency
    ADD CONSTRAINT module_dependency_pkey PRIMARY KEY (id);


--
-- Name: node_registry node_registry_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.node_registry
    ADD CONSTRAINT node_registry_pkey PRIMARY KEY (registry_key);


--
-- Name: orbit_activities orbit_activities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orbit_activities
    ADD CONSTRAINT orbit_activities_pkey PRIMARY KEY (id);


--
-- Name: orbit_interviews orbit_interviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orbit_interviews
    ADD CONSTRAINT orbit_interviews_pkey PRIMARY KEY (id);


--
-- Name: orbit_lifecycle_states orbit_lifecycle_states_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orbit_lifecycle_states
    ADD CONSTRAINT orbit_lifecycle_states_pkey PRIMARY KEY (id);


--
-- Name: orbit_placements orbit_placements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orbit_placements
    ADD CONSTRAINT orbit_placements_pkey PRIMARY KEY (id);


--
-- Name: orbit_revenue_arrangements orbit_revenue_arrangements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orbit_revenue_arrangements
    ADD CONSTRAINT orbit_revenue_arrangements_pkey PRIMARY KEY (id);


--
-- Name: orbit_submissions orbit_submissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orbit_submissions
    ADD CONSTRAINT orbit_submissions_pkey PRIMARY KEY (id);


--
-- Name: orchestration_artifacts orchestration_artifacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orchestration_artifacts
    ADD CONSTRAINT orchestration_artifacts_pkey PRIMARY KEY (organization_id, kind, natural_key);


--
-- Name: orchestration_job_pins orchestration_job_pins_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orchestration_job_pins
    ADD CONSTRAINT orchestration_job_pins_pkey PRIMARY KEY (boss_job_id);


--
-- Name: orchestration_runs orchestration_runs_event_id_workflow_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orchestration_runs
    ADD CONSTRAINT orchestration_runs_event_id_workflow_name_key UNIQUE (event_id, workflow_name);


--
-- Name: orchestration_runs orchestration_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orchestration_runs
    ADD CONSTRAINT orchestration_runs_pkey PRIMARY KEY (run_id);


--
-- Name: orchestration_steps orchestration_steps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orchestration_steps
    ADD CONSTRAINT orchestration_steps_pkey PRIMARY KEY (step_id);


--
-- Name: organizations organizations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_pkey PRIMARY KEY (id);


--
-- Name: parties parties_org_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parties
    ADD CONSTRAINT parties_org_id_key UNIQUE (organization_id, id);


--
-- Name: parties parties_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parties
    ADD CONSTRAINT parties_pkey PRIMARY KEY (id);


--
-- Name: prism_approvals prism_approvals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prism_approvals
    ADD CONSTRAINT prism_approvals_pkey PRIMARY KEY (id);


--
-- Name: prism_audit prism_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prism_audit
    ADD CONSTRAINT prism_audit_pkey PRIMARY KEY (id);


--
-- Name: prism_consents prism_consents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prism_consents
    ADD CONSTRAINT prism_consents_pkey PRIMARY KEY (id);


--
-- Name: prism_rtr prism_rtr_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prism_rtr
    ADD CONSTRAINT prism_rtr_pkey PRIMARY KEY (id);


--
-- Name: prism_submissions prism_submissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prism_submissions
    ADD CONSTRAINT prism_submissions_pkey PRIMARY KEY (id);


--
-- Name: processed_events processed_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.processed_events
    ADD CONSTRAINT processed_events_pkey PRIMARY KEY (event_id, consumer);


--
-- Name: recruiter_review_items recruiter_review_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recruiter_review_items
    ADD CONSTRAINT recruiter_review_items_pkey PRIMARY KEY (id);


--
-- Name: requirement_skills requirement_skills_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.requirement_skills
    ADD CONSTRAINT requirement_skills_pkey PRIMARY KEY (requirement_id, skill_id);


--
-- Name: requirements requirements_org_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.requirements
    ADD CONSTRAINT requirements_org_id_key UNIQUE (organization_id, id);


--
-- Name: requirements requirements_org_idempotency_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.requirements
    ADD CONSTRAINT requirements_org_idempotency_key UNIQUE (organization_id, idempotency_key);


--
-- Name: requirements requirements_org_ingestion_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.requirements
    ADD CONSTRAINT requirements_org_ingestion_key UNIQUE (organization_id, ingestion_id);


--
-- Name: requirements requirements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.requirements
    ADD CONSTRAINT requirements_pkey PRIMARY KEY (id);


--
-- Name: resume_vector_embeddings resume_vector_embeddings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resume_vector_embeddings
    ADD CONSTRAINT resume_vector_embeddings_pkey PRIMARY KEY (resume_id);


--
-- Name: skill_aliases skill_aliases_org_alias_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_aliases
    ADD CONSTRAINT skill_aliases_org_alias_key UNIQUE NULLS NOT DISTINCT (organization_id, alias);


--
-- Name: skill_aliases skill_aliases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_aliases
    ADD CONSTRAINT skill_aliases_pkey PRIMARY KEY (id);


--
-- Name: skills skills_canonical_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skills
    ADD CONSTRAINT skills_canonical_name_key UNIQUE (canonical_name);


--
-- Name: skills skills_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skills
    ADD CONSTRAINT skills_pkey PRIMARY KEY (id);


--
-- Name: users users_org_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_org_email_key UNIQUE (organization_id, email);


--
-- Name: users users_org_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_org_id_key UNIQUE (organization_id, id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: vendors vendors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendors
    ADD CONSTRAINT vendors_pkey PRIMARY KEY (id);


--
-- Name: email_classifications email_classifications_pkey; Type: CONSTRAINT; Schema: relay; Owner: -
--

ALTER TABLE ONLY relay.email_classifications
    ADD CONSTRAINT email_classifications_pkey PRIMARY KEY (message_id);


--
-- Name: email_messages email_messages_pkey; Type: CONSTRAINT; Schema: relay; Owner: -
--

ALTER TABLE ONLY relay.email_messages
    ADD CONSTRAINT email_messages_pkey PRIMARY KEY (id);


--
-- Name: email_threads email_threads_pkey; Type: CONSTRAINT; Schema: relay; Owner: -
--

ALTER TABLE ONLY relay.email_threads
    ADD CONSTRAINT email_threads_pkey PRIMARY KEY (thread_id);


--
-- Name: followups followups_pkey; Type: CONSTRAINT; Schema: relay; Owner: -
--

ALTER TABLE ONLY relay.followups
    ADD CONSTRAINT followups_pkey PRIMARY KEY (id);


--
-- Name: candidates candidates_pkey; Type: CONSTRAINT; Schema: syntra; Owner: -
--

ALTER TABLE ONLY syntra.candidates
    ADD CONSTRAINT candidates_pkey PRIMARY KEY (id);


--
-- Name: event_log event_log_pkey; Type: CONSTRAINT; Schema: syntra; Owner: -
--

ALTER TABLE ONLY syntra.event_log
    ADD CONSTRAINT event_log_pkey PRIMARY KEY (id);


--
-- Name: job_board_staging job_board_staging_pkey; Type: CONSTRAINT; Schema: syntra; Owner: -
--

ALTER TABLE ONLY syntra.job_board_staging
    ADD CONSTRAINT job_board_staging_pkey PRIMARY KEY (id);


--
-- Name: jobs jobs_pkey; Type: CONSTRAINT; Schema: syntra; Owner: -
--

ALTER TABLE ONLY syntra.jobs
    ADD CONSTRAINT jobs_pkey PRIMARY KEY (id);


--
-- Name: matches matches_pkey; Type: CONSTRAINT; Schema: syntra; Owner: -
--

ALTER TABLE ONLY syntra.matches
    ADD CONSTRAINT matches_pkey PRIMARY KEY (id);


--
-- Name: matching_policies matching_policies_pkey; Type: CONSTRAINT; Schema: syntra; Owner: -
--

ALTER TABLE ONLY syntra.matching_policies
    ADD CONSTRAINT matching_policies_pkey PRIMARY KEY (id);


--
-- Name: matching_policies matching_policies_policy_name_key; Type: CONSTRAINT; Schema: syntra; Owner: -
--

ALTER TABLE ONLY syntra.matching_policies
    ADD CONSTRAINT matching_policies_policy_name_key UNIQUE (policy_name);


--
-- Name: ml_scoring_log ml_scoring_log_pkey; Type: CONSTRAINT; Schema: syntra; Owner: -
--

ALTER TABLE ONLY syntra.ml_scoring_log
    ADD CONSTRAINT ml_scoring_log_pkey PRIMARY KEY (id);


--
-- Name: recruiter_review_items recruiter_review_items_pkey; Type: CONSTRAINT; Schema: syntra; Owner: -
--

ALTER TABLE ONLY syntra.recruiter_review_items
    ADD CONSTRAINT recruiter_review_items_pkey PRIMARY KEY (id);


--
-- Name: resumes resumes_pkey; Type: CONSTRAINT; Schema: syntra; Owner: -
--

ALTER TABLE ONLY syntra.resumes
    ADD CONSTRAINT resumes_pkey PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: syntra; Owner: -
--

ALTER TABLE ONLY syntra.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (filename);


--
-- Name: matches unique_job_resume_match; Type: CONSTRAINT; Schema: syntra; Owner: -
--

ALTER TABLE ONLY syntra.matches
    ADD CONSTRAINT unique_job_resume_match UNIQUE (job_id, resume_id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: syntra; Owner: -
--

ALTER TABLE ONLY syntra.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: syntra; Owner: -
--

ALTER TABLE ONLY syntra.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: idx_bank_questions_job; Type: INDEX; Schema: interview_agent; Owner: -
--

CREATE INDEX idx_bank_questions_job ON interview_agent.bank_questions USING btree (job_id);


--
-- Name: idx_calendar_events_roster; Type: INDEX; Schema: interview_agent; Owner: -
--

CREATE INDEX idx_calendar_events_roster ON interview_agent.calendar_events USING btree (roster_id);


--
-- Name: idx_calendar_events_start; Type: INDEX; Schema: interview_agent; Owner: -
--

CREATE INDEX idx_calendar_events_start ON interview_agent.calendar_events USING btree (start_time DESC);


--
-- Name: idx_email_activity_roster; Type: INDEX; Schema: interview_agent; Owner: -
--

CREATE INDEX idx_email_activity_roster ON interview_agent.email_activity USING btree (roster_id);


--
-- Name: idx_email_activity_sent; Type: INDEX; Schema: interview_agent; Owner: -
--

CREATE INDEX idx_email_activity_sent ON interview_agent.email_activity USING btree (sent_at DESC);


--
-- Name: idx_integrity_signals_session; Type: INDEX; Schema: interview_agent; Owner: -
--

CREATE INDEX idx_integrity_signals_session ON interview_agent.integrity_signals USING btree (session_id);


--
-- Name: idx_roster_access_tokens_active; Type: INDEX; Schema: interview_agent; Owner: -
--

CREATE INDEX idx_roster_access_tokens_active ON interview_agent.roster_access_tokens USING btree (roster_id) WHERE (revoked_at IS NULL);


--
-- Name: idx_roster_access_tokens_hash; Type: INDEX; Schema: interview_agent; Owner: -
--

CREATE UNIQUE INDEX idx_roster_access_tokens_hash ON interview_agent.roster_access_tokens USING btree (token_hash);


--
-- Name: idx_roster_access_tokens_roster; Type: INDEX; Schema: interview_agent; Owner: -
--

CREATE INDEX idx_roster_access_tokens_roster ON interview_agent.roster_access_tokens USING btree (roster_id);


--
-- Name: idx_roster_candidate; Type: INDEX; Schema: interview_agent; Owner: -
--

CREATE INDEX idx_roster_candidate ON interview_agent.roster USING btree (candidate_id);


--
-- Name: idx_roster_job; Type: INDEX; Schema: interview_agent; Owner: -
--

CREATE INDEX idx_roster_job ON interview_agent.roster USING btree (job_id);


--
-- Name: idx_roster_status; Type: INDEX; Schema: interview_agent; Owner: -
--

CREATE INDEX idx_roster_status ON interview_agent.roster USING btree (status);


--
-- Name: idx_session_questions_session; Type: INDEX; Schema: interview_agent; Owner: -
--

CREATE INDEX idx_session_questions_session ON interview_agent.session_questions USING btree (session_id);


--
-- Name: idx_sessions_roster; Type: INDEX; Schema: interview_agent; Owner: -
--

CREATE INDEX idx_sessions_roster ON interview_agent.interview_sessions USING btree (roster_id);


--
-- Name: orch_runs_trigger_idx; Type: INDEX; Schema: orch; Owner: -
--

CREATE INDEX orch_runs_trigger_idx ON orch.runs USING btree (trigger_event_id);


--
-- Name: activities_agent_run_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX activities_agent_run_idx ON public.activities USING btree (agent_run_id) WHERE (agent_run_id IS NOT NULL);


--
-- Name: activities_entity_timeline_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX activities_entity_timeline_idx ON public.activities USING btree (organization_id, entity_type, entity_id, occurred_at DESC);


--
-- Name: activities_org_occurred_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX activities_org_occurred_idx ON public.activities USING btree (organization_id, occurred_at DESC);


--
-- Name: admin_agent_entitlements_admin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX admin_agent_entitlements_admin ON public.admin_agent_entitlements USING btree (admin_id);


--
-- Name: admin_agent_entitlements_scope; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX admin_agent_entitlements_scope ON public.admin_agent_entitlements USING btree (admin_id, agent_id, COALESCE((org_id)::text, '~global~'::text));


--
-- Name: agent_definitions_active_name_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX agent_definitions_active_name_idx ON public.agent_definitions USING btree (name) WHERE is_active;


--
-- Name: agent_policies_agent_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_policies_agent_lookup ON public.agent_policies USING btree (agent_id, status);


--
-- Name: agent_policies_key_version_scope; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX agent_policies_key_version_scope ON public.agent_policies USING btree (agent_id, version, COALESCE((org_id)::text, '~global~'::text));


--
-- Name: agent_policies_one_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX agent_policies_one_active ON public.agent_policies USING btree (agent_id, COALESCE((org_id)::text, '~global~'::text)) WHERE (status = 'active'::text);


--
-- Name: agent_runs_definition_trigger_event_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX agent_runs_definition_trigger_event_idx ON public.agent_runs USING btree (agent_definition_id, trigger_event_id) WHERE (trigger_event_id IS NOT NULL);


--
-- Name: agent_runs_org_status_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_runs_org_status_created_idx ON public.agent_runs USING btree (organization_id, status, created_at DESC);


--
-- Name: agent_steps_run_seq_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_steps_run_seq_idx ON public.agent_steps USING btree (agent_run_id, seq);


--
-- Name: agent_templates_agent_id_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_templates_agent_id_lookup ON public.agent_templates USING btree (agent_id) WHERE (agent_id IS NOT NULL);


--
-- Name: agent_templates_one_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX agent_templates_one_active ON public.agent_templates USING btree (agent_key) WHERE (is_active = true);


--
-- Name: agent_versions_key_version_scope; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX agent_versions_key_version_scope ON public.agent_versions USING btree (agent_id, version, COALESCE((org_id)::text, '~global~'::text));


--
-- Name: agent_versions_policy_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_versions_policy_lookup ON public.agent_versions USING btree (policy_id);


--
-- Name: approvals_agent_run_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX approvals_agent_run_idx ON public.approvals USING btree (agent_run_id);


--
-- Name: approvals_expiry_sweep_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX approvals_expiry_sweep_idx ON public.approvals USING btree (expires_at) WHERE (status = 'PENDING'::text);


--
-- Name: approvals_pending_unique_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX approvals_pending_unique_idx ON public.approvals USING btree (agent_run_id, action_class, entity_id) NULLS NOT DISTINCT WHERE (status = 'PENDING'::text);


--
-- Name: approvals_queue_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX approvals_queue_idx ON public.approvals USING btree (organization_id, status, expires_at) WHERE (status = 'PENDING'::text);


--
-- Name: audit_logs_org_entity_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_logs_org_entity_idx ON public.audit_logs USING btree (organization_id, entity_type, entity_id, at DESC);


--
-- Name: candidate_identities_candidate_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX candidate_identities_candidate_idx ON public.candidate_identities USING btree (organization_id, candidate_id);


--
-- Name: candidate_profiles_current_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX candidate_profiles_current_idx ON public.candidate_profiles USING btree (candidate_id) WHERE is_current;


--
-- Name: candidate_skills_skill_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX candidate_skills_skill_idx ON public.candidate_skills USING btree (organization_id, skill_id);


--
-- Name: candidates_bench_aging_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX candidates_bench_aging_idx ON public.candidates USING btree (organization_id, bench_since) WHERE ((merged_into_id IS NULL) AND (deleted_at IS NULL));


--
-- Name: candidates_bench_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX candidates_bench_idx ON public.candidates USING btree (organization_id, availability, marketing_status) WHERE ((merged_into_id IS NULL) AND (deleted_at IS NULL));


--
-- Name: candidates_fts_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX candidates_fts_idx ON public.candidates USING gin (search_tsv);


--
-- Name: candidates_merged_into_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX candidates_merged_into_idx ON public.candidates USING btree (merged_into_id) WHERE (merged_into_id IS NOT NULL);


--
-- Name: candidates_name_trgm_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX candidates_name_trgm_idx ON public.candidates USING gin (full_name public.gin_trgm_ops);


--
-- Name: candidates_owner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX candidates_owner_idx ON public.candidates USING btree (organization_id, owner_user_id) WHERE ((merged_into_id IS NULL) AND (deleted_at IS NULL));


--
-- Name: candidates_rate_min_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX candidates_rate_min_idx ON public.candidates USING btree (organization_id, rate_min) WHERE ((merged_into_id IS NULL) AND (deleted_at IS NULL));


--
-- Name: channel_accounts_polling_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX channel_accounts_polling_idx ON public.channel_accounts USING btree (channel_id, last_sync_at) WHERE (status = 'ACTIVE'::text);


--
-- Name: documents_entity_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX documents_entity_idx ON public.documents USING btree (organization_id, entity_type, entity_id);


--
-- Name: documents_sha256_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX documents_sha256_idx ON public.documents USING btree (organization_id, sha256);


--
-- Name: duplicate_reviews_pair_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX duplicate_reviews_pair_idx ON public.duplicate_reviews USING btree (organization_id, LEAST(candidate_a, candidate_b), GREATEST(candidate_a, candidate_b));


--
-- Name: duplicate_reviews_pending_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX duplicate_reviews_pending_idx ON public.duplicate_reviews USING btree (organization_id, created_at DESC) WHERE (status = 'PENDING'::text);


--
-- Name: embeddings_candidate_hnsw_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX embeddings_candidate_hnsw_idx ON public.embeddings USING hnsw (embedding public.vector_cosine_ops) WITH (m='16', ef_construction='64') WHERE ((entity_type = 'CANDIDATE_PROFILE'::text) AND (model = 'voyage-3-large'::text));


--
-- Name: embeddings_requirement_lookup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX embeddings_requirement_lookup_idx ON public.embeddings USING btree (organization_id, entity_id, model, entity_version DESC) WHERE (entity_type = 'REQUIREMENT'::text);


--
-- Name: embeddings_source_hash_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX embeddings_source_hash_idx ON public.embeddings USING btree (organization_id, model, source_hash);


--
-- Name: event_outbox_org_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX event_outbox_org_id_idx ON public.event_outbox USING btree (organization_id, id);


--
-- Name: event_outbox_pending_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX event_outbox_pending_idx ON public.event_outbox USING btree (id) WHERE (published_at IS NULL);


--
-- Name: events_type_agg_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX events_type_agg_idx ON public.events USING btree (event_type, aggregate_id);


--
-- Name: failed_workflows_org_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX failed_workflows_org_created_idx ON public.failed_workflows USING btree (organization_id, created_at DESC);


--
-- Name: graph_definitions_key_version_scope; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX graph_definitions_key_version_scope ON public.graph_definitions USING btree (graph_key, version, COALESCE(org_id, '~global~'::text));


--
-- Name: graph_definitions_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX graph_definitions_lookup ON public.graph_definitions USING btree (graph_key, status);


--
-- Name: graph_definitions_one_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX graph_definitions_one_active ON public.graph_definitions USING btree (graph_key, COALESCE(org_id, '~global~'::text)) WHERE (status = 'active'::text);


--
-- Name: graph_definitions_unique_version; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX graph_definitions_unique_version ON public.graph_definitions USING btree (graph_key, COALESCE(org_id, '~global~'::text), version);


--
-- Name: graph_event_bindings_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX graph_event_bindings_lookup ON public.graph_event_bindings USING btree (event_type, status);


--
-- Name: graph_event_bindings_one_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX graph_event_bindings_one_active ON public.graph_event_bindings USING btree (event_type, COALESCE((org_id)::text, '~global~'::text)) WHERE (status = 'active'::text);


--
-- Name: idx_job_vec_emb_hnsw; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_job_vec_emb_hnsw ON public.job_vector_embeddings USING hnsw (embedding public.vector_cosine_ops);


--
-- Name: idx_jobs_source_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_jobs_source_email ON public.jobs USING btree (source_email) WHERE (source_email IS NOT NULL);


--
-- Name: idx_jobs_unique_message_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_jobs_unique_message_id ON public.jobs USING btree (message_id) WHERE (message_id IS NOT NULL);


--
-- Name: idx_orbit_activities_candidate; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orbit_activities_candidate ON public.orbit_activities USING btree (candidate_id, occurred_at DESC);


--
-- Name: idx_orbit_lifecycle_states_candidate; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orbit_lifecycle_states_candidate ON public.orbit_lifecycle_states USING btree (candidate_id, created_at DESC);


--
-- Name: idx_orbit_placements_candidate; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orbit_placements_candidate ON public.orbit_placements USING btree (candidate_id, created_at DESC);


--
-- Name: idx_orbit_placements_vendor_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orbit_placements_vendor_id ON public.orbit_placements USING btree (vendor_id);


--
-- Name: idx_orbit_revenue_arrangements_placement; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orbit_revenue_arrangements_placement ON public.orbit_revenue_arrangements USING btree (placement_id, created_at DESC);


--
-- Name: idx_prism_approvals_created_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prism_approvals_created_by ON public.prism_approvals USING btree (created_by);


--
-- Name: idx_prism_approvals_submission_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prism_approvals_submission_id ON public.prism_approvals USING btree (submission_id);


--
-- Name: idx_prism_audit_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prism_audit_created_at ON public.prism_audit USING btree (created_at DESC);


--
-- Name: idx_prism_audit_created_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prism_audit_created_by ON public.prism_audit USING btree (created_by);


--
-- Name: idx_prism_audit_entity_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prism_audit_entity_id ON public.prism_audit USING btree (entity_id);


--
-- Name: idx_prism_audit_entity_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prism_audit_entity_type ON public.prism_audit USING btree (entity_type);


--
-- Name: idx_prism_consents_created_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prism_consents_created_by ON public.prism_consents USING btree (created_by);


--
-- Name: idx_prism_consents_submission_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prism_consents_submission_id ON public.prism_consents USING btree (submission_id);


--
-- Name: idx_prism_rtr_created_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prism_rtr_created_by ON public.prism_rtr USING btree (created_by);


--
-- Name: idx_prism_rtr_submission_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prism_rtr_submission_id ON public.prism_rtr USING btree (submission_id);


--
-- Name: idx_prism_single_active_submission; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_prism_single_active_submission ON public.prism_submissions USING btree (candidate_id, job_id) WHERE (status <> ALL (ARRAY['REJECTED'::text, 'WITHDRAWN'::text]));


--
-- Name: idx_prism_submissions_candidate_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prism_submissions_candidate_id ON public.prism_submissions USING btree (candidate_id);


--
-- Name: idx_prism_submissions_created_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prism_submissions_created_by ON public.prism_submissions USING btree (created_by);


--
-- Name: idx_prism_submissions_job_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prism_submissions_job_id ON public.prism_submissions USING btree (job_id);


--
-- Name: idx_prism_submissions_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prism_submissions_status ON public.prism_submissions USING btree (status);


--
-- Name: idx_prism_submissions_status_created_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prism_submissions_status_created_by ON public.prism_submissions USING btree (status, created_by);


--
-- Name: idx_resume_vec_emb_hnsw; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_resume_vec_emb_hnsw ON public.resume_vector_embeddings USING hnsw (embedding public.vector_cosine_ops);


--
-- Name: idx_vendors_created_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vendors_created_by ON public.vendors USING btree (created_by);


--
-- Name: idx_vendors_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vendors_email ON public.vendors USING btree (email);


--
-- Name: idx_vendors_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vendors_name ON public.vendors USING btree (name);


--
-- Name: idx_vendors_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vendors_status ON public.vendors USING btree (status);


--
-- Name: ingestion_events_pending_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ingestion_events_pending_idx ON public.ingestion_events USING btree (organization_id, received_at) WHERE (status = 'PENDING'::text);


--
-- Name: ingestion_events_review_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ingestion_events_review_idx ON public.ingestion_events USING btree (organization_id, received_at DESC) WHERE (status = 'NEEDS_REVIEW'::text);


--
-- Name: match_jobs_one_running_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX match_jobs_one_running_idx ON public.match_jobs USING btree (requirement_id) WHERE (status = 'RUNNING'::text);


--
-- Name: match_jobs_org_requirement_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX match_jobs_org_requirement_idx ON public.match_jobs USING btree (organization_id, requirement_id, status);


--
-- Name: match_jobs_requirement_trigger_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX match_jobs_requirement_trigger_idx ON public.match_jobs USING btree (requirement_id, trigger_event_id) WHERE (trigger_event_id IS NOT NULL);


--
-- Name: match_results_candidate_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX match_results_candidate_idx ON public.match_results USING btree (organization_id, candidate_id);


--
-- Name: match_results_feedback_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX match_results_feedback_idx ON public.match_results USING btree (organization_id, recruiter_action, acted_at DESC) WHERE (recruiter_action IS NOT NULL);


--
-- Name: match_results_job_rank_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX match_results_job_rank_idx ON public.match_results USING btree (match_job_id, rank);


--
-- Name: matching_policies_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX matching_policies_active_idx ON public.matching_policies USING btree (organization_id) NULLS NOT DISTINCT WHERE is_active;


--
-- Name: node_registry_module_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX node_registry_module_idx ON public.node_registry USING btree (module);


--
-- Name: orbit_interviews_candidate_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX orbit_interviews_candidate_id_idx ON public.orbit_interviews USING btree (candidate_id, created_at DESC);


--
-- Name: orbit_lifecycle_states_candidate_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX orbit_lifecycle_states_candidate_id_idx ON public.orbit_lifecycle_states USING btree (candidate_id, created_at DESC);


--
-- Name: orbit_placements_candidate_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX orbit_placements_candidate_id_idx ON public.orbit_placements USING btree (candidate_id, created_at DESC);


--
-- Name: orbit_revenue_arrangements_placement_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX orbit_revenue_arrangements_placement_id_idx ON public.orbit_revenue_arrangements USING btree (placement_id, created_at DESC);


--
-- Name: orbit_submissions_candidate_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX orbit_submissions_candidate_id_idx ON public.orbit_submissions USING btree (candidate_id, created_at DESC);


--
-- Name: parties_name_trgm_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX parties_name_trgm_idx ON public.parties USING gin (name public.gin_trgm_ops);


--
-- Name: parties_org_name_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX parties_org_name_type_idx ON public.parties USING btree (organization_id, name, party_type) WHERE (deleted_at IS NULL);


--
-- Name: parties_org_type_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX parties_org_type_status_idx ON public.parties USING btree (organization_id, party_type, status) WHERE (deleted_at IS NULL);


--
-- Name: recruiter_review_pending_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX recruiter_review_pending_user_idx ON public.recruiter_review_items USING btree (user_id, status, created_at DESC) WHERE (status = 'pending'::text);


--
-- Name: recruiter_review_source_event_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX recruiter_review_source_event_idx ON public.recruiter_review_items USING btree (source_event_id) WHERE (source_event_id IS NOT NULL);


--
-- Name: requirement_skills_mandatory_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX requirement_skills_mandatory_idx ON public.requirement_skills USING btree (requirement_id) WHERE is_mandatory;


--
-- Name: requirement_skills_skill_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX requirement_skills_skill_idx ON public.requirement_skills USING btree (organization_id, skill_id);


--
-- Name: requirements_fts_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX requirements_fts_idx ON public.requirements USING gin (search_tsv);


--
-- Name: requirements_inbox_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX requirements_inbox_idx ON public.requirements USING btree (organization_id, priority, status, received_at DESC) WHERE (deleted_at IS NULL);


--
-- Name: requirements_respond_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX requirements_respond_by_idx ON public.requirements USING btree (organization_id, respond_by) WHERE ((deleted_at IS NULL) AND (respond_by IS NOT NULL));


--
-- Name: requirements_vendor_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX requirements_vendor_idx ON public.requirements USING btree (organization_id, vendor_party_id) WHERE (deleted_at IS NULL);


--
-- Name: skill_aliases_lookup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX skill_aliases_lookup_idx ON public.skill_aliases USING btree (alias, organization_id);


--
-- Name: skill_aliases_skill_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX skill_aliases_skill_idx ON public.skill_aliases USING btree (skill_id);


--
-- Name: skill_aliases_unreviewed_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX skill_aliases_unreviewed_idx ON public.skill_aliases USING btree (organization_id, created_at DESC) WHERE ((source = 'LLM'::text) AND (reviewed_at IS NULL));


--
-- Name: skills_category_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX skills_category_idx ON public.skills USING btree (category);


--
-- Name: users_org_role_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX users_org_role_idx ON public.users USING btree (organization_id, role) WHERE (deleted_at IS NULL);


--
-- Name: idx_relay_threads_correlation; Type: INDEX; Schema: relay; Owner: -
--

CREATE INDEX idx_relay_threads_correlation ON relay.email_threads USING btree (correlation_id) WHERE (correlation_id IS NOT NULL);


--
-- Name: relay_email_threads_latest_date_idx; Type: INDEX; Schema: relay; Owner: -
--

CREATE INDEX relay_email_threads_latest_date_idx ON relay.email_threads USING btree (latest_date DESC);


--
-- Name: relay_followups_status_due_idx; Type: INDEX; Schema: relay; Owner: -
--

CREATE INDEX relay_followups_status_due_idx ON relay.followups USING btree (status, due_date) WHERE ((status)::text = 'Open'::text);


--
-- Name: idx_candidates_created_by; Type: INDEX; Schema: syntra; Owner: -
--

CREATE INDEX idx_candidates_created_by ON syntra.candidates USING btree (created_by);


--
-- Name: idx_jobs_created_by; Type: INDEX; Schema: syntra; Owner: -
--

CREATE INDEX idx_jobs_created_by ON syntra.jobs USING btree (created_by);


--
-- Name: idx_jobs_source_email; Type: INDEX; Schema: syntra; Owner: -
--

CREATE INDEX idx_jobs_source_email ON syntra.jobs USING btree (source_email) WHERE (source_email IS NOT NULL);


--
-- Name: idx_jobs_unique_message_id; Type: INDEX; Schema: syntra; Owner: -
--

CREATE UNIQUE INDEX idx_jobs_unique_message_id ON syntra.jobs USING btree (message_id, COALESCE(created_by, '00000000-0000-0000-0000-000000000000'::uuid)) WHERE (message_id IS NOT NULL);


--
-- Name: idx_jobs_vendor_id; Type: INDEX; Schema: syntra; Owner: -
--

CREATE INDEX idx_jobs_vendor_id ON syntra.jobs USING btree (vendor_id);


--
-- Name: idx_matches_candidate_id; Type: INDEX; Schema: syntra; Owner: -
--

CREATE INDEX idx_matches_candidate_id ON syntra.matches USING btree (candidate_id);


--
-- Name: idx_matches_job_id; Type: INDEX; Schema: syntra; Owner: -
--

CREATE INDEX idx_matches_job_id ON syntra.matches USING btree (job_id);


--
-- Name: idx_matches_score; Type: INDEX; Schema: syntra; Owner: -
--

CREATE INDEX idx_matches_score ON syntra.matches USING btree (score DESC);


--
-- Name: idx_resumes_candidate_id; Type: INDEX; Schema: syntra; Owner: -
--

CREATE INDEX idx_resumes_candidate_id ON syntra.resumes USING btree (candidate_id);


--
-- Name: idx_syntra_jobs_relay_thread; Type: INDEX; Schema: syntra; Owner: -
--

CREATE INDEX idx_syntra_jobs_relay_thread ON syntra.jobs USING btree (relay_thread_id) WHERE (relay_thread_id IS NOT NULL);


--
-- Name: idx_syntra_jobs_storage_key; Type: INDEX; Schema: syntra; Owner: -
--

CREATE INDEX idx_syntra_jobs_storage_key ON syntra.jobs USING btree (storage_key) WHERE (storage_key IS NOT NULL);


--
-- Name: idx_syntra_resumes_storage_key; Type: INDEX; Schema: syntra; Owner: -
--

CREATE INDEX idx_syntra_resumes_storage_key ON syntra.resumes USING btree (storage_key) WHERE (storage_key IS NOT NULL);


--
-- Name: job_board_staging_user_external_idx; Type: INDEX; Schema: syntra; Owner: -
--

CREATE UNIQUE INDEX job_board_staging_user_external_idx ON syntra.job_board_staging USING btree (user_id, external_id) WHERE (external_id IS NOT NULL);


--
-- Name: job_board_staging_user_idx; Type: INDEX; Schema: syntra; Owner: -
--

CREATE INDEX job_board_staging_user_idx ON syntra.job_board_staging USING btree (user_id, discovered_at DESC);


--
-- Name: ml_scoring_log_job_resume_idx; Type: INDEX; Schema: syntra; Owner: -
--

CREATE INDEX ml_scoring_log_job_resume_idx ON syntra.ml_scoring_log USING btree (job_id, resume_id, created_at DESC);


--
-- Name: ml_scoring_log_model_version_idx; Type: INDEX; Schema: syntra; Owner: -
--

CREATE INDEX ml_scoring_log_model_version_idx ON syntra.ml_scoring_log USING btree (model_version, created_at DESC);


--
-- Name: recruiter_review_pending_user_idx; Type: INDEX; Schema: syntra; Owner: -
--

CREATE INDEX recruiter_review_pending_user_idx ON syntra.recruiter_review_items USING btree (user_id, status, created_at DESC) WHERE (status = 'pending'::text);


--
-- Name: recruiter_review_source_event_idx; Type: INDEX; Schema: syntra; Owner: -
--

CREATE INDEX recruiter_review_source_event_idx ON syntra.recruiter_review_items USING btree (source_event_id) WHERE (source_event_id IS NOT NULL);


--
-- Name: roster trg_roster_updated_at; Type: TRIGGER; Schema: interview_agent; Owner: -
--

CREATE TRIGGER trg_roster_updated_at BEFORE UPDATE ON interview_agent.roster FOR EACH ROW EXECUTE FUNCTION interview_agent.set_updated_at();


--
-- Name: agent_definitions agent_definitions_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER agent_definitions_set_updated_at BEFORE UPDATE ON public.agent_definitions FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();


--
-- Name: agent_runs agent_runs_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER agent_runs_set_updated_at BEFORE UPDATE ON public.agent_runs FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();


--
-- Name: approvals approvals_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER approvals_set_updated_at BEFORE UPDATE ON public.approvals FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();


--
-- Name: candidate_skills candidate_skills_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER candidate_skills_set_updated_at BEFORE UPDATE ON public.candidate_skills FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();


--
-- Name: candidates candidates_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER candidates_set_updated_at BEFORE UPDATE ON public.candidates FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();


--
-- Name: channel_accounts channel_accounts_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER channel_accounts_set_updated_at BEFORE UPDATE ON public.channel_accounts FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();


--
-- Name: channels channels_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER channels_set_updated_at BEFORE UPDATE ON public.channels FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();


--
-- Name: duplicate_reviews duplicate_reviews_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER duplicate_reviews_set_updated_at BEFORE UPDATE ON public.duplicate_reviews FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();


--
-- Name: event_registry event_registry_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER event_registry_updated BEFORE UPDATE ON public.event_registry FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();


--
-- Name: event_schemas event_schemas_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER event_schemas_set_updated_at BEFORE UPDATE ON public.event_schemas FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();


--
-- Name: events events_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER events_append_only BEFORE DELETE OR UPDATE ON public.events FOR EACH ROW EXECUTE FUNCTION public.prevent_event_update_delete();


--
-- Name: ingestion_events ingestion_events_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER ingestion_events_set_updated_at BEFORE UPDATE ON public.ingestion_events FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();


--
-- Name: match_jobs match_jobs_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER match_jobs_set_updated_at BEFORE UPDATE ON public.match_jobs FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();


--
-- Name: match_results match_results_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER match_results_set_updated_at BEFORE UPDATE ON public.match_results FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();


--
-- Name: matching_policies matching_policies_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER matching_policies_set_updated_at BEFORE UPDATE ON public.matching_policies FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();


--
-- Name: module_dependency module_dependency_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER module_dependency_updated BEFORE UPDATE ON public.module_dependency FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();


--
-- Name: orchestration_runs orchestration_runs_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER orchestration_runs_updated BEFORE UPDATE ON public.orchestration_runs FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();


--
-- Name: orchestration_steps orchestration_steps_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER orchestration_steps_updated BEFORE UPDATE ON public.orchestration_steps FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();


--
-- Name: organizations organizations_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER organizations_set_updated_at BEFORE UPDATE ON public.organizations FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();


--
-- Name: parties parties_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER parties_set_updated_at BEFORE UPDATE ON public.parties FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();


--
-- Name: requirements requirements_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER requirements_set_updated_at BEFORE UPDATE ON public.requirements FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();


--
-- Name: skill_aliases skill_aliases_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER skill_aliases_set_updated_at BEFORE UPDATE ON public.skill_aliases FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();


--
-- Name: skills skills_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER skills_set_updated_at BEFORE UPDATE ON public.skills FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();


--
-- Name: users users_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();


--
-- Name: bank_questions bank_questions_job_id_fkey; Type: FK CONSTRAINT; Schema: interview_agent; Owner: -
--

ALTER TABLE ONLY interview_agent.bank_questions
    ADD CONSTRAINT bank_questions_job_id_fkey FOREIGN KEY (job_id) REFERENCES syntra.jobs(id);


--
-- Name: calendar_events calendar_events_roster_id_fkey; Type: FK CONSTRAINT; Schema: interview_agent; Owner: -
--

ALTER TABLE ONLY interview_agent.calendar_events
    ADD CONSTRAINT calendar_events_roster_id_fkey FOREIGN KEY (roster_id) REFERENCES interview_agent.roster(id) ON DELETE CASCADE;


--
-- Name: email_activity email_activity_roster_id_fkey; Type: FK CONSTRAINT; Schema: interview_agent; Owner: -
--

ALTER TABLE ONLY interview_agent.email_activity
    ADD CONSTRAINT email_activity_roster_id_fkey FOREIGN KEY (roster_id) REFERENCES interview_agent.roster(id) ON DELETE SET NULL;


--
-- Name: integrity_signals integrity_signals_session_id_fkey; Type: FK CONSTRAINT; Schema: interview_agent; Owner: -
--

ALTER TABLE ONLY interview_agent.integrity_signals
    ADD CONSTRAINT integrity_signals_session_id_fkey FOREIGN KEY (session_id) REFERENCES interview_agent.interview_sessions(id);


--
-- Name: interview_sessions interview_sessions_roster_id_fkey; Type: FK CONSTRAINT; Schema: interview_agent; Owner: -
--

ALTER TABLE ONLY interview_agent.interview_sessions
    ADD CONSTRAINT interview_sessions_roster_id_fkey FOREIGN KEY (roster_id) REFERENCES interview_agent.roster(id);


--
-- Name: reports reports_session_id_fkey; Type: FK CONSTRAINT; Schema: interview_agent; Owner: -
--

ALTER TABLE ONLY interview_agent.reports
    ADD CONSTRAINT reports_session_id_fkey FOREIGN KEY (session_id) REFERENCES interview_agent.interview_sessions(id);


--
-- Name: roster_access_tokens roster_access_tokens_roster_id_fkey; Type: FK CONSTRAINT; Schema: interview_agent; Owner: -
--

ALTER TABLE ONLY interview_agent.roster_access_tokens
    ADD CONSTRAINT roster_access_tokens_roster_id_fkey FOREIGN KEY (roster_id) REFERENCES interview_agent.roster(id) ON DELETE CASCADE;


--
-- Name: roster roster_candidate_id_fkey; Type: FK CONSTRAINT; Schema: interview_agent; Owner: -
--

ALTER TABLE ONLY interview_agent.roster
    ADD CONSTRAINT roster_candidate_id_fkey FOREIGN KEY (candidate_id) REFERENCES syntra.candidates(id);


--
-- Name: roster roster_job_id_fkey; Type: FK CONSTRAINT; Schema: interview_agent; Owner: -
--

ALTER TABLE ONLY interview_agent.roster
    ADD CONSTRAINT roster_job_id_fkey FOREIGN KEY (job_id) REFERENCES syntra.jobs(id);


--
-- Name: roster roster_match_id_fkey; Type: FK CONSTRAINT; Schema: interview_agent; Owner: -
--

ALTER TABLE ONLY interview_agent.roster
    ADD CONSTRAINT roster_match_id_fkey FOREIGN KEY (match_id) REFERENCES syntra.matches(id);


--
-- Name: session_answers session_answers_session_question_id_fkey; Type: FK CONSTRAINT; Schema: interview_agent; Owner: -
--

ALTER TABLE ONLY interview_agent.session_answers
    ADD CONSTRAINT session_answers_session_question_id_fkey FOREIGN KEY (session_question_id) REFERENCES interview_agent.session_questions(id);


--
-- Name: session_questions session_questions_bank_question_id_fkey; Type: FK CONSTRAINT; Schema: interview_agent; Owner: -
--

ALTER TABLE ONLY interview_agent.session_questions
    ADD CONSTRAINT session_questions_bank_question_id_fkey FOREIGN KEY (bank_question_id) REFERENCES interview_agent.bank_questions(id);


--
-- Name: session_questions session_questions_session_id_fkey; Type: FK CONSTRAINT; Schema: interview_agent; Owner: -
--

ALTER TABLE ONLY interview_agent.session_questions
    ADD CONSTRAINT session_questions_session_id_fkey FOREIGN KEY (session_id) REFERENCES interview_agent.interview_sessions(id);


--
-- Name: session_scores session_scores_session_question_id_fkey; Type: FK CONSTRAINT; Schema: interview_agent; Owner: -
--

ALTER TABLE ONLY interview_agent.session_scores
    ADD CONSTRAINT session_scores_session_question_id_fkey FOREIGN KEY (session_question_id) REFERENCES interview_agent.session_questions(id);


--
-- Name: node_executions node_executions_run_id_fkey; Type: FK CONSTRAINT; Schema: orch; Owner: -
--

ALTER TABLE ONLY orch.node_executions
    ADD CONSTRAINT node_executions_run_id_fkey FOREIGN KEY (run_id) REFERENCES orch.runs(id) ON DELETE CASCADE;


--
-- Name: steps steps_run_id_fkey; Type: FK CONSTRAINT; Schema: orch; Owner: -
--

ALTER TABLE ONLY orch.steps
    ADD CONSTRAINT steps_run_id_fkey FOREIGN KEY (run_id) REFERENCES orch.runs(id) ON DELETE CASCADE;


--
-- Name: activities activities_organization_id_agent_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activities
    ADD CONSTRAINT activities_organization_id_agent_run_id_fkey FOREIGN KEY (organization_id, agent_run_id) REFERENCES public.agent_runs(organization_id, id);


--
-- Name: activities activities_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activities
    ADD CONSTRAINT activities_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: agent_runs agent_runs_agent_definition_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_runs
    ADD CONSTRAINT agent_runs_agent_definition_id_fkey FOREIGN KEY (agent_definition_id) REFERENCES public.agent_definitions(id);


--
-- Name: agent_runs agent_runs_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_runs
    ADD CONSTRAINT agent_runs_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: agent_runs agent_runs_organization_id_triggered_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_runs
    ADD CONSTRAINT agent_runs_organization_id_triggered_by_fkey FOREIGN KEY (organization_id, triggered_by) REFERENCES public.users(organization_id, id);


--
-- Name: agent_steps agent_steps_organization_id_agent_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_steps
    ADD CONSTRAINT agent_steps_organization_id_agent_run_id_fkey FOREIGN KEY (organization_id, agent_run_id) REFERENCES public.agent_runs(organization_id, id);


--
-- Name: agent_steps agent_steps_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_steps
    ADD CONSTRAINT agent_steps_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: approvals approvals_organization_id_agent_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approvals
    ADD CONSTRAINT approvals_organization_id_agent_run_id_fkey FOREIGN KEY (organization_id, agent_run_id) REFERENCES public.agent_runs(organization_id, id);


--
-- Name: approvals approvals_organization_id_decided_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approvals
    ADD CONSTRAINT approvals_organization_id_decided_by_fkey FOREIGN KEY (organization_id, decided_by) REFERENCES public.users(organization_id, id);


--
-- Name: approvals approvals_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approvals
    ADD CONSTRAINT approvals_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: audit_logs audit_logs_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: candidate_identities candidate_identities_organization_id_candidate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidate_identities
    ADD CONSTRAINT candidate_identities_organization_id_candidate_id_fkey FOREIGN KEY (organization_id, candidate_id) REFERENCES public.candidates(organization_id, id);


--
-- Name: candidate_identities candidate_identities_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidate_identities
    ADD CONSTRAINT candidate_identities_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: candidate_profiles candidate_profiles_organization_id_candidate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidate_profiles
    ADD CONSTRAINT candidate_profiles_organization_id_candidate_id_fkey FOREIGN KEY (organization_id, candidate_id) REFERENCES public.candidates(organization_id, id);


--
-- Name: candidate_profiles candidate_profiles_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidate_profiles
    ADD CONSTRAINT candidate_profiles_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: candidate_profiles candidate_profiles_organization_id_source_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidate_profiles
    ADD CONSTRAINT candidate_profiles_organization_id_source_document_id_fkey FOREIGN KEY (organization_id, source_document_id) REFERENCES public.documents(organization_id, id);


--
-- Name: candidate_skills candidate_skills_organization_id_candidate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidate_skills
    ADD CONSTRAINT candidate_skills_organization_id_candidate_id_fkey FOREIGN KEY (organization_id, candidate_id) REFERENCES public.candidates(organization_id, id);


--
-- Name: candidate_skills candidate_skills_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidate_skills
    ADD CONSTRAINT candidate_skills_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: candidate_skills candidate_skills_skill_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidate_skills
    ADD CONSTRAINT candidate_skills_skill_id_fkey FOREIGN KEY (skill_id) REFERENCES public.skills(id);


--
-- Name: candidates candidates_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidates
    ADD CONSTRAINT candidates_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: candidates candidates_organization_id_merged_into_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidates
    ADD CONSTRAINT candidates_organization_id_merged_into_id_fkey FOREIGN KEY (organization_id, merged_into_id) REFERENCES public.candidates(organization_id, id);


--
-- Name: candidates candidates_organization_id_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidates
    ADD CONSTRAINT candidates_organization_id_owner_user_id_fkey FOREIGN KEY (organization_id, owner_user_id) REFERENCES public.users(organization_id, id);


--
-- Name: channel_accounts channel_accounts_channel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.channel_accounts
    ADD CONSTRAINT channel_accounts_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES public.channels(id);


--
-- Name: channel_accounts channel_accounts_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.channel_accounts
    ADD CONSTRAINT channel_accounts_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: documents documents_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: documents documents_organization_id_uploaded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_organization_id_uploaded_by_fkey FOREIGN KEY (organization_id, uploaded_by) REFERENCES public.users(organization_id, id);


--
-- Name: duplicate_reviews duplicate_reviews_organization_id_approval_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.duplicate_reviews
    ADD CONSTRAINT duplicate_reviews_organization_id_approval_id_fkey FOREIGN KEY (organization_id, approval_id) REFERENCES public.approvals(organization_id, id);


--
-- Name: duplicate_reviews duplicate_reviews_organization_id_candidate_a_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.duplicate_reviews
    ADD CONSTRAINT duplicate_reviews_organization_id_candidate_a_fkey FOREIGN KEY (organization_id, candidate_a) REFERENCES public.candidates(organization_id, id);


--
-- Name: duplicate_reviews duplicate_reviews_organization_id_candidate_b_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.duplicate_reviews
    ADD CONSTRAINT duplicate_reviews_organization_id_candidate_b_fkey FOREIGN KEY (organization_id, candidate_b) REFERENCES public.candidates(organization_id, id);


--
-- Name: duplicate_reviews duplicate_reviews_organization_id_decided_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.duplicate_reviews
    ADD CONSTRAINT duplicate_reviews_organization_id_decided_by_fkey FOREIGN KEY (organization_id, decided_by) REFERENCES public.users(organization_id, id);


--
-- Name: duplicate_reviews duplicate_reviews_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.duplicate_reviews
    ADD CONSTRAINT duplicate_reviews_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: email_classifications email_classifications_candidate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_classifications
    ADD CONSTRAINT email_classifications_candidate_id_fkey FOREIGN KEY (candidate_id) REFERENCES public.candidates(id);


--
-- Name: email_classifications email_classifications_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_classifications
    ADD CONSTRAINT email_classifications_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.email_messages(id);


--
-- Name: email_classifications email_classifications_thread_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_classifications
    ADD CONSTRAINT email_classifications_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES public.email_threads(thread_id);


--
-- Name: email_classifications email_classifications_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_classifications
    ADD CONSTRAINT email_classifications_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(id);


--
-- Name: email_messages email_messages_thread_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_messages
    ADD CONSTRAINT email_messages_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES public.email_threads(thread_id);


--
-- Name: email_threads email_threads_candidate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_threads
    ADD CONSTRAINT email_threads_candidate_id_fkey FOREIGN KEY (candidate_id) REFERENCES public.candidates(id);


--
-- Name: email_threads email_threads_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_threads
    ADD CONSTRAINT email_threads_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(id);


--
-- Name: embeddings embeddings_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.embeddings
    ADD CONSTRAINT embeddings_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: event_outbox event_outbox_event_type_schema_version_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_outbox
    ADD CONSTRAINT event_outbox_event_type_schema_version_fkey FOREIGN KEY (event_type, schema_version) REFERENCES public.event_schemas(event_type, schema_version);


--
-- Name: event_outbox event_outbox_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_outbox
    ADD CONSTRAINT event_outbox_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: events events_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);


--
-- Name: followups followups_candidate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.followups
    ADD CONSTRAINT followups_candidate_id_fkey FOREIGN KEY (candidate_id) REFERENCES public.candidates(id);


--
-- Name: followups followups_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.followups
    ADD CONSTRAINT followups_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.email_messages(id);


--
-- Name: followups followups_thread_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.followups
    ADD CONSTRAINT followups_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES public.email_threads(thread_id);


--
-- Name: followups followups_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.followups
    ADD CONSTRAINT followups_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(id);


--
-- Name: ingestion_events ingestion_events_organization_id_agent_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ingestion_events
    ADD CONSTRAINT ingestion_events_organization_id_agent_run_id_fkey FOREIGN KEY (organization_id, agent_run_id) REFERENCES public.agent_runs(organization_id, id);


--
-- Name: ingestion_events ingestion_events_organization_id_channel_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ingestion_events
    ADD CONSTRAINT ingestion_events_organization_id_channel_account_id_fkey FOREIGN KEY (organization_id, channel_account_id) REFERENCES public.channel_accounts(organization_id, id);


--
-- Name: ingestion_events ingestion_events_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ingestion_events
    ADD CONSTRAINT ingestion_events_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: match_jobs match_jobs_organization_id_agent_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_jobs
    ADD CONSTRAINT match_jobs_organization_id_agent_run_id_fkey FOREIGN KEY (organization_id, agent_run_id) REFERENCES public.agent_runs(organization_id, id);


--
-- Name: match_jobs match_jobs_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_jobs
    ADD CONSTRAINT match_jobs_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: match_jobs match_jobs_organization_id_requirement_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_jobs
    ADD CONSTRAINT match_jobs_organization_id_requirement_id_fkey FOREIGN KEY (organization_id, requirement_id) REFERENCES public.requirements(organization_id, id);


--
-- Name: match_jobs match_jobs_policy_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_jobs
    ADD CONSTRAINT match_jobs_policy_id_fkey FOREIGN KEY (policy_id) REFERENCES public.matching_policies(id);


--
-- Name: match_results match_results_organization_id_acted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_results
    ADD CONSTRAINT match_results_organization_id_acted_by_fkey FOREIGN KEY (organization_id, acted_by) REFERENCES public.users(organization_id, id);


--
-- Name: match_results match_results_organization_id_candidate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_results
    ADD CONSTRAINT match_results_organization_id_candidate_id_fkey FOREIGN KEY (organization_id, candidate_id) REFERENCES public.candidates(organization_id, id);


--
-- Name: match_results match_results_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_results
    ADD CONSTRAINT match_results_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: match_results match_results_organization_id_match_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_results
    ADD CONSTRAINT match_results_organization_id_match_job_id_fkey FOREIGN KEY (organization_id, match_job_id) REFERENCES public.match_jobs(organization_id, id);


--
-- Name: matching_policies matching_policies_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.matching_policies
    ADD CONSTRAINT matching_policies_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: ml_shadow_logs ml_shadow_logs_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ml_shadow_logs
    ADD CONSTRAINT ml_shadow_logs_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.email_messages(id);


--
-- Name: orbit_interviews orbit_interviews_submission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orbit_interviews
    ADD CONSTRAINT orbit_interviews_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES public.orbit_submissions(id);


--
-- Name: orbit_placements orbit_placements_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orbit_placements
    ADD CONSTRAINT orbit_placements_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(id);


--
-- Name: orbit_revenue_arrangements orbit_revenue_arrangements_placement_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orbit_revenue_arrangements
    ADD CONSTRAINT orbit_revenue_arrangements_placement_id_fkey FOREIGN KEY (placement_id) REFERENCES public.orbit_placements(id);


--
-- Name: orchestration_runs orchestration_runs_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orchestration_runs
    ADD CONSTRAINT orchestration_runs_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(event_id);


--
-- Name: orchestration_runs orchestration_runs_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orchestration_runs
    ADD CONSTRAINT orchestration_runs_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);


--
-- Name: orchestration_steps orchestration_steps_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orchestration_steps
    ADD CONSTRAINT orchestration_steps_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.orchestration_runs(run_id);


--
-- Name: parties parties_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parties
    ADD CONSTRAINT parties_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: prism_approvals prism_approvals_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prism_approvals
    ADD CONSTRAINT prism_approvals_created_by_fkey FOREIGN KEY (created_by) REFERENCES syntra.users(id);


--
-- Name: prism_approvals prism_approvals_submission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prism_approvals
    ADD CONSTRAINT prism_approvals_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES public.prism_submissions(id) ON DELETE CASCADE;


--
-- Name: prism_audit prism_audit_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prism_audit
    ADD CONSTRAINT prism_audit_created_by_fkey FOREIGN KEY (created_by) REFERENCES syntra.users(id);


--
-- Name: prism_consents prism_consents_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prism_consents
    ADD CONSTRAINT prism_consents_created_by_fkey FOREIGN KEY (created_by) REFERENCES syntra.users(id);


--
-- Name: prism_consents prism_consents_submission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prism_consents
    ADD CONSTRAINT prism_consents_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES public.prism_submissions(id) ON DELETE CASCADE;


--
-- Name: prism_rtr prism_rtr_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prism_rtr
    ADD CONSTRAINT prism_rtr_created_by_fkey FOREIGN KEY (created_by) REFERENCES syntra.users(id);


--
-- Name: prism_rtr prism_rtr_submission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prism_rtr
    ADD CONSTRAINT prism_rtr_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES public.prism_submissions(id) ON DELETE CASCADE;


--
-- Name: prism_submissions prism_submissions_candidate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prism_submissions
    ADD CONSTRAINT prism_submissions_candidate_id_fkey FOREIGN KEY (candidate_id) REFERENCES syntra.candidates(id);


--
-- Name: prism_submissions prism_submissions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prism_submissions
    ADD CONSTRAINT prism_submissions_created_by_fkey FOREIGN KEY (created_by) REFERENCES syntra.users(id);


--
-- Name: prism_submissions prism_submissions_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prism_submissions
    ADD CONSTRAINT prism_submissions_job_id_fkey FOREIGN KEY (job_id) REFERENCES syntra.jobs(id);


--
-- Name: prism_submissions prism_submissions_resume_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prism_submissions
    ADD CONSTRAINT prism_submissions_resume_id_fkey FOREIGN KEY (resume_id) REFERENCES syntra.resumes(id);


--
-- Name: requirement_skills requirement_skills_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.requirement_skills
    ADD CONSTRAINT requirement_skills_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: requirement_skills requirement_skills_organization_id_requirement_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.requirement_skills
    ADD CONSTRAINT requirement_skills_organization_id_requirement_id_fkey FOREIGN KEY (organization_id, requirement_id) REFERENCES public.requirements(organization_id, id);


--
-- Name: requirement_skills requirement_skills_skill_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.requirement_skills
    ADD CONSTRAINT requirement_skills_skill_id_fkey FOREIGN KEY (skill_id) REFERENCES public.skills(id);


--
-- Name: requirements requirements_organization_id_client_party_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.requirements
    ADD CONSTRAINT requirements_organization_id_client_party_id_fkey FOREIGN KEY (organization_id, client_party_id) REFERENCES public.parties(organization_id, id);


--
-- Name: requirements requirements_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.requirements
    ADD CONSTRAINT requirements_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: requirements requirements_organization_id_ingestion_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.requirements
    ADD CONSTRAINT requirements_organization_id_ingestion_id_fkey FOREIGN KEY (organization_id, ingestion_id) REFERENCES public.ingestion_events(organization_id, id);


--
-- Name: requirements requirements_organization_id_jd_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.requirements
    ADD CONSTRAINT requirements_organization_id_jd_document_id_fkey FOREIGN KEY (organization_id, jd_document_id) REFERENCES public.documents(organization_id, id);


--
-- Name: requirements requirements_organization_id_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.requirements
    ADD CONSTRAINT requirements_organization_id_owner_user_id_fkey FOREIGN KEY (organization_id, owner_user_id) REFERENCES public.users(organization_id, id);


--
-- Name: requirements requirements_organization_id_vendor_party_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.requirements
    ADD CONSTRAINT requirements_organization_id_vendor_party_id_fkey FOREIGN KEY (organization_id, vendor_party_id) REFERENCES public.parties(organization_id, id);


--
-- Name: requirements requirements_source_channel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.requirements
    ADD CONSTRAINT requirements_source_channel_id_fkey FOREIGN KEY (source_channel_id) REFERENCES public.channels(id);


--
-- Name: skill_aliases skill_aliases_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_aliases
    ADD CONSTRAINT skill_aliases_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: skill_aliases skill_aliases_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_aliases
    ADD CONSTRAINT skill_aliases_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.users(id);


--
-- Name: skill_aliases skill_aliases_skill_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_aliases
    ADD CONSTRAINT skill_aliases_skill_id_fkey FOREIGN KEY (skill_id) REFERENCES public.skills(id);


--
-- Name: users users_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: vendors vendors_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendors
    ADD CONSTRAINT vendors_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: email_classifications email_classifications_candidate_id_fkey; Type: FK CONSTRAINT; Schema: relay; Owner: -
--

ALTER TABLE ONLY relay.email_classifications
    ADD CONSTRAINT email_classifications_candidate_id_fkey FOREIGN KEY (candidate_id) REFERENCES syntra.candidates(id);


--
-- Name: email_classifications email_classifications_message_id_fkey; Type: FK CONSTRAINT; Schema: relay; Owner: -
--

ALTER TABLE ONLY relay.email_classifications
    ADD CONSTRAINT email_classifications_message_id_fkey FOREIGN KEY (message_id) REFERENCES relay.email_messages(id);


--
-- Name: email_classifications email_classifications_thread_id_fkey; Type: FK CONSTRAINT; Schema: relay; Owner: -
--

ALTER TABLE ONLY relay.email_classifications
    ADD CONSTRAINT email_classifications_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES relay.email_threads(thread_id);


--
-- Name: email_classifications email_classifications_vendor_id_fkey; Type: FK CONSTRAINT; Schema: relay; Owner: -
--

ALTER TABLE ONLY relay.email_classifications
    ADD CONSTRAINT email_classifications_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(id);


--
-- Name: email_messages email_messages_thread_id_fkey; Type: FK CONSTRAINT; Schema: relay; Owner: -
--

ALTER TABLE ONLY relay.email_messages
    ADD CONSTRAINT email_messages_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES relay.email_threads(thread_id);


--
-- Name: email_threads email_threads_candidate_id_fkey; Type: FK CONSTRAINT; Schema: relay; Owner: -
--

ALTER TABLE ONLY relay.email_threads
    ADD CONSTRAINT email_threads_candidate_id_fkey FOREIGN KEY (candidate_id) REFERENCES syntra.candidates(id);


--
-- Name: email_threads email_threads_vendor_id_fkey; Type: FK CONSTRAINT; Schema: relay; Owner: -
--

ALTER TABLE ONLY relay.email_threads
    ADD CONSTRAINT email_threads_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(id);


--
-- Name: followups followups_candidate_id_fkey; Type: FK CONSTRAINT; Schema: relay; Owner: -
--

ALTER TABLE ONLY relay.followups
    ADD CONSTRAINT followups_candidate_id_fkey FOREIGN KEY (candidate_id) REFERENCES syntra.candidates(id);


--
-- Name: followups followups_message_id_fkey; Type: FK CONSTRAINT; Schema: relay; Owner: -
--

ALTER TABLE ONLY relay.followups
    ADD CONSTRAINT followups_message_id_fkey FOREIGN KEY (message_id) REFERENCES relay.email_messages(id);


--
-- Name: followups followups_thread_id_fkey; Type: FK CONSTRAINT; Schema: relay; Owner: -
--

ALTER TABLE ONLY relay.followups
    ADD CONSTRAINT followups_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES relay.email_threads(thread_id);


--
-- Name: followups followups_vendor_id_fkey; Type: FK CONSTRAINT; Schema: relay; Owner: -
--

ALTER TABLE ONLY relay.followups
    ADD CONSTRAINT followups_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(id);


--
-- Name: candidates candidates_created_by_fkey; Type: FK CONSTRAINT; Schema: syntra; Owner: -
--

ALTER TABLE ONLY syntra.candidates
    ADD CONSTRAINT candidates_created_by_fkey FOREIGN KEY (created_by) REFERENCES syntra.users(id);


--
-- Name: jobs jobs_created_by_fkey; Type: FK CONSTRAINT; Schema: syntra; Owner: -
--

ALTER TABLE ONLY syntra.jobs
    ADD CONSTRAINT jobs_created_by_fkey FOREIGN KEY (created_by) REFERENCES syntra.users(id);


--
-- Name: jobs jobs_vendor_id_fkey; Type: FK CONSTRAINT; Schema: syntra; Owner: -
--

ALTER TABLE ONLY syntra.jobs
    ADD CONSTRAINT jobs_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(id);


--
-- Name: matches matches_candidate_id_fkey; Type: FK CONSTRAINT; Schema: syntra; Owner: -
--

ALTER TABLE ONLY syntra.matches
    ADD CONSTRAINT matches_candidate_id_fkey FOREIGN KEY (candidate_id) REFERENCES syntra.candidates(id) ON DELETE CASCADE;


--
-- Name: matches matches_job_id_fkey; Type: FK CONSTRAINT; Schema: syntra; Owner: -
--

ALTER TABLE ONLY syntra.matches
    ADD CONSTRAINT matches_job_id_fkey FOREIGN KEY (job_id) REFERENCES syntra.jobs(id) ON DELETE CASCADE;


--
-- Name: matches matches_policy_id_fkey; Type: FK CONSTRAINT; Schema: syntra; Owner: -
--

ALTER TABLE ONLY syntra.matches
    ADD CONSTRAINT matches_policy_id_fkey FOREIGN KEY (policy_id) REFERENCES syntra.matching_policies(id);


--
-- Name: matches matches_resume_id_fkey; Type: FK CONSTRAINT; Schema: syntra; Owner: -
--

ALTER TABLE ONLY syntra.matches
    ADD CONSTRAINT matches_resume_id_fkey FOREIGN KEY (resume_id) REFERENCES syntra.resumes(id) ON DELETE CASCADE;


--
-- Name: matching_policies matching_policies_created_by_fkey; Type: FK CONSTRAINT; Schema: syntra; Owner: -
--

ALTER TABLE ONLY syntra.matching_policies
    ADD CONSTRAINT matching_policies_created_by_fkey FOREIGN KEY (created_by) REFERENCES syntra.users(id);


--
-- Name: resumes resumes_candidate_id_fkey; Type: FK CONSTRAINT; Schema: syntra; Owner: -
--

ALTER TABLE ONLY syntra.resumes
    ADD CONSTRAINT resumes_candidate_id_fkey FOREIGN KEY (candidate_id) REFERENCES syntra.candidates(id) ON DELETE CASCADE;


--
-- Name: activities; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.activities ENABLE ROW LEVEL SECURITY;

--
-- Name: admin_agent_entitlements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.admin_agent_entitlements ENABLE ROW LEVEL SECURITY;

--
-- Name: admin_agent_entitlements admin_agent_entitlements_migrator; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_agent_entitlements_migrator ON public.admin_agent_entitlements TO syntra_migrator USING (true) WITH CHECK (true);


--
-- Name: admin_agent_entitlements admin_agent_entitlements_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_agent_entitlements_read ON public.admin_agent_entitlements FOR SELECT TO syntra_relay, syntra_app USING (true);


--
-- Name: agent_definitions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.agent_definitions ENABLE ROW LEVEL SECURITY;

--
-- Name: agent_policies; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.agent_policies ENABLE ROW LEVEL SECURITY;

--
-- Name: agent_policies agent_policies_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY agent_policies_delete ON public.agent_policies FOR DELETE TO syntra_relay, syntra_app USING ((((org_id IS NOT NULL) AND (org_id = (NULLIF(current_setting('app.org_id'::text, true), ''::text))::uuid)) OR ((org_id IS NULL) AND ((NULLIF(current_setting('app.org_id'::text, true), ''::text))::uuid IS NULL))));


--
-- Name: agent_policies agent_policies_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY agent_policies_insert ON public.agent_policies FOR INSERT TO syntra_relay, syntra_app WITH CHECK ((((org_id IS NOT NULL) AND (org_id = (NULLIF(current_setting('app.org_id'::text, true), ''::text))::uuid)) OR ((org_id IS NULL) AND ((NULLIF(current_setting('app.org_id'::text, true), ''::text))::uuid IS NULL))));


--
-- Name: agent_policies agent_policies_migrator; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY agent_policies_migrator ON public.agent_policies TO syntra_migrator USING (true) WITH CHECK (true);


--
-- Name: agent_policies agent_policies_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY agent_policies_read ON public.agent_policies FOR SELECT TO syntra_relay, syntra_app USING (((org_id IS NULL) OR (org_id = (NULLIF(current_setting('app.org_id'::text, true), ''::text))::uuid)));


--
-- Name: agent_policies agent_policies_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY agent_policies_update ON public.agent_policies FOR UPDATE TO syntra_relay, syntra_app USING ((((org_id IS NOT NULL) AND (org_id = (NULLIF(current_setting('app.org_id'::text, true), ''::text))::uuid)) OR ((org_id IS NULL) AND ((NULLIF(current_setting('app.org_id'::text, true), ''::text))::uuid IS NULL)))) WITH CHECK ((((org_id IS NOT NULL) AND (org_id = (NULLIF(current_setting('app.org_id'::text, true), ''::text))::uuid)) OR ((org_id IS NULL) AND ((NULLIF(current_setting('app.org_id'::text, true), ''::text))::uuid IS NULL))));


--
-- Name: agent_runs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.agent_runs ENABLE ROW LEVEL SECURITY;

--
-- Name: agent_steps; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.agent_steps ENABLE ROW LEVEL SECURITY;

--
-- Name: agent_templates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.agent_templates ENABLE ROW LEVEL SECURITY;

--
-- Name: agent_templates agent_templates_migrator; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY agent_templates_migrator ON public.agent_templates TO syntra_migrator USING (true) WITH CHECK (true);


--
-- Name: agent_templates agent_templates_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY agent_templates_read ON public.agent_templates FOR SELECT TO syntra_relay, syntra_app USING (true);


--
-- Name: agent_versions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.agent_versions ENABLE ROW LEVEL SECURITY;

--
-- Name: agent_versions agent_versions_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY agent_versions_delete ON public.agent_versions FOR DELETE TO syntra_relay, syntra_app USING ((((org_id IS NOT NULL) AND (org_id = (NULLIF(current_setting('app.org_id'::text, true), ''::text))::uuid)) OR ((org_id IS NULL) AND ((NULLIF(current_setting('app.org_id'::text, true), ''::text))::uuid IS NULL))));


--
-- Name: agent_versions agent_versions_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY agent_versions_insert ON public.agent_versions FOR INSERT TO syntra_relay, syntra_app WITH CHECK ((((org_id IS NOT NULL) AND (org_id = (NULLIF(current_setting('app.org_id'::text, true), ''::text))::uuid)) OR ((org_id IS NULL) AND ((NULLIF(current_setting('app.org_id'::text, true), ''::text))::uuid IS NULL))));


--
-- Name: agent_versions agent_versions_migrator; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY agent_versions_migrator ON public.agent_versions TO syntra_migrator USING (true) WITH CHECK (true);


--
-- Name: agent_versions agent_versions_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY agent_versions_read ON public.agent_versions FOR SELECT TO syntra_relay, syntra_app USING (((org_id IS NULL) OR (org_id = (NULLIF(current_setting('app.org_id'::text, true), ''::text))::uuid)));


--
-- Name: agent_versions agent_versions_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY agent_versions_update ON public.agent_versions FOR UPDATE TO syntra_relay, syntra_app USING ((((org_id IS NOT NULL) AND (org_id = (NULLIF(current_setting('app.org_id'::text, true), ''::text))::uuid)) OR ((org_id IS NULL) AND ((NULLIF(current_setting('app.org_id'::text, true), ''::text))::uuid IS NULL)))) WITH CHECK ((((org_id IS NOT NULL) AND (org_id = (NULLIF(current_setting('app.org_id'::text, true), ''::text))::uuid)) OR ((org_id IS NULL) AND ((NULLIF(current_setting('app.org_id'::text, true), ''::text))::uuid IS NULL))));


--
-- Name: approvals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.approvals ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: candidate_identities; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.candidate_identities ENABLE ROW LEVEL SECURITY;

--
-- Name: candidate_profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.candidate_profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: candidate_skills; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.candidate_skills ENABLE ROW LEVEL SECURITY;

--
-- Name: candidates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.candidates ENABLE ROW LEVEL SECURITY;

--
-- Name: channel_accounts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.channel_accounts ENABLE ROW LEVEL SECURITY;

--
-- Name: channels; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.channels ENABLE ROW LEVEL SECURITY;

--
-- Name: documents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

--
-- Name: duplicate_reviews; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.duplicate_reviews ENABLE ROW LEVEL SECURITY;

--
-- Name: embeddings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.embeddings ENABLE ROW LEVEL SECURITY;

--
-- Name: event_outbox; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.event_outbox ENABLE ROW LEVEL SECURITY;

--
-- Name: event_schemas; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.event_schemas ENABLE ROW LEVEL SECURITY;

--
-- Name: graph_definitions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.graph_definitions ENABLE ROW LEVEL SECURITY;

--
-- Name: graph_definitions graph_definitions_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY graph_definitions_delete ON public.graph_definitions FOR DELETE TO syntra_relay, syntra_app USING (((org_id IS NULL) OR (org_id = NULLIF(current_setting('app.org_id'::text, true), ''::text))));


--
-- Name: graph_definitions graph_definitions_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY graph_definitions_insert ON public.graph_definitions FOR INSERT TO syntra_relay, syntra_app WITH CHECK (((org_id IS NULL) OR (org_id = NULLIF(current_setting('app.org_id'::text, true), ''::text))));


--
-- Name: graph_definitions graph_definitions_migrator; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY graph_definitions_migrator ON public.graph_definitions TO syntra_migrator USING (true) WITH CHECK (true);


--
-- Name: graph_definitions graph_definitions_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY graph_definitions_read ON public.graph_definitions FOR SELECT TO syntra_relay, syntra_app USING (((org_id IS NULL) OR (org_id = NULLIF(current_setting('app.org_id'::text, true), ''::text))));


--
-- Name: graph_definitions graph_definitions_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY graph_definitions_update ON public.graph_definitions FOR UPDATE TO syntra_relay, syntra_app USING (((org_id IS NULL) OR (org_id = NULLIF(current_setting('app.org_id'::text, true), ''::text)))) WITH CHECK (((org_id IS NULL) OR (org_id = NULLIF(current_setting('app.org_id'::text, true), ''::text))));


--
-- Name: graph_versions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.graph_versions ENABLE ROW LEVEL SECURITY;

--
-- Name: graph_versions graph_versions_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY graph_versions_delete ON public.graph_versions FOR DELETE TO syntra_relay, syntra_app USING (((org_id IS NULL) OR (org_id = NULLIF(current_setting('app.org_id'::text, true), ''::text))));


--
-- Name: graph_versions graph_versions_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY graph_versions_insert ON public.graph_versions FOR INSERT TO syntra_relay, syntra_app WITH CHECK (((org_id IS NULL) OR (org_id = NULLIF(current_setting('app.org_id'::text, true), ''::text))));


--
-- Name: graph_versions graph_versions_migrator; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY graph_versions_migrator ON public.graph_versions TO syntra_migrator USING (true) WITH CHECK (true);


--
-- Name: graph_versions graph_versions_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY graph_versions_read ON public.graph_versions FOR SELECT TO syntra_relay, syntra_app USING (((org_id IS NULL) OR (org_id = NULLIF(current_setting('app.org_id'::text, true), ''::text))));


--
-- Name: graph_versions graph_versions_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY graph_versions_update ON public.graph_versions FOR UPDATE TO syntra_relay, syntra_app USING (((org_id IS NULL) OR (org_id = NULLIF(current_setting('app.org_id'::text, true), ''::text)))) WITH CHECK (((org_id IS NULL) OR (org_id = NULLIF(current_setting('app.org_id'::text, true), ''::text))));


--
-- Name: ingestion_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ingestion_events ENABLE ROW LEVEL SECURITY;

--
-- Name: match_jobs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.match_jobs ENABLE ROW LEVEL SECURITY;

--
-- Name: match_results; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.match_results ENABLE ROW LEVEL SECURITY;

--
-- Name: matching_policies; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.matching_policies ENABLE ROW LEVEL SECURITY;

--
-- Name: organizations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

--
-- Name: parties; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.parties ENABLE ROW LEVEL SECURITY;

--
-- Name: processed_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.processed_events ENABLE ROW LEVEL SECURITY;

--
-- Name: requirement_skills; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.requirement_skills ENABLE ROW LEVEL SECURITY;

--
-- Name: requirements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.requirements ENABLE ROW LEVEL SECURITY;

--
-- Name: skill_aliases; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.skill_aliases ENABLE ROW LEVEL SECURITY;

--
-- Name: skills; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.skills ENABLE ROW LEVEL SECURITY;

--
-- Name: users; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--


