/**
 * Choose the trigger AFTER the shape is known, not before it.
 *
 * THE ORDER WAS BACKWARDS, AND IT PRODUCED A REAL BLUNDER.
 *
 * Screen 2 ranked catalogue events against the author's sentence, picked the
 * best on word overlap, and only then generated the steps. So at the moment of
 * choosing, nothing knew what the workflow would do. Asked to "match the
 * candidates for a job requirement", it picked `syntra.match.completed` — the
 * event announcing that matching has ALREADY FINISHED — to start a workflow
 * whose job is matching. Word overlap cannot tell an outcome from an input;
 * both contain "match".
 *
 * The graph does not depend on the trigger — `generateGraphFromLlm` takes the
 * request, the catalogue and the node registry, and never sees it. So the
 * shape can be built first and the trigger chosen against it, which is what
 * this does.
 *
 * TWO SIGNALS THE WORDS CANNOT GIVE:
 *
 *   1. A step publishes it.  Then it cannot be the trigger — the workflow
 *      would restart itself for ever. This is an exclusion, not a penalty.
 *
 *   2. The payload feeds the first step.  Every step's input is built from the
 *      trigger payload, so an event carrying the fields the first step
 *      requires is a better door than one that does not, however many words it
 *      shares. This is the signal that tells `match.requested` (carries
 *      `jobId`, which `syntra.match.process` requires) from `match.completed`.
 *
 * WHAT THIS DOES NOT DO. It does not invent a trigger, and it does not reorder
 * on a hunch: an event with nothing to separate it keeps the order the word
 * matcher gave it. The ranking is reported in the ledger, so a reordering is
 * something the author can see and disagree with rather than a silent
 * correction.
 */

/** A candidate, as the word matcher left it. */
export type RankableCandidate = {
  eventType: string;
  /** Property names the event's payload schema declares. */
  payloadFields: readonly string[];
  /** False when the schema is a placeholder nobody filled in. */
  declaresPayload: boolean;
  /** Where the word matcher put it. Lower is better. */
  wordRank: number;
};

export type RankedCandidate = RankableCandidate & {
  /** A step in this flow publishes it — it cannot be the trigger. */
  selfTriggering: boolean;
  /**
   * How much of what the first step needs this event carries.
   *
   * Null when it cannot be known: an event with no declared payload, or a
   * first step that requires nothing. Null is not zero — see below.
   */
  satisfies: number | null;
  /** Plain English, for the ledger. */
  why: string;
};

export function rankWithGraph(args: {
  candidates: readonly RankableCandidate[];
  /** Events the graph's steps declare they publish. */
  emittedByGraph: readonly string[];
  /**
   * Field names the FIRST step marks required.
   *
   * Usually empty, and that does NOT mean the step needs nothing. Eight of the
   * nine SYNTRA nodes state their requirement as a zod `.refine` — "candidateId
   * or candidate_id" — because the same input arrives under different names
   * from different producers. `z.toJSONSchema` drops `.refine` silently, so the
   * registry's `required` array is empty for all of them.
   */
  firstStepRequires: readonly string[];
  /**
   * Every field name the first step ACCEPTS, from its schema's properties.
   *
   * This survives the conversion, and it is what makes the ranking work at all.
   * `syntra.bench.alert` accepts resumeId, candidateId, document_id,
   * candidate_id and candidate_profile_id; of eleven SYNTRA events only
   * `profile.prepared` and `resume.received` carry any of them, and
   * `match.completed` — the one being wrongly suggested — carries none.
   */
  firstStepAccepts?: readonly string[];
  /** The first step's key, for the explanation. */
  firstStepImpl?: string | null;
}): RankedCandidate[] {
  const emitted = new Set(args.emittedByGraph);
  const required = args.firstStepRequires;
  const accepts = args.firstStepAccepts ?? [];

  const scored: RankedCandidate[] = args.candidates.map((c) => {
    const selfTriggering = emitted.has(c.eventType);

    /**
     * Null, not zero, when there is nothing to measure.
     *
     * An event whose schema nobody wrote is not an event that carries nothing
     * — eight of them are placeholders written at boot. Scoring those as zero
     * would push every undocumented event to the bottom for a fault in the
     * catalogue rather than in the event, which is the same mistake the
     * inputs_available check was careful to avoid.
     */
    /**
     * Two measures, and which one applies depends on what the step declared.
     *
     * `required` is the strong one and is almost never present, for the reason
     * given above. `accepts` is what remains, and it is enough: an event
     * carrying none of the names a step accepts cannot feed it, whatever words
     * they share.
     *
     * Null stays reserved for genuinely unknowable — an event whose payload
     * nobody described, or a step that declares no input shape at all. Null is
     * not zero: eight schemas are boot-written placeholders, and scoring those
     * zero would punish a gap in the catalogue harder than a real mismatch.
     */
    const step = args.firstStepImpl ?? "the first step";
    let satisfies: number | null;
    let fitWhy: string;

    if (!c.declaresPayload) {
      satisfies = null;
      fitWhy = "its payload is not described, so what it carries cannot be checked";
    } else if (required.length > 0) {
      const hit = required.filter((f) => c.payloadFields.includes(f)).length;
      satisfies = hit / required.length;
      fitWhy =
        satisfies === 1
          ? `carries everything ${step} requires`
          : satisfies === 0
            ? `carries none of what ${step} requires`
            : `carries ${Math.round(satisfies * 100)}% of what ${step} requires`;
    } else if (accepts.length > 0) {
      const hits = accepts.filter((f) => c.payloadFields.includes(f));
      satisfies = hits.length > 0 ? 1 : 0;
      fitWhy =
        hits.length > 0
          ? `carries ${hits.join(", ")}, which ${step} reads`
          : `carries nothing ${step} can read`;
    } else {
      satisfies = null;
      fitWhy = `${step} declares no inputs, so any trigger carries enough`;
    }

    const why = selfTriggering
      ? "a step in this workflow publishes it, so it would restart itself"
      : fitWhy;

    return { ...c, selfTriggering, satisfies, why };
  });

  /**
   * Self-triggering last, then best-fed first, then the word matcher's order.
   *
   * The word rank is the tiebreak rather than the tiebroken: it is the weakest
   * signal of the three and is only left deciding when the other two have
   * nothing to say — which, for a catalogue where most payloads are described,
   * is rare.
   */
  /**
   * UNKNOWN SITS BETWEEN A PROVEN FIT AND A PROVEN MISFIT.
   *
   * The first version sorted `null` to the bottom, which contradicted the
   * reason `null` exists at all: an event whose payload nobody described is
   * not an event that carries nothing. Ranking it below one measured to carry
   * none of what the step needs would punish a gap in the catalogue harder
   * than a genuine mismatch.
   *
   * So: anything measured to help outranks unknown, unknown outranks anything
   * measured not to help, and word order settles the rest.
   */
  const fitRank = (s: number | null) => (s === null ? -1 : s > 0 ? 1 : -2);

  return [...scored].sort((a, b) => {
    if (a.selfTriggering !== b.selfTriggering) return a.selfTriggering ? 1 : -1;

    const tier = fitRank(b.satisfies) - fitRank(a.satisfies);
    if (tier !== 0) return tier;

    // Inside the measured tier, more of what the step needs wins.
    if (a.satisfies !== null && b.satisfies !== null && a.satisfies !== b.satisfies) {
      return b.satisfies - a.satisfies;
    }
    return a.wordRank - b.wordRank;
  });
}
