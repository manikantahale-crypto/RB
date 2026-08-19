import type { PoolClient } from 'pg';
import type { EventInput } from '../types.js';
import type { LLMClient } from '../llm/types.js';

export type NodeLogger = {
  info: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
};

export type NodeDb = {
  withOrg: <T>(fn: (client: PoolClient) => Promise<T>) => Promise<T>;
};

export type NodeEvents = {
  emit: (event: EventInput) => void;
};

/**
 * Deps injected per node (design §4.1).
 * `llm` is an optional seam only — resume-intake nodes must NOT call it.
 * Syntra peer work uses HTTP; persistence uses `db`.
 */
export type NodeCtx = {
  orgId: string;
  config: Record<string, unknown>;
  logger: NodeLogger;
  /** Optional future seam. Do not require for backbone / resume-intake. */
  llm?: LLMClient;
  db: NodeDb;
  events: NodeEvents;
};

export type CandidateProfile = {
  candidateId: string;
  documentId?: string;
  resumeId?: string;
  summary: string;
  skills: string[];
  yearsExperience: number | null;
  parserVersion: string;
};

export type MatchHit = {
  jobId: string;
  resumeId: string;
  candidateId?: string;
  score: number;
  matchedSkills: string[];
  missingSkills: string[];
};

/** Shared LangGraph state for Syntra adapters + resume.intake. */
export type SyntraGraphState = {
  result: string;
  _emittedEvents: EventInput[];
  trigger_event: EventInput | null;
  profile: CandidateProfile | null;
  matches: MatchHit[];
  /** Audit spine — set by WorkflowRunner when agent_runs insert succeeds. */
  agent_run_id: string | null;
  errorsSoft?: Array<{ nodeId: string; class: string; message: string }>;
  /**
   * Conditional-edge router key set by orch.branch.decision (or route).
   * Graph conditionalEdges.map keys must match (pass | human_review | reject).
   */
  branch_key?: string | null;
};

export type NodeImpl = (
  state: SyntraGraphState,
  ctx: NodeCtx,
) => Promise<Partial<SyntraGraphState>>;

export type NodeFactory = () => NodeImpl;
