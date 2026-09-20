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

/**
 * What a node hands the runtime to publish. The id is optional: left out,
 * the runtime derives it from the run, the step, the type and the position,
 * so a re-run step emits the SAME event and the outbox refuses the copy
 * (workflow/deterministic-id.ts). Supplied, it is used as given — for the
 * legacy module nodes that still mint their own.
 */
export type EmitInput = Omit<EventInput, 'event_id'> & { event_id?: string };

export type NodeEvents = {
  emit: (event: EmitInput) => void;
};

/**
 * Deps injected per node (design §4.1).
 * `llm` is an optional seam only — resume-intake nodes must NOT call it.
 * Syntra peer work uses HTTP; persistence uses `db`.
 */
export type NodeCtx = {
  orgId: string;
  /**
   * The step's id in THIS graph, e.g. "process" — not the node key.
   *
   * The same implementation runs at several ids across graphs, so it cannot
   * know its own position from the registry. The contract bridge needs it to
   * file this step's output in the run context under the right name.
   */
  nodeId: string;
  /**
   * The workflow this step is running in. A step that parks the run needs
   * to say which workflow to resume; nothing else should branch on it.
   */
  graphKey?: string;
  config: Record<string, unknown>;
  logger: NodeLogger;
  /** Optional future seam. Do not require for backbone / resume-intake. */
  llm?: LLMClient;
  db: NodeDb;
  events: NodeEvents;
  /**
   * Aborted when the node has used up its time (node-timeout.ts). A node
   * that forwards this to its HTTP call stops promptly; one that ignores it
   * keeps running in the background and its result is dropped.
   */
  signal: AbortSignal;
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
   * Graph conditionalEdges.map keys must match the outcomes that node declares.
   */
  branch_key?: string | null;
  /**
   * What each step produced, filed under its step id — the run context.
   *
   * A later step reads from it by position: `process.jobId`. Accumulates down
   * the run and is checkpointed, so it holds keys and small derived values
   * only, never payloads.
   */
  steps?: Record<string, unknown>;
};

export type NodeImpl = ((
  state: SyntraGraphState,
  ctx: NodeCtx,
) => Promise<Partial<SyntraGraphState>>) & {
  /**
   * What the node declared about running itself — set by the contract bridge,
   * absent on a legacy engine function. The compiler reads `timeoutMs` here;
   * a function that declares nothing gets ORCH_NODE_TIMEOUT_MS.
   */
  execution?: { timeoutMs: number };
  /**
   * The contract's config schema, so the compiler can refuse a bad setting
   * when the definition is COMPILED — at go-live, or the first load — rather
   * than when the step first runs in a live workflow. Absent on a legacy
   * engine function, which declares nothing.
   */
  configSchema?: { safeParse: (v: unknown) => { success: boolean; error?: unknown } };
};

export type NodeFactory = () => NodeImpl;
