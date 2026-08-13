import { z } from 'zod';

/** Long-run agent tool seam (agent_definitions.allowed_tools). No LLM required. */
export type ToolContext = {
  orgId: string;
  /** Opaque deps — DB pool, emit buffer, etc. Injected by agent runtime later. */
  deps?: Record<string, unknown>;
};

export type ToolResult = {
  ok: boolean;
  data?: unknown;
  error?: string;
};

export type ToolDefinition = {
  name: string;
  description: string;
  /** Side-effect class aligned with agent_definitions.autonomy keys. */
  actionClass:
    | 'READ'
    | 'INTERNAL_WRITE'
    | 'DATA_SHAPING'
    | 'CONTROL'
    | 'EXTERNAL_COMM';
  inputSchema: z.ZodType<unknown>;
  execute: (input: unknown, ctx: ToolContext) => Promise<ToolResult>;
};

const empty = z.object({}).passthrough();

function ok(data: unknown): ToolResult {
  return { ok: true, data };
}

/** Day-1 tools named in R__seed_agent_definitions — deterministic stubs. */
export const builtinTools: ToolDefinition[] = [
  {
    name: 'extract_document_text',
    description: 'Extract plain text from a stored document reference',
    actionClass: 'READ',
    inputSchema: z.object({ document_id: z.string().uuid().optional(), rawText: z.string().optional() }),
    async execute(input) {
      const p = input as { document_id?: string; rawText?: string };
      return ok({ text: p.rawText ?? '', document_id: p.document_id ?? null });
    },
  },
  {
    name: 'parse_resume',
    description: 'Deterministic resume parse into skills/summary (no LLM)',
    actionClass: 'READ',
    inputSchema: empty,
    async execute(input) {
      const p = (input ?? {}) as Record<string, unknown>;
      const text = String(p.rawText ?? p.text ?? '');
      const skills = (String(p.skills ?? '') || text)
        .toLowerCase()
        .split(/[^a-z0-9+#.]/)
        .filter(Boolean)
        .slice(0, 20);
      return ok({ summary: text.slice(0, 240), skills: [...new Set(skills)] });
    },
  },
  {
    name: 'parse_jd',
    description: 'Deterministic JD parse (no LLM)',
    actionClass: 'READ',
    inputSchema: empty,
    async execute(input) {
      const p = (input ?? {}) as Record<string, unknown>;
      return ok({
        title: p.title ?? null,
        requiredSkills: p.requiredSkills ?? p.skills ?? [],
      });
    },
  },
  {
    name: 'normalize_skills',
    description: 'Lowercase/dedupe skill tokens',
    actionClass: 'READ',
    inputSchema: z.object({ skills: z.array(z.string()).default([]) }),
    async execute(input) {
      const { skills } = input as { skills: string[] };
      return ok({
        skills: [...new Set(skills.map((s) => s.toLowerCase().trim()).filter(Boolean))],
      });
    },
  },
  {
    name: 'generate_embedding',
    description: 'Placeholder fingerprint — real vectors via HTTP sidecar later',
    actionClass: 'INTERNAL_WRITE',
    inputSchema: z.object({ text: z.string().default('') }),
    async execute(input) {
      const { text } = input as { text: string };
      let h = 0;
      for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
      return ok({ dims: 8, vector: Array.from({ length: 8 }, (_, i) => ((h >> i) & 1) * 0.1) });
    },
  },
  {
    name: 'upsert_embedding',
    description: 'Record embedding upsert intent (persist elsewhere)',
    actionClass: 'INTERNAL_WRITE',
    inputSchema: empty,
    async execute(input) {
      return ok({ upserted: true, ref: input });
    },
  },
  {
    name: 'search_bench_hybrid',
    description: 'Stub hybrid search — returns empty ranked list',
    actionClass: 'READ',
    inputSchema: empty,
    async execute() {
      return ok({ hits: [] });
    },
  },
  {
    name: 'deduplicate_candidates',
    description: 'Identity dedup stub — pass-through',
    actionClass: 'DATA_SHAPING',
    inputSchema: empty,
    async execute(input) {
      return ok({ status: 'UNIQUE', input });
    },
  },
  {
    name: 'calculate_match_score',
    description: 'Skill-overlap score 0..1',
    actionClass: 'READ',
    inputSchema: z.object({
      candidateSkills: z.array(z.string()).default([]),
      requiredSkills: z.array(z.string()).default([]),
    }),
    async execute(input) {
      const { candidateSkills, requiredSkills } = input as {
        candidateSkills: string[];
        requiredSkills: string[];
      };
      const cand = new Set(candidateSkills.map((s) => s.toLowerCase()));
      const req = requiredSkills.map((s) => s.toLowerCase()).filter(Boolean);
      const matched = req.filter((s) => cand.has(s));
      const score = req.length ? matched.length / req.length : 0;
      return ok({ score, matched, missing: req.filter((s) => !cand.has(s)) });
    },
  },
  {
    name: 'generate_match_explanation',
    description: 'Template explanation (no LLM)',
    actionClass: 'READ',
    inputSchema: empty,
    async execute(input) {
      const p = (input ?? {}) as { score?: number; matched?: string[] };
      return ok({
        explanation: `Score ${p.score ?? 0}; matched ${(p.matched ?? []).join(', ') || 'none'}`,
      });
    },
  },
  {
    name: 'persist_match_results',
    description: 'Persist match intent — orchestration_artifacts path via nodes',
    actionClass: 'INTERNAL_WRITE',
    inputSchema: empty,
    async execute(input) {
      return ok({ persisted: true, payload: input });
    },
  },
  {
    name: 'record_activity',
    description: 'Audit activity stub',
    actionClass: 'INTERNAL_WRITE',
    inputSchema: empty,
    async execute(input) {
      return ok({ recorded: true, at: new Date().toISOString(), input });
    },
  },
  {
    name: 'request_approval',
    description: 'Create approval pause signal',
    actionClass: 'CONTROL',
    inputSchema: z.object({ reason: z.string().default('approval_required') }),
    async execute(input) {
      const { reason } = input as { reason: string };
      return ok({ approval_requested: true, reason });
    },
  },
  {
    name: 'draft_communication',
    description: 'Draft-only external message (never sends)',
    actionClass: 'EXTERNAL_COMM',
    inputSchema: z.object({ template: z.string().optional(), body: z.string().optional() }),
    async execute(input) {
      return ok({ draft: true, ...(input as object), sent: false });
    },
  },
];
