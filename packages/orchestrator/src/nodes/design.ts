import { createHash } from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import { interrupt } from '@langchain/langgraph';
import { EVENT_TYPES } from '@tekisho/domain';
import type {
  CandidateProfile,
  MatchHit,
  NodeImpl,
} from './types.js';

const PARSER_VERSION = 'orch.deterministic.v1';

const SKILL_LEXICON = [
  'javascript',
  'typescript',
  'python',
  'java',
  'react',
  'node',
  'nodejs',
  'aws',
  'azure',
  'sql',
  'postgres',
  'kubernetes',
  'docker',
  'golang',
  'go',
  'rust',
  'c#',
  'csharp',
  '.net',
  'angular',
  'vue',
  'spark',
  'kafka',
  'terraform',
];

/** Ensure orch-owned artifact table (no LLM, no Syntra FK coupling). */
export async function ensureOrchArtifacts(client: {
  query: (sql: string, params?: unknown[]) => Promise<unknown>;
}): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS orchestration_artifacts (
      organization_id text NOT NULL,
      kind            text NOT NULL,
      natural_key     text NOT NULL,
      payload         jsonb NOT NULL,
      updated_at      timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (organization_id, kind, natural_key)
    )
  `);
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function asStringList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string' && x.length > 0);
}

function extractSkills(text: string, explicit: string[]): string[] {
  const found = new Set(explicit.map((s) => s.toLowerCase().trim()).filter(Boolean));
  const lower = text.toLowerCase();
  for (const skill of SKILL_LEXICON) {
    if (lower.includes(skill)) found.add(skill === 'nodejs' ? 'node' : skill);
  }
  return [...found].sort();
}

function yearsFromText(text: string): number | null {
  const m = text.match(/(\d+)\+?\s*(?:years?|yrs?)\b/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function scoreOverlap(candidateSkills: string[], required: string[]): {
  score: number;
  matched: string[];
  missing: string[];
} {
  const cand = new Set(candidateSkills.map((s) => s.toLowerCase()));
  const req = required.map((s) => s.toLowerCase()).filter(Boolean);
  if (req.length === 0) {
    return { score: candidateSkills.length > 0 ? 0.5 : 0, matched: [], missing: [] };
  }
  const matched = req.filter((s) => cand.has(s));
  const missing = req.filter((s) => !cand.has(s));
  return {
    score: Math.round((matched.length / req.length) * 1000) / 1000,
    matched,
    missing,
  };
}

/**
 * cv.summarize — deterministic structured profile from event payload / raw text.
 * Does NOT call LLM (design: orchestrator must not depend on a model).
 */
export const cvSummarize: NodeImpl = async (state, ctx) => {
  const p = state.trigger_event?.payload ?? {};
  const candidateId =
    asString(p.candidateId) ?? asString(p.candidate_id) ?? uuidv4();
  const documentId = asString(p.document_id) ?? asString(p.documentId);
  const resumeId = asString(p.resumeId) ?? asString(p.resume_id);
  const rawText = asString(p.rawText) ?? asString(p.raw_text) ?? '';
  const explicitSkills = asStringList(p.skills);

  const skills = extractSkills(rawText, explicitSkills);
  const years = yearsFromText(rawText);
  const summary =
    asString(p.summary) ??
    (skills.length
      ? `Profile with skills: ${skills.slice(0, 8).join(', ')}`
      : `Profile for candidate ${candidateId} (no skills extracted)`);

  const profile: CandidateProfile = {
    candidateId,
    documentId,
    resumeId,
    summary,
    skills,
    yearsExperience: years,
    parserVersion: PARSER_VERSION,
  };

  ctx.logger.info('cv.summarize', {
    candidateId,
    skillCount: skills.length,
    parserVersion: PARSER_VERSION,
  });

  if (state.trigger_event) {
    ctx.events.emit({
      event_id: uuidv4(),
      event_type: EVENT_TYPES.PROFILE_PREPARED,
      aggregate_id: candidateId,
      aggregate_type: 'candidate',
      organization_id: ctx.orgId,
      correlation_id: state.trigger_event.correlation_id,
      payload: {
        candidate_id: candidateId,
        candidate_profile_id: uuidv4(),
        profile_version: 1,
        parser_version: PARSER_VERSION,
        skills,
        summary,
        document_id: documentId ?? null,
        resume_id: resumeId ?? null,
      },
    });
  }

  return {
    profile,
    result: `cv.summarize:${candidateId}:skills=${skills.length}`,
  };
};

/**
 * cv.embed — content fingerprint only (no embedding model / no LLM).
 * Real pgvector can plug in later via HTTP sidecar without changing the key.
 */
export const cvEmbed: NodeImpl = async (state, ctx) => {
  const profile = state.profile;
  if (!profile) {
    ctx.logger.info('cv.embed skipped — no profile');
    return { result: state.result ? `${state.result}|cv.embed:skip` : 'cv.embed:skip' };
  }
  const fingerprint = createHash('sha256')
    .update(JSON.stringify({ skills: profile.skills, summary: profile.summary }))
    .digest('hex')
    .slice(0, 32);
  ctx.logger.info('cv.embed fingerprint', { fingerprint });
  return {
    result: state.result
      ? `${state.result}|cv.embed:${fingerprint}`
      : `cv.embed:${fingerprint}`,
  };
};

/**
 * jd.match — skill overlap (deterministic). If jobId+resumeId present, also
 * records a pending Syntra-style pair for persist; never calls LLM.
 */
export const jdMatch: NodeImpl = async (state, ctx) => {
  const p = state.trigger_event?.payload ?? {};
  const topK = Number(ctx.config.topK ?? 10);
  const profile = state.profile;
  const jobId = asString(p.jobId) ?? asString(p.requirement_id) ?? asString(p.job_id);
  const resumeId =
    profile?.resumeId ?? asString(p.resumeId) ?? asString(p.resume_id) ?? 'unknown';
  const candidateId = profile?.candidateId ?? asString(p.candidateId);
  const required = asStringList(p.requiredSkills).length
    ? asStringList(p.requiredSkills)
    : asStringList(p.skills); // JD skills may arrive as skills on match events

  const candidateSkills = profile?.skills ?? asStringList(p.candidateSkills);
  const { score, matched, missing } = scoreOverlap(candidateSkills, required);

  const hits: MatchHit[] = jobId
    ? [
        {
          jobId,
          resumeId,
          candidateId,
          score,
          matchedSkills: matched,
          missingSkills: missing,
        },
      ].slice(0, topK)
    : [];

  ctx.logger.info('jd.match', {
    topK,
    hits: hits.length,
    score: hits[0]?.score ?? null,
  });

  return {
    matches: hits,
    result: state.result
      ? `${state.result}|jd.match:${hits.length}`
      : `jd.match:${hits.length}`,
  };
};

/**
 * match.persist — idempotent upsert into orchestration_artifacts + emit
 * syntra.match.completed. No LLM. No match_jobs FK required.
 */
export const matchPersist: NodeImpl = async (state, ctx) => {
  const matches = state.matches ?? [];
  const trigger = state.trigger_event;

  await ctx.db.withOrg(async (client) => {
    await ensureOrchArtifacts(client);

    if (state.profile) {
      const key = state.profile.candidateId;
      await client.query(
        `INSERT INTO orchestration_artifacts (organization_id, kind, natural_key, payload, updated_at)
         VALUES ($1, 'profile', $2, $3::jsonb, now())
         ON CONFLICT (organization_id, kind, natural_key)
         DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()`,
        [ctx.orgId, key, JSON.stringify(state.profile)],
      );
    }

    for (const m of matches) {
      const key = `${m.jobId}:${m.resumeId}`;
      await client.query(
        `INSERT INTO orchestration_artifacts (organization_id, kind, natural_key, payload, updated_at)
         VALUES ($1, 'match', $2, $3::jsonb, now())
         ON CONFLICT (organization_id, kind, natural_key)
         DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()`,
        [ctx.orgId, key, JSON.stringify(m)],
      );
    }
  });

  if (trigger) {
    for (const m of matches) {
      ctx.events.emit({
        event_id: uuidv4(),
        event_type: EVENT_TYPES.MATCH_COMPLETED,
        aggregate_id: m.jobId,
        aggregate_type: 'job',
        organization_id: ctx.orgId,
        correlation_id: trigger.correlation_id,
        payload: {
          jobId: m.jobId,
          resumeId: m.resumeId,
          candidateId: m.candidateId,
          skillMatchScore: m.score,
          result_count: matches.length,
          top_score: m.score,
          matched_skills: m.matchedSkills,
          missing_skills: m.missingSkills,
          status: 'COMPLETED',
        },
      });
    }
  }

  ctx.logger.info('match.persist', { count: matches.length });
  return {
    result: state.result
      ? `${state.result}|match.persist:${matches.length}`
      : `match.persist:${matches.length}`,
  };
};

/** Remaining design nodes — structural only; no LLM. */

export const humanGate: NodeImpl = async (state, ctx) => {
  const reason = String(ctx.config.reason ?? 'human_review');

  // Emit approval signal before parking (audit / UI). Job will still succeed (PARKED).
  ctx.events.emit({
    event_id: uuidv4(),
    event_type: EVENT_TYPES.APPROVAL_REQUESTED,
    aggregate_id: state.trigger_event?.aggregate_id ?? uuidv4(),
    aggregate_type: state.trigger_event?.aggregate_type ?? 'approval',
    organization_id: ctx.orgId,
    correlation_id:
      state.trigger_event?.correlation_id ??
      state.trigger_event?.event_id ??
      uuidv4(),
    payload: {
      reason,
      gate: 'human.gate',
      source_event_id: state.trigger_event?.event_id,
    },
  });

  // Design §9.2 — parks checkpoint; resume via Command({ resume })
  const decision = interrupt({
    reason,
    gate: 'human.gate',
    orgId: ctx.orgId,
  }) as { approved?: boolean; note?: string } | string | boolean;

  return {
    result: `human.gate:resumed:${typeof decision === 'object' ? JSON.stringify(decision) : String(decision)}`,
  };
};

export const eventEmit: NodeImpl = async (state, ctx) => {
  const eventType = String(ctx.config.eventType ?? '');
  if (!eventType) throw new Error('event.emit requires config.eventType');
  ctx.events.emit({
    event_id: uuidv4(),
    event_type: eventType,
    aggregate_id: state.trigger_event?.aggregate_id ?? uuidv4(),
    aggregate_type: state.trigger_event?.aggregate_type ?? 'event',
    organization_id: ctx.orgId,
    correlation_id:
      state.trigger_event?.correlation_id ??
      state.trigger_event?.event_id ??
      uuidv4(),
    payload:
      (ctx.config.payload as Record<string, unknown>) ??
      state.trigger_event?.payload ??
      {},
  });
  return { result: `event.emit:${eventType}` };
};

/** Persist failure signal into orchestration_artifacts (failed_workflows written by dispatcher). */
export const recordFailure: NodeImpl = async (state, ctx) => {
  const p = state.trigger_event?.payload ?? {};
  await ctx.db.withOrg(async (client) => {
    await ensureOrchArtifacts(client);
    const key = String(
      p.agent_run_id ?? state.trigger_event?.event_id ?? uuidv4(),
    );
    await client.query(
      `INSERT INTO orchestration_artifacts (organization_id, kind, natural_key, payload, updated_at)
       VALUES ($1, 'agent_failure', $2, $3::jsonb, now())
       ON CONFLICT (organization_id, kind, natural_key)
       DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()`,
      [ctx.orgId, key, JSON.stringify(p)],
    );
  });
  ctx.logger.info('system.record_failure', { key: p.agent_run_id });
  return { result: `system.record_failure:${String(p.agent_run_id ?? 'unknown')}` };
};
