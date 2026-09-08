/**
 * Screen 2 — describe a workflow, get one proposal.
 *
 * Two endpoints: `/workflows/propose` produces something to review, and
 * `/workflows/accept` turns it into a draft.
 *
 * TWO HALVES, AND THE SPLIT IS THE DESIGN.
 *
 * The GRAPH SHAPE comes from the LLM, constrained to the node registry and
 * validated against a strict schema before anyone sees it. The TRIGGER MATCH
 * does not: it is term overlap against the catalogue's own words, scored here.
 *
 * Matching is the one step where a wrong answer is SILENT — a wrong trigger
 * does not throw, it means the workflow is never started by anything, and
 * nobody finds out until they ask why nothing happened. A deterministic match
 * can cite the exact words it matched on, so a person can disagree with it.
 * A wrong graph shape, by contrast, is visible on the canvas in one glance.
 *
 * Every ledger line therefore carries `source`, so a reader can tell which
 * claims were computed and which were reasoned by a model, and hold the second
 * kind to the harder standard.
 *
 * GENERATION IS OPTIONAL, NEVER FATAL. If no client is configured, or the
 * provider is down, or the model returns something the schema rejects, the
 * proposal still comes back — with a placeholder step and a ledger line saying
 * what happened. The trigger match, the routing check and the config
 * extraction are all still worth having, and losing them because a third party
 * returned a 503 would be the wrong trade.
 *
 * WHAT TERM OVERLAP CANNOT DO, stated so nobody mistakes it for judgement: it
 * has no semantics. Two events sharing the same words rank identically even
 * when one is obviously right and the other is a coincidence. Two defences,
 * both here: words are weighted by how rare they are in the catalogue
 * (`idfOver`), and ties break on which event is actually LIVE rather than on
 * the alphabet (`compareCandidates`).
 *
 * THE REMAINING GAP IS RECALL, and it is not small. An event phrased entirely
 * differently from the request shares no word with it and is never ranked at
 * all — the ledger reports how many were dropped precisely because the number
 * is large enough to matter. Fixing that needs semantic ranking: embed each
 * catalogue entry, embed the request, rank by distance. It is NOT built, and
 * the blocker is the client surface rather than credentials — `LLMClient`
 * exposes `complete()` only, so adding `embed()` is a change to a shared
 * package and a provider-by-provider one.
 *
 * When that lands, the ranking changes and THE LEDGER MUST NOT LOSE ITS
 * CITATIONS. A distance has nothing a person can check. The intended shape is
 * to keep matched words where they exist and, where a match is semantic only,
 * cite the catalogue sentence that was compared — so every line still points at
 * something a person can read and disagree with.
 *
 * A DRAFT BINDING CANNOT BE STORED.
 * The spec says accepting creates a draft graph and a draft binding together,
 * so an orphan is unrepresentable. `graph_event_bindings` has a CHECK
 * constraint permitting only 'active' and 'retired' — a draft binding has no
 * representation, and making one active would put an unreviewed workflow into
 * production. So the chosen trigger travels INSIDE the draft definition and the
 * binding is created at go-live. The link survives; it just lives in one row
 * rather than two. Changing that means widening the constraint, which is a
 * decision about a live shared table.
 */
import type { Pool } from "pg";
import { withOrgScope } from "../with-org-scope.js";
import {
  MODULE_REGISTRY,
  type EmitDeclaration,
} from "@tekisho/node-contract";
import {
  buildPlan,
  type EventFacts,
} from "../lib/build-plan.js";
import {
  resolveAgainstExisting,
  type Resolution,
} from "../lib/resolve-before-generate.js";
import {
  decideChain,
  detectTriggeredWorkflows,
  emitsEvent,
  resolveHandoff,
  splitByModule,
  type ModuleFacts,
} from "../lib/split-cross-module.js";
import { checksumOf } from "@tekisho/graph-contract";
import {
  GenerationFailedError,
  generateGraphFromLlm,
  loadEventCatalog,
  type LLMClient,
} from "@tekisho/authoring";

type FastifyLike = { post: (path: string, handler: any) => void };

function readOrgId(headers: Record<string, unknown>): string | null {
  const raw = headers["x-org-id"];
  if (raw === undefined || raw === null || raw === "" || raw === "~global~") {
    return null;
  }
  return String(raw);
}

/**
 * Who is asking. Read for the entitlement seam below — and worth knowing that
 * this is not authentication: the admin UI sends a hardcoded `admin-local` on
 * every request. Treated as an identifier to pass along, never as proof.
 */
function readAdminId(headers: Record<string, unknown>): string | null {
  const raw = headers["x-admin-id"];
  return raw === undefined || raw === null || raw === "" ? null : String(raw);
}

/**
 * Grammar only. NO DOMAIN WORDS.
 *
 * `match`, `matched` and `matches` used to be in here, commented "too common in
 * this domain to discriminate". That reasoning is right and the remedy was
 * wrong: deleting a word does not down-weight it, it makes the events named
 * after it unreachable. `syntra.match.completed` is the most-published event in
 * the catalogue — 1016 and counting — and a description saying "match it
 * against our candidates" could not reach it, because the only word that would
 * have found it had been removed from the vocabulary.
 *
 * Commonness is now handled by `idfOver` below, which measures it from the
 * catalogue instead of guessing at it in a list.
 */
const STOP = new Set([
  "when","a","an","the","and","or","it","is","to","for","of","in","on","at","by",
  "with","that","this","then","from","as","be","are","was","our","we","if","its",
  "new","should","must","will","would","can","into","after","before","against",
]);

/**
 * Crude singular form, and crude is the right amount here.
 *
 * "candidates" not matching `candidate` is a miss nobody can explain, and it is
 * one `.replace()` away. A real stemmer would also fold "matching" into "match",
 * which is a bigger behaviour change than it looks and belongs with semantic
 * ranking rather than smuggled in beside it.
 */
export function singular(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  // Only -es after a sibilant: "matches" → "match", "boxes" → "box". A blanket
  // -es rule turns "candidates" into "candidat" while "candidate" stays whole,
  // so the plural and the singular stop matching each other — the exact miss
  // this function exists to prevent.
  if (word.length > 4 && /(?:ss|sh|ch|x|z)es$/.test(word)) return word.slice(0, -2);
  // -ss, -us and -is are not plurals: "process", "status", "analysis". Stemming
  // them mangles a word the ledger then quotes back at the reader, and a
  // citation containing "statu" reads as a broken tool rather than a match.
  if (word.length > 3 && /s$/.test(word) && !/(?:ss|us|is)$/.test(word)) {
    return word.slice(0, -1);
  }
  return word;
}

/**
 * Split a request into the part that describes the TRIGGER and the part that
 * describes the work.
 *
 * This is the difference between "what starts this" and "what it then does",
 * and lexically they are indistinguishable — which is a real problem, not a
 * theoretical one. For "When a requirement finishes intake, match it against
 * our candidates", the word "match" describes the body, yet it is the strongest
 * lexical signal in the sentence and it points at `syntra.match.*` — an event
 * that would be the wrong trigger by a wide margin.
 *
 * The old code dodged this by deleting "match" from the vocabulary, which broke
 * the opposite case: a workflow that genuinely starts when a match completes
 * could never find its trigger.
 *
 * So weight instead of delete. The compose box tells people to start with
 * "when…", so the leading clause is a stated convention rather than a guess —
 * and when someone ignores it, the first sentence is a reasonable stand-in.
 * Nothing is discarded either way; the rest of the description still counts,
 * just for less.
 */
export function splitRequest(description: string): { lead: string; rest: string } {
  const trimmed = description.trim();
  if (/^when\b/i.test(trimmed)) {
    const cut = trimmed.search(/[,.;]/);
    if (cut > 0) {
      return { lead: trimmed.slice(0, cut), rest: trimmed.slice(cut + 1) };
    }
  }
  const stop = trimmed.search(/[.;]/);
  if (stop > 0) return { lead: trimmed.slice(0, stop), rest: trimmed.slice(stop + 1) };
  return { lead: trimmed, rest: "" };
}

/** How much each of the request's own words counts. Trigger clause counts double. */
export function requestWeights(description: string): Map<string, number> {
  const { lead, rest } = splitRequest(description);
  const weights = new Map<string, number>();
  for (const t of terms(rest)) weights.set(t, 1);
  // Set after, so a word in both clauses keeps the higher weight.
  for (const t of terms(lead)) weights.set(t, 2);
  return weights;
}

export function terms(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s._-]/g, " ")
    .split(/[\s._-]+/)
    .filter((w) => w.length > 2 && !STOP.has(w))
    .map(singular);
}

/**
 * How much each word is worth, measured against this catalogue.
 *
 * A word appearing in every event's text tells you nothing about which event to
 * pick; one appearing in a single entry is almost the answer by itself. That is
 * inverse document frequency, and with 26 events it costs nothing to compute
 * honestly rather than approximate with a hand-written list that goes stale the
 * moment somebody registers an event.
 *
 * Always positive, so a common word still counts for something — the whole
 * point of the change is that "match" contributes a little rather than nothing.
 */
export function idfOver(docs: string[][]): Map<string, number> {
  const df = new Map<string, number>();
  for (const doc of docs) {
    for (const t of new Set(doc)) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const idf = new Map<string, number>();
  for (const [t, n] of df) idf.set(t, Math.log(1 + docs.length / (1 + n)));
  return idf;
}

/** A word the catalogue has never used is still evidence — of a poor fit. */
function weightOf(idf: Map<string, number>, term: string, total: number): number {
  return idf.get(term) ?? Math.log(1 + total);
}

/**
 * Score an event against the request, using the catalogue's own words.
 *
 * The score is not a probability and is not presented as one. It is not shown
 * on screen at all — a bare number invites "0.25 of what?", which is a question
 * with no useful answer. The UI shows rank, the matched words, and why the
 * others lost. This value only orders candidates and appears in tests.
 *
 * `produced_when` is part of the haystack. It is the catalogue's own answer to
 * "when is this published", which is the single most relevant sentence in the
 * row when the question is "what should start my workflow" — and it was being
 * ignored.
 *
 * NOT ROUNDED. It used to be rounded to two decimals here, which meant the
 * rounding fed the sort: 0.2487 and 0.2512 both became 0.25, tied, and the tie
 * was then broken by whatever order the rows arrived in. Round for display, if
 * ever, never before comparing.
 */
export function scoreEvent(
  request: Map<string, number>,
  ev: { eventType: string; description: string; producedWhen: string },
  idf: Map<string, number>,
  docCount: number,
): { score: number; matchedOn: string[] } {
  const haystack = new Set([
    ...terms(ev.description),
    ...terms(ev.eventType),
    ...terms(ev.producedWhen),
  ]);
  const unique = [...request.keys()].filter((t) => haystack.has(t));
  // Name matches count double: an event called `requirement.published` matching
  // the word "requirement" is a stronger signal than the same word appearing
  // somewhere in a sentence.
  const nameTerms = new Set(terms(ev.eventType));

  /**
   * Weighted by how rare each word is in this catalogue, rather than counting
   * every word as one. Flat counting is what let a coincidental pair of common
   * words tie with the right answer: two hits were two hits, whether they were
   * "requirement" and "intake" or "review" and "candidate".
   *
   * The denominator is every term you wrote, weighted the same way — so the
   * score reads as "how much of what you asked for does this event cover",
   * and a word the catalogue has never seen correctly drags every candidate
   * down instead of being silently ignored.
   */
  const earned = unique.reduce(
    (n, t) =>
      n +
      weightOf(idf, t, docCount) *
        (request.get(t) ?? 1) *
        (nameTerms.has(t) ? 2 : 1),
    0,
  );
  let asked = 0;
  for (const [t, w] of request) asked += weightOf(idf, t, docCount) * w;

  // Cite the distinctive words first — "intake" explains a match, "new" does not.
  unique.sort(
    (a, b) => weightOf(idf, b, docCount) - weightOf(idf, a, docCount),
  );
  return { score: asked === 0 ? 0 : earned / asked, matchedOn: unique };
}

/** A scored catalogue row, before it becomes a candidate on the wire. */
type Scored = {
  eventType: string;
  description: string;
  producedWhen: string;
  score: number;
  matchedOn: string[];
  /** How many times this event has actually been published. */
  publishCount: number;
  everPublished: boolean;
  /**
   * Whether the event says what it carries.
   *
   * Eight schemas are placeholders written at boot so ingress could accept
   * something nobody had described. A workflow triggered by one of those
   * cannot have its inputs checked, in the editor or at go-live — so it is a
   * worse choice than any event that describes itself, however well the words
   * happen to line up.
   */
  declaresPayload: boolean;
};

/**
 * How an event ranks against another. THE TIE-BREAK IS THE INTERESTING PART.
 *
 * Ordering used to fall through to the order rows arrived in, which was
 * `ORDER BY event_type` — alphabetical. So on a tie `astra.*` beat `orbit.*`
 * beat `syntra.*`, every time, for no reason anyone would defend out loud.
 *
 * It is tempting to replace that with "prefer the module being authored in".
 * That is worse, and it is worth writing down why, because it will be proposed
 * again: a module owns its workflows but not who reacts to its events, and
 * cross-module triggers are the normal case — three of the fourteen active
 * routes already cross a module boundary. A SYNTRA matching workflow started by
 * an ASTRA intake event is the architecture working, not a mistake to correct.
 * Ranking the author's own module first would push people away from the right
 * answer with more confidence than the alphabet did.
 *
 * So ties break on whether the event is LIVE: an event that something actually
 * publishes beats one that nothing has ever published. That is defensible in
 * both directions — a trigger nothing emits is a workflow that never runs.
 */
export function compareCandidates(a: Scored, b: Scored): number {
  /**
   * Two penalties, neither of them an exclusion.
   *
   * Never-published events are halved. Excluding them would bury an event
   * registered thirty seconds ago in the drawer, which is a legitimate thing
   * to trigger on; leaving them at full weight is how a dead event with a
   * coincidental word overlap wins a tie against a live one.
   *
   * Events that declare no payload are halved for a different reason. Word
   * overlap has no sense of quality: for "when a job requirement arrives and
   * finishes intake, match it against our candidates",
   * `ASTRA_JOB_MATCH_DISCOVERED` wins on the words JOB and MATCH — a legacy
   * event with an empty schema, so the workflow it starts can never have its
   * inputs checked. It is still offered, because sometimes it is genuinely the
   * only door; it just should not beat an event that describes itself.
   */
  const weight = (c: Scored) =>
    c.score * (c.everPublished ? 1 : 0.5) * (c.declaresPayload ? 1 : 0.5);
  const byWeight = weight(b) - weight(a);
  if (byWeight !== 0) return byWeight;
  const byLiveness = b.publishCount - a.publishCount;
  if (byLiveness !== 0) return byLiveness;
  // Last resort, and only so the output is stable between identical requests.
  return a.eventType.localeCompare(b.eventType);
}

/**
 * Why `other` ranked below `best`, in words, when the reason is knowable from
 * the data rather than from meaning.
 *
 * Deliberately narrow. Only three reasons can be stated honestly without
 * semantics, and inventing a fourth ("it is about duplicates, not intake")
 * would be the code pretending to understand the domain.
 */
export function whyBelow(best: Scored, other: Scored): string {
  if (other.everPublished === false && best.everPublished) {
    return "nothing has ever published it, so a workflow triggered on it would never run";
  }
  /**
   * Which of your words the winner had and this one did not. This is the line
   * that explains a loss when both matched the same NUMBER of words — which is
   * common, and where the previous "ranked lower on word overlap" fallback told
   * a reader nothing they could act on. Naming the word makes the disagreement
   * concrete: you can look at it and decide the ranking read your sentence
   * wrongly.
   */
  const missing = best.matchedOn.filter((w) => !other.matchedOn.includes(w));
  if (missing.length > 0) {
    return (
      `its catalogue entry does not use ${missing.map((w) => `"${w}"`).join(", ")}, ` +
      `which ${missing.length === 1 ? "is a word" : "are words"} you wrote`
    );
  }
  if (other.matchedOn.length < best.matchedOn.length) {
    return `matched fewer of your words (${other.matchedOn.length} vs ${best.matchedOn.length})`;
  }
  if (other.publishCount < best.publishCount) {
    return `matched the same words, but fires less often (${other.publishCount} vs ${best.publishCount} published)`;
  }
  return "matched the same words with less weight on the ones that distinguish events";
}

/**
 * Which events this admin is allowed to see.
 *
 * THIS IS A NO-OP TODAY AND RETURNS EVERYTHING. It exists as a single seam so
 * that when the entitlements model is decided, one function changes instead of
 * every query that reads the catalogue.
 *
 * The gap it stands in for is real: a SYNTRA-only author currently sees every
 * ASTRA and ORBIT event, can trigger on one, and can register new events into
 * the shared catalogue. What leaks is another module's design — event names,
 * their sentences, their payload shapes — not customer data, so this is a
 * tenancy problem rather than a breach. It is not fixed here because the spec
 * explicitly defers what `hasModule` reads, and `admin_agent_entitlements`
 * answers a different question ("may this admin edit this agent"), per-agent
 * rather than per-module.
 *
 * When that decision lands, filter here and nowhere else.
 */
function visibleEvents<T extends { eventType: string }>(
  rows: T[],
  _ctx: { adminId: string | null; orgId: string | null },
): T[] {
  return rows;
}

/** Numbers a person wrote, and what they most likely meant. */
function extractConfig(description: string): Array<{
  field: string;
  value: number;
  phrase: string;
}> {
  const out: Array<{ field: string; value: number; phrase: string }> = [];
  // "accept at 92", "threshold of 0.88", "at least 75%"
  const re = /(accept(?:ance)?|threshold|confidence|score)\D{0,12}(\d+(?:\.\d+)?)\s*%?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(description))) {
    const raw = Number(m[2]);
    if (!Number.isFinite(raw)) continue;
    // 92 and 0.92 mean the same thing to a person; the schema wants 0–1.
    const value = raw > 1 ? Math.round((raw / 100) * 100) / 100 : raw;
    out.push({ field: "matchThreshold", value, phrase: m[0].trim() });
  }
  return out;
}

export type LedgerEntry = {
  kind:
    | "READ"
    | "SEARCHED"
    | "MATCHED"
    | "REJECTED"
    | "CHOSE"
    | "SET"
    | "SKIPPED"
    /** One sentence turned out to describe two workflows. */
    | "SPLIT";
  text: string;
  /** What this claim rests on — a catalogue entry, a registry node, a phrase. */
  citation?: string;
  /**
   * Who produced this line.
   *
   * Every entry is `system` today, because nothing in this file consults a
   * model. The field exists now rather than later so that when semantic ranking
   * lands, a reader can tell at a glance which claims were computed and which
   * were reasoned — and hold the second kind to the harder standard. A ledger
   * that mixes the two without saying so is worse than one that has neither.
   */
  source: "system" | "model";
};

/**
 * Put the numbers a person wrote onto the steps that can actually accept them.
 *
 * WHY THIS IS NEEDED. Two extractors disagreed. `applyDeterministicPolicyConfig`
 * in @tekisho/authoring reads `threshold|cutoff|score` on a 0–100 scale; the
 * `extractConfig` here reads `accept|threshold|confidence|score` on a 0–1 scale.
 * So "Accept at 92" was picked up by one and not the other, and the ledger
 * announced `matchThreshold = 0.92` for a graph where no node had it set — a
 * claim the editor then quietly contradicted.
 *
 * WHICH FIELDS GET STAMPED IS DERIVED, not listed. A value is applied only to a
 * step whose own config schema declares that field, read from `node_registry`.
 * A hardcoded list of "match-ish nodes" goes stale the first time somebody adds
 * a node with a threshold, and goes wrong silently.
 *
 * Never overwrites: the model may have set a field deliberately, and a value it
 * chose from the full request beats one a regex scraped out of a sentence.
 */
function stampExtractedConfig(
  nodes: Array<{ id: string; impl: string; config?: Record<string, unknown> }>,
  extracted: Array<{ field: string; value: number; phrase: string }>,
  nodeRows: any[],
): Array<{ id: string; impl: string; config?: Record<string, unknown> }> {
  if (extracted.length === 0) return nodes;
  const accepts = new Map<string, Set<string>>();
  for (const row of nodeRows) {
    const props = (row.config_schema as { properties?: Record<string, unknown> })
      ?.properties;
    accepts.set(String(row.key), new Set(Object.keys(props ?? {})));
  }
  return nodes.map((n) => {
    const fields = accepts.get(n.impl);
    if (!fields) return n;
    const config = { ...(n.config ?? {}) };
    let touched = false;
    for (const c of extracted) {
      if (fields.has(c.field) && config[c.field] === undefined) {
        config[c.field] = c.value;
        touched = true;
      }
    }
    return touched ? { ...n, config } : n;
  });
}

/**
 * Put the steps in the order they actually run.
 *
 * `compileLlmProposal` sorts nodes alphabetically by id so the same proposal
 * always produces byte-identical output. That is right for a checksum and
 * wrong for everything else, because ACCEPT THROWS THE MODEL'S EDGES AWAY and
 * re-chains the flow from this array — so the array order silently becomes the
 * order the workflow runs in.
 *
 * The damage that did: a model returning `intake → process_jd →
 * match_candidates`, which is correct, got stored as `intake →
 * match_candidates → process_jd`, which matches a job description before
 * anything has parsed it. It was diagnosed twice as the model ordering steps
 * badly, and twice the model had been right.
 *
 * So the edges decide, since they have been correct all along. An unreachable
 * step keeps its place at the end rather than being dropped: an orphan is
 * still somebody's step, and losing it here would be worse than showing it
 * out of place.
 */
export function nodesInRunOrder<T extends { id: string }>(
  nodes: readonly T[],
  edges: ReadonlyArray<readonly [string, string]>,
): T[] {
  if (edges.length === 0) return [...nodes];
  const order = orderedStepIds([...nodes], edges as Array<[string, string]>);
  const rank = new Map(order.map((id, i) => [id, i]));
  return [...nodes].sort(
    (a, b) =>
      (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
      (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER),
  );
}

/** Step ids in edge order, so the ledger reads like the canvas rather than the row order. */
function orderedStepIds(
  nodes: Array<{ id: string }>,
  edges: Array<[string, string]>,
): string[] {
  const known = new Set(nodes.map((n) => n.id));
  const seen = new Set<string>();
  const out: string[] = [];
  const walk = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    if (known.has(id)) out.push(id);
    for (const [from, to] of edges) if (from === id) walk(to);
  };
  walk("__start__");
  // Anything unreachable still gets named — an orphan step is worth seeing.
  for (const n of nodes) if (!seen.has(n.id)) out.push(n.id);
  return out;
}

/* ─────────────────────────── the seam ─────────────────────────────────

   ONE SENTENCE CAN DESCRIBE TWO WORKFLOWS.

   "When a requirement arrives AND FINISHES INTAKE, match it against our
   candidates" spans two applications. The words "and finishes intake" do not
   name a step — they name an EVENT. Intake belongs to ASTRA, matching belongs
   to SYNTRA, and the architecture joins them with a published event rather
   than by putting one application's steps inside the other's run.

   The generator does not know that yet, so it happily returns a single graph
   containing both halves. That graph would never route correctly: one run, one
   version pin, one failure domain, spanning two owners.

   So the seam is found here, after generation, and reported. A step belongs to
   another application when its module is not yours AND it is not shareable —
   shareable is the deliberate narrow exception for borrowing a capability
   (`human.gate`, `orch.branch.decision`) rather than advancing someone else's
   state, and borrowing one is not a seam.
   ──────────────────────────────────────────────────────────────────────── */

export type Handoff = {
  /** The published event the two halves are joined by, if one was named. */
  viaEvent: string | null;
  /** The application that owns the steps on the other side. */
  otherModule: string;
  /** Whether YOUR half runs before the handoff event or after it. */
  yourHalf: "before" | "after";
  /** Their step ids, in order — the half you are not building. */
  theirSteps: string[];
  /** Your step ids, in order — the half that stays. */
  yourSteps: string[];
};

/**
 * Find the point where a generated graph stops being one application's work.
 *
 * Returns null when the graph is single-owner, which is the ordinary case and
 * must stay free of ceremony.
 */
export function detectHandoff(args: {
  module: string;
  nodes: Array<{ id: string; impl: string; config?: Record<string, unknown> }>;
  edges: Array<[string, string]>;
  /** node key → owning module, from node_registry. */
  moduleOf: Map<string, string>;
  /** Node keys another module lent out. Borrowing one is not a seam. */
  shareable: Set<string>;
  /** Every event type in the catalogue — the handoff must be a real one. */
  eventTypes: Set<string>;
}): Handoff | null {
  const byId = new Map(args.nodes.map((n) => [n.id, n]));
  const order = orderedStepIds(args.nodes, args.edges);

  /**
   * Three kinds of step, and the middle one is the reason this is positional
   * rather than per-node. A shareable step — `human.gate`, a branch — is owned
   * by nobody in particular, so asking "whose is it" gives no answer. It
   * belongs to whichever half it SITS IN, and putting ASTRA's quality gate in
   * SYNTRA's workflow because the gate itself is neutral would be nonsense.
   */
  const classify = (id: string): "mine" | "theirs" | "neutral" => {
    const impl = byId.get(id)?.impl;
    if (!impl) return "neutral";
    if (args.shareable.has(impl)) return "neutral";
    const mod = args.moduleOf.get(impl);
    if (!mod) return "neutral";
    return mod === args.module ? "mine" : "theirs";
  };

  const kinds = order.map(classify);
  const firstOwned = kinds.findIndex((k) => k !== "neutral");
  if (firstOwned === -1) return null; // borrowed steps only — nobody's boundary

  const firstSide = kinds[firstOwned]!;
  const boundary = kinds.findIndex(
    (k, i) => i > firstOwned && k !== "neutral" && k !== firstSide,
  );
  if (boundary === -1) return null; // single owner: the ordinary case

  const firstHalf = order.slice(0, boundary);
  const secondHalf = order.slice(boundary);
  const yourHalf: Handoff["yourHalf"] = firstSide === "mine" ? "before" : "after";
  const yourSteps = yourHalf === "before" ? firstHalf : secondHalf;
  const theirSteps = yourHalf === "before" ? secondHalf : firstHalf;

  const foreign = order.find((id) => classify(id) === "theirs");
  const otherModule = args.moduleOf.get(byId.get(foreign!)!.impl)!;

  /**
   * The handoff event, read from the config of whichever half runs FIRST —
   * the emitting node is the last thing that half does, so the scan runs
   * backwards from the boundary. Any config value naming a real catalogue
   * event counts; `astra.route.decision` carries it as `onActionable`, but
   * nothing here is specific to that node.
   */
  let viaEvent: string | null = null;
  for (let i = firstHalf.length - 1; i >= 0 && !viaEvent; i -= 1) {
    const config = byId.get(firstHalf[i]!)?.config ?? {};
    for (const value of Object.values(config)) {
      if (typeof value === "string" && args.eventTypes.has(value)) {
        viaEvent = value;
        break;
      }
    }
  }

  return { viaEvent, otherModule, yourHalf, theirSteps, yourSteps };
}

/**
 * Keep your half of a split graph and re-chain it.
 *
 * Their steps are dropped rather than left dangling, and the survivors are
 * joined in the order they already ran, so what comes back is a valid
 * single-owner topology rather than a graph with holes in it.
 */
export function keepYourHalf(
  nodes: Array<{ id: string; impl: string; config?: Record<string, unknown> }>,
  yourSteps: string[],
): {
  nodes: Array<{ id: string; impl: string; config?: Record<string, unknown> }>;
  edges: Array<[string, string]>;
} {
  const keep = new Set(yourSteps);
  const kept = yourSteps
    .map((id) => nodes.find((n) => n.id === id))
    .filter((n): n is NonNullable<typeof n> => Boolean(n));
  const edges: Array<[string, string]> = [];
  if (kept.length > 0) {
    edges.push(["__start__", kept[0]!.id]);
    for (let i = 0; i < kept.length - 1; i += 1) {
      edges.push([kept[i]!.id, kept[i + 1]!.id]);
    }
    edges.push([kept[kept.length - 1]!.id, "__end__"]);
  }
  return { nodes: nodes.filter((n) => keep.has(n.id)), edges };
}

export function registerProposeRoutes(
  app: FastifyLike,
  pool: Pool,
  opts: { llm?: LLMClient } = {},
): void {
  /**
   * POST /workflows/propose  { module, description }
   *
   * Returns a proposal to review — never anything saved. Nothing here writes.
   */
  app.post("/workflows/propose", async (req: any, reply: any) => {
    const body = req.body ?? {};
    const module = String(body.module ?? "syntra");
    const description = String(body.description ?? "").trim();

    if (description.length < 15) {
      return reply.code(400).send({
        error: "description_too_short",
        message:
          "Describe what should happen, starting with when. For example: " +
          '"When a requirement finishes intake, match it against our candidates."',
      });
    }

    try {
      return await withOrgScope(pool, readOrgId(req.headers), async (client) => {
        const request = requestWeights(description);

        // ── trigger candidates, from the catalogue's own sentences ──────
        /**
         * `produced_when` joins the search, and the outbox tells us which
         * events are actually alive. Both were available and neither was used:
         * the old query read `event_type` and `description` only, so a dead
         * event and a live one were indistinguishable to the ranking.
         */
        const { rows: eventRows } = await client.query(
          `SELECT s.event_type,
                  s.description,
                  s.produced_when,
                  s.payload_schema,
                  coalesce(p.n, 0)::int AS publish_count
             FROM event_schemas s
             LEFT JOIN (
               SELECT event_type, count(*) AS n
                 FROM event_outbox
                GROUP BY event_type
             ) p ON p.event_type = s.event_type
            ORDER BY s.event_type`,
        );

        /**
         * The corpus is the catalogue itself, rebuilt per request.
         *
         * Twenty-six rows — the cost is not worth a cache, and rebuilding means
         * an event registered a minute ago is weighted correctly rather than
         * against a snapshot taken at boot.
         */
        const corpus = eventRows.map((e: any) => [
          ...terms(e.event_type ?? ""),
          ...terms(e.description ?? ""),
          ...terms(e.produced_when ?? ""),
        ]);
        const idf = idfOver(corpus);

        const scored: Scored[] = visibleEvents(
          eventRows.map((e: any) => {
            const description = e.description ?? "";
            const producedWhen = e.produced_when ?? "";
            const { score, matchedOn } = scoreEvent(
              request,
              { eventType: e.event_type, description, producedWhen },
              idf,
              corpus.length,
            );
            const publishCount = Number(e.publish_count ?? 0);
            const declaresPayload =
              Object.keys(e.payload_schema?.properties ?? {}).length > 0;
            return {
              eventType: e.event_type,
              description,
              producedWhen,
              score,
              matchedOn,
              publishCount,
              everPublished: publishCount > 0,
              declaresPayload,
            };
          }),
          { adminId: readAdminId(req.headers), orgId: readOrgId(req.headers) },
        );

        const matched = scored.filter((c) => c.matchedOn.length > 0);
        /**
         * Eight, not five. Word overlap has no semantics, so the correct event
         * can sit outside a tight cut purely because the catalogue phrases it
         * differently from you — and a candidate that is not on the list is one
         * nobody reconsiders. Widening the cut is a partial answer; the ledger
         * says how many were dropped so the drawer stays an obvious next step.
         */
        const ranked = [...matched].sort(compareCandidates).slice(0, 8);

        const best = ranked[0] ?? null;
        const alsoRans = ranked.slice(1, 3);

        // ── what the module may use ─────────────────────────────────────
        const { rows: nodeRows } = await client.query(
          `SELECT key, title, description, side_effect, source, input_schema,
                  output_schema, config_schema, module, shareable
             FROM node_registry
            ORDER BY (module = $1) DESC, module, key`,
          [module],
        );

        // ── routing: what already answers this event ────────────────────
        const routing = best
          ? await client.query(
              `SELECT graph_key, module_queue, status FROM graph_event_bindings
                WHERE event_type = $1 AND status = 'active'`,
              [best.eventType],
            )
          : { rows: [] as any[] };

        // ── config a person actually wrote down ─────────────────────────
        const extracted = extractConfig(description);

        // ── the graph shape, from the model ─────────────────────────────
        /**
         * The provisional key. The person renames it on screen before
         * accepting, and `accept` uses whatever they typed — this only exists
         * because the generator stamps a key into the definition it validates.
         */
        const provisionalKey = `${module}.${
          (description.split(/\s+/)[1] ?? "new").toLowerCase().replace(/[^a-z0-9]/g, "") ||
          "new"
        }.workflow`;

        /**
         * WHY THIS IS WRAPPED RATHER THAN AWAITED PLAINLY.
         *
         * Three things can go wrong and none of them should cost you the rest
         * of the proposal: no client configured, the provider down (Gemini
         * answers 503 under load often enough to matter), or the model
         * returning something the strict schema rejects twice.
         *
         * In every case the trigger match, the routing check and the config
         * extraction are still correct and still useful — so the fallback is a
         * single placeholder step plus a ledger line naming the reason, not an
         * error page. The person can still shape the graph in the editor,
         * which is where they were going to end up anyway.
         */
        let graph: {
          /**
           * `resolved` is a real graph that no model produced: the existing
           * workflow with the settings the description asked for. It behaves
           * like `model` everywhere except the ledger, which must not credit
           * a model with something it was never asked.
           */
          source: "model" | "placeholder" | "resolved";
          nodes: Array<{ id: string; impl: string; config?: Record<string, unknown> }>;
          edges: Array<[string, string]>;
          unsupported: string[];
          model: string | null;
          summary: string | null;
          fallbackReason: string | null;
        };

        /**
         * One step to start from when the model could not answer.
         *
         * It used to be "the first contract node in the list", which is
         * alphabetical — a request about matching job descriptions came back
         * with `syntra.bench.alert` and a `matchThreshold` stamped on a node
         * that may not even take one. Arbitrary AND wrong is worse than
         * arbitrary.
         *
         * So: prefer a step whose settings actually accept what was read out
         * of the description. "Accept at 92" gives `matchThreshold`, and the
         * node that declares it is the one the request was about. Falling back
         * to the old behaviour when nothing was extracted, because then there
         * is genuinely nothing to go on.
         */
        const placeholder = () => {
          const config: Record<string, unknown> = {};
          for (const c of extracted) config[c.field] = c.value;

          const wanted = extracted.map((c) => c.field);
          const takesConfig = (n: any) =>
            wanted.length > 0 &&
            wanted.every((f) =>
              Boolean(n.config_schema?.properties?.[f]),
            );

          const first =
            nodeRows.find((n: any) => n.source === "contract" && takesConfig(n)) ??
            nodeRows.find((n: any) => n.source === "contract") ??
            nodeRows[0];

          const id = String(first?.key ?? "step").split(".").pop() ?? "step";
          // Only settings the chosen step actually declares. Stamping a field
          // it does not take would fail its own input check at run time.
          const kept: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(config)) {
            if (first?.config_schema?.properties?.[k]) kept[k] = v;
          }
          return first ? [{ id, impl: String(first.key), config: kept }] : [];
        };

        /**
         * BEFORE ASKING A MODEL TO INVENT SOMETHING, SEE IF IT ALREADY EXISTS.
         *
         * Most descriptions are a change to a workflow that already runs.
         * "…match against our candidates. Accept at 92" reads like a new
         * workflow and is not one: that chain runs today, and the only thing
         * the sentence asks for is one field on one step.
         *
         * Generating anyway hands the author a second workflow doing what the
         * first already does, bound to nothing, and leaves them to notice.
         */
        let resolution: Resolution = {
          kind: "generate",
          reason: "Not attempted.",
        };
        /** Set only when the request was answered without calling a model. */
        let resolvedGraph: typeof graph | null = null;
        if (best?.eventType) {
          const { rows: boundRows } = await client.query(
            `SELECT b.graph_key, d.version, d.definition
               FROM graph_event_bindings b
               JOIN graph_definitions d
                 ON d.graph_key = b.graph_key AND d.status = 'active'
              WHERE b.event_type = $1 AND b.status = 'active'
              LIMIT 1`,
            [best.eventType],
          );
          const row = boundRows[0];
          const def = row
            ? typeof row.definition === "string"
              ? JSON.parse(row.definition)
              : row.definition
            : null;

          resolution = resolveAgainstExisting({
            triggerEventType: best.eventType,
            boundTo: new Map(row ? [[best.eventType, String(row.graph_key)]] : []),
            existing: row
              ? {
                  graphKey: String(row.graph_key),
                  version: Number(row.version),
                  nodes: (def?.nodes ?? []) as Array<{
                    id: string;
                    impl: string;
                    config?: Record<string, unknown>;
                  }>,
                }
              : null,
            wanted: extracted,
            declaredFieldsOf: new Map(
              nodeRows.map((n: any) => [
                String(n.key),
                Object.keys(n.config_schema?.properties ?? {}),
              ]),
            ),
          });

          if (resolution.kind === "change" || resolution.kind === "already-satisfied") {
            const changed = ((def?.nodes ?? []) as Array<{
              id: string;
              impl: string;
              config?: Record<string, unknown>;
            }>).map((n) => {
              const forThis =
                resolution.kind === "change"
                  ? resolution.changes.filter((c) => c.nodeId === n.id)
                  : [];
              if (forThis.length === 0) return n;
              const config = { ...(n.config ?? {}) };
              for (const c of forThis) config[c.field] = c.to;
              return { ...n, config };
            });

            resolvedGraph = {
              source: "resolved",
              nodes: changed,
              edges: (def?.edges ?? []) as Array<[string, string]>,
              unsupported: [],
              model: null,
              summary: resolution.summary,
              fallbackReason: null,
            };
          }
        }

        if (resolvedGraph) {
          // Answered from the workflow that already runs. No model was called.
          graph = resolvedGraph;
        } else if (!opts.llm) {
          graph = {
            source: "placeholder",
            nodes: placeholder(),
            edges: [],
            unsupported: [],
            model: null,
            summary: null,
            fallbackReason:
              "No model is configured, so the shape was not generated. Set LLM_PROVIDER, LLM_API_KEY and LLM_MODEL.",
          };
        } else {
          try {
            const events = await loadEventCatalog(client);
            const generated = await generateGraphFromLlm({
              llm: opts.llm,
              userRequest: description,
              events,
              graphKey: provisionalKey,
              /**
               * EVERY APPLICATION'S STEPS, DESCRIBED FROM THE SCHEMAS THE
               * RUNTIME ENFORCES.
               *
               * Unrestricted on purpose. An author should be able to describe
               * work that crosses applications in one sentence, so the model
               * has to be able to answer in one graph — and that graph is
               * split into a chain of per-application workflows on the way to
               * storage, which is where the boundary actually matters.
               *
               * Scoping this to one module (as it briefly was) made a mixed
               * graph impossible, which fixed the routing problem by removing
               * the feature. The split fixes it while keeping the feature.
               *
               * The schemas come from `node_registry` rather than the prose
               * catalogue: that has drifted, calling `syntra.match.process`'s
               * `jobId` required when it is optional and never mentioning
               * `requirement_id`, which is the field the live ASTRA handoff
               * carries.
               */
              nodes: nodeRows.map((n: any) => ({
                key: String(n.key),
                title: String(n.title ?? n.key),
                description: String(n.description ?? ""),
                module: String(n.module ?? "platform"),
                sideEffect: n.side_effect ?? null,
                input: n.input_schema ?? null,
                output: n.output_schema ?? null,
                config: n.config_schema ?? null,
              })),
            });
            graph = {
              source: "model",
              nodes: stampExtractedConfig(
                generated.definition.nodes as Array<{
                  id: string;
                  impl: string;
                  config?: Record<string, unknown>;
                }>,
                extracted,
                nodeRows,
              ),
              edges: (generated.definition.edges ?? []) as Array<[string, string]>,
              unsupported: generated.unsupported,
              model: generated.model,
              summary: generated.builtSummary,
              fallbackReason: null,
            };
          } catch (err) {
            /**
             * A `GenerationFailedError` means the model answered and the answer
             * was refused — an invented node key, malformed JSON twice, or an
             * explicit UNSUPPORTED_REQUEST. Anything else is the provider being
             * unreachable. Both are reported; neither is hidden behind a
             * placeholder that looks like a considered suggestion.
             */
            /**
             * THREE DIFFERENT FAILURES, THREE DIFFERENT SENTENCES.
             *
             * These used to collapse into "the model's answer was rejected"
             * plus whatever the provider said, verbatim. For a rate limit that
             * is wrong twice over: there was no answer to reject, and the
             * reader gets a quota URL in the middle of a sentence about their
             * workflow. Somebody reads that and starts rewriting a description
             * that was never the problem.
             */
            const transient =
              err instanceof GenerationFailedError && err.transient;
            const why = transient
              ? "The AI provider is busy or over its rate limit right now. " +
                "Nothing is wrong with your description — press Generate again " +
                "in a moment."
              : err instanceof GenerationFailedError
                ? `The model answered and the answer was refused: ${err.message}`
                : `The model could not be reached: ${
                    err instanceof Error ? err.message : String(err)
                  }`;
            req.log?.warn?.({ err }, "propose: graph generation failed, using placeholder");
            graph = {
              source: "placeholder",
              nodes: placeholder(),
              edges: [],
              unsupported: [],
              model: null,
              summary: null,
              fallbackReason: why.slice(0, 400),
            };
          }
        }

        /* ── one flow in, the workflows that will run out ──────────────
         *
         * An author may cross applications freely: "when a requirement
         * arrives and finishes intake, match it against our candidates" is one
         * sentence and one intention, and making somebody author it twice in
         * two places is the tool failing them.
         *
         * What cannot cross is the STORED graph. One version pin covering two
         * teams' releases, a retry that re-runs another application's writes,
         * a borrowed step running under its owner's database role — each is a
         * real consequence, and the live system already avoids all three by
         * running this exact shape as a chain.
         *
         * So the flow is split here, on the way to storage, and the chain is
         * what the screen shows.
         */
        const { rows: ownerRows } = await client.query(
          `SELECT key, module, shareable, emits FROM node_registry`,
        );
        /**
         * What each node declared it may publish.
         *
         * NULL and `[]` are kept apart all the way through: a node that has
         * not declared maps to null, a node declared silent maps to an empty
         * array. Flattening them here would undo the whole point of the
         * column — "we cannot tell" would start reading as "it does not".
         */
        const emitsOf = new Map<string, EmitDeclaration[] | null>(
          ownerRows.map((r: any) => [
            String(r.key),
            Array.isArray(r.emits) ? (r.emits as EmitDeclaration[]) : null,
          ]),
        );
        const moduleOf = new Map<string, string>(
          ownerRows.map((r: any) => [String(r.key), String(r.module)]),
        );
        const shareableKeys = new Set<string>(
          ownerRows
            .filter((r: any) => r.shareable === true)
            .map((r: any) => String(r.key)),
        );
        const knownEvents = new Set<string>(
          eventRows.map((e: any) => String(e.event_type)),
        );

        const { rows: activeBindings } = await client.query(
          `SELECT event_type, graph_key, module_queue FROM graph_event_bindings
            WHERE status = 'active'`,
        );
        const boundTo = new Map<string, string>(
          activeBindings.map((b: any) => [
            String(b.event_type),
            String(b.graph_key),
          ]),
        );

        /**
         * What each live workflow actually runs.
         *
         * Needed to answer the question that matters about a step publishing
         * an event: not just "does something else start", but "does it redo
         * work this flow is already doing". Only the active version is read —
         * a retired one runs for nobody.
         */
        const { rows: activeDefs } = await client.query(
          `SELECT graph_key, version, definition FROM graph_definitions
            WHERE status = 'active'`,
        );
        const versionOf = new Map<string, number>(
          activeDefs.map((d: any) => [String(d.graph_key), Number(d.version)]),
        );
        const queueOf = new Map<string, string>(
          activeBindings.map((b: any) => [
            String(b.event_type),
            String(b.module_queue),
          ]),
        );
        /**
         * Queues a worker actually serves. A binding naming anything else is a
         * door that opens onto nothing: the event is accepted, routed, queued,
         * and never picked up. Five live bindings are in that state today.
         */
        const workedQueues = new Set<string>([
          "module.syntra.jd",
          "module.design.resume",
          "module.design.duplicate",
          "module.syntra.match",
          "module.orbit.bench",
        ]);
        const eventFacts = new Map<string, EventFacts>(
          eventRows.map((e: any) => [
            String(e.event_type),
            {
              eventType: String(e.event_type),
              description: e.description ?? null,
              producedWhen: e.produced_when ?? null,
              publishCount: Number(e.publish_count ?? 0),
            },
          ]),
        );

        const implsOf = new Map<string, readonly string[]>(
          activeDefs.map((d: any) => [
            String(d.graph_key),
            ((d.definition?.nodes ?? []) as Array<{ impl?: string }>)
              .map((n) => String(n?.impl ?? ""))
              .filter(Boolean),
          ]),
        );

        const factsFor = (key: string): ModuleFacts => {
          const m = MODULE_REGISTRY.find((x) => x.key === key);
          return {
            key,
            handsOff: m?.handsOff ?? [],
            frontDoor: m?.frontDoor ?? [],
          };
        };

        const split =
          graph.source !== "placeholder"
            ? splitByModule({
                nodes: graph.nodes,
                edges: graph.edges,
                moduleOf,
                shareable: shareableKeys,
              })
            : null;

        /**
         * The events that WOULD join the segments, worked out before deciding
         * whether to split at all — because the decision depends on them.
         * A handoff that already starts a live workflow is the one good reason
         * to split; anything else is a join with nobody at the other end.
         */
        const spansModules = Boolean(split && !split.singleModule);
        const handoffs =
          split && spansModules
            ? split.segments.map((seg, i) => {
                const prev = split.segments[i - 1];
                return prev
                  ? resolveHandoff(
                      factsFor(prev.module),
                      factsFor(seg.module),
                      knownEvents,
                      boundTo,
                    )
                  : null;
              })
            : [];

        const chainDecision = spansModules ? decideChain(handoffs) : null;

        /**
         * Steps this workflow borrows from another application without
         * permission.
         *
         * Go-live check 8 refuses a workflow that uses another module's step
         * unless that step is marked shareable. That rule is right — borrowing
         * a step means running it under its owner's database role, and an
         * owner who has not marked it shareable has not agreed to that.
         *
         * What was wrong is WHEN it was found out. Now that a flow crossing
         * applications stays one workflow by default, borrowing is the normal
         * outcome rather than a rare mistake, and discovering it at the very
         * last gate means building the whole thing first. So it is worked out
         * here and shown next to the proposal — nothing is blocked, the author
         * simply knows what they will need before they spend the afternoon.
         */
        /**
         * Workflows this flow sets running by publishing, and whether any of
         * them redoes work the flow already does.
         *
         * The live one: `syntra.jd.process` publishes `syntra.jd.parsed`,
         * bound to `syntra.continuous.match`. A flow holding both steps
         * therefore matches the same job twice — and before nodes declared
         * what they publish, nothing could see that.
         */
        const triggeredWorkflows = detectTriggeredWorkflows({
          nodes: graph.nodes,
          emitsOf,
          boundTo,
          implsOf,
          // No self key at proposal time: the workflow does not exist yet, so
          // it cannot be the thing its own steps re-enter.
        });

        /**
         * The plan, built whether or not the flow is stored as a chain.
         *
         * The author asked for an outcome. Whether the platform stores that as
         * one workflow or three is a storage decision made later and lower
         * down; it must not change what they are shown. So the plan is derived
         * from the segments — the applications the work passes through —
         * rather than from `chain`, which only exists when we split.
         */
        const plan =
          split && split.segments.length > 0
            ? buildPlan({
                chain: split.segments.map((seg, i) => ({
                  module: seg.module,
                  yours: seg.module === module,
                  steps: seg.stepIds,
                  nodes: seg.stepIds
                    .map((id) => graph.nodes.find((n) => n.id === id))
                    .filter((n): n is NonNullable<typeof n> => Boolean(n)),
                  startsWith: handoffs[i] ?? null,
                  alreadyBuilt: handoffs[i]?.handledBy ?? null,
                })),
                triggerEventType: best?.eventType ?? null,
                eventFacts,
                boundTo,
                queueOf,
                workedQueues,
                versionOf,
                emitsOf,
              })
            : null;

        const borrowedSteps = graph.nodes
          .filter((n) => {
            const owner = moduleOf.get(n.impl);
            return (
              owner !== undefined &&
              owner !== module &&
              !shareableKeys.has(n.impl)
            );
          })
          .map((n) => ({ step: n.impl, ownedBy: moduleOf.get(n.impl)! }));

        /**
         * The chain: a workflow per application, and the event between each
         * pair. Where an event already starts a live workflow, that half needs
         * building by nobody — which is the best possible answer to half a
         * request, and the reason this is worth computing rather than assuming.
         *
         * Built only when splitting earns its cost. A flow that crosses
         * applications with nothing to reuse downstream stays ONE workflow:
         * the edges carry it, it runs the whole way through, and there is no
         * event that can quietly fail to be published.
         */
        const chain =
          split && chainDecision?.chain
            ? split.segments.map((seg, i) => {
                const startsWith = handoffs[i] ?? null;
                return {
                  module: seg.module,
                  /** Yours when it is the module you were authoring in. */
                  yours: seg.module === module,
                  steps: seg.stepIds,
                  /**
                   * The steps themselves, not just their ids.
                   *
                   * `graph` below keeps only the FIRST segment, so a caller
                   * reconstructing a later link from `graph.nodes` finds
                   * nothing and has to invent something. It did, briefly:
                   * accepting a chain created the second workflow with `impl`
                   * set to the step id, which is not a runnable node at all.
                   */
                  nodes: seg.stepIds
                    .map((id) => graph.nodes.find((n) => n.id === id))
                    .filter((n): n is NonNullable<typeof n> => Boolean(n)),
                  edges: seg.edges,
                  /** The handoff that starts this link, null for the first. */
                  startsWith,
                  /**
                   * Nothing to build: a live workflow already answers the event
                   * that would start this half.
                   */
                  alreadyBuilt: startsWith?.handledBy ?? null,
                  /**
                   * Whether the PREVIOUS half can be seen to publish the event
                   * that starts this one. "unknown" is not a failure — most
                   * nodes emit from inside `run`, which nothing declares — but
                   * it is the difference between a join we verified and one we
                   * assumed, and the author is the one who can tell.
                   */
                  handoffEmitted: startsWith
                    ? emitsEvent({
                        nodes: split.segments[i - 1]!.stepIds
                          .map((id) => graph.nodes.find((n) => n.id === id))
                          .filter((n): n is NonNullable<typeof n> => Boolean(n)),
                        eventType: startsWith.eventType,
                        emitsOf,
                      })
                    : null,
                };
              })
            : null;

        /**
         * The single-graph view keeps ONLY the first segment.
         *
         * Not because the rest is unwanted — the chain above carries it — but
         * because `graph` is what the editor and Accept have always meant by
         * "the workflow", and quietly widening that to mean several would
         * break both. The chain is the new thing and says so separately.
         */
        if (split && chain && split.segments[0]) {
          const first = split.segments[0];
          const keep = new Set(first.stepIds);
          graph = {
            ...graph,
            nodes: graph.nodes.filter((n) => keep.has(n.id)),
            edges: first.edges,
          };
        }

        /**
         * The array order becomes the run order at accept, so the edges — not
         * the alphabetical sort that made the array — decide it. See
         * `nodesInRunOrder`.
         */
        graph = { ...graph, nodes: nodesInRunOrder(graph.nodes, graph.edges) };

        // ── the ledger: every line points at something checkable ────────
        /**
         * No score appears in any line below. It used to — `trigger → x (0.25)`
         * — and the number could not be acted on: it is not a probability, its
         * denominator is the length of YOUR description, so it cannot even be
         * compared between two proposals. Rank, the matched words, and why the
         * others lost are all checkable. A bare 0.25 is not.
         */
        const ledger: LedgerEntry[] = [
          {
            kind: "READ",
            text: description,
            source: "system",
          },
          {
            kind: "SEARCHED",
            text: `${scored.length} events in the catalogue · ${matched.length} share wording with your description`,
            citation:
              scored.length === matched.length
                ? "Every event was considered."
                : `${scored.length - matched.length} shared no words at all and were not ranked. ` +
                  "Word overlap has no sense of meaning, so if the right event phrases " +
                  "things differently from you it is in the catalogue, not in this list — " +
                  "open it and search.",
            source: "system",
          },
        ];

        if (best) {
          ledger.push({
            kind: "MATCHED",
            text: `trigger → ${best.eventType}`,
            citation:
              `matched on ${best.matchedOn.map((w) => `"${w}"`).join(", ")} ` +
              `in the catalogue entry: "${best.description}"` +
              (best.everPublished
                ? ` · published ${best.publishCount} times, so it is live`
                : " · ⚠ nothing has ever published this event"),
            source: "system",
          });

          /**
           * The runner-up used to be a parenthesised score at the end of the
           * citation, which told nobody anything. Saying why it lost is the
           * line that would have caught a coincidental word match ranking level
           * with the right answer.
           */
          for (const other of alsoRans) {
            ledger.push({
              kind: "REJECTED",
              text: `considered ${other.eventType}`,
              citation: whyBelow(best, other),
              source: "system",
            });
          }
        } else {
          ledger.push({
            kind: "SKIPPED",
            text: "No event in the catalogue matches this description",
            citation:
              "Nothing shared a word with the catalogue's names or sentences. " +
              "Pick a trigger by hand, or register a new event.",
            source: "system",
          });
        }

        for (const c of extracted) {
          ledger.push({
            kind: "SET",
            text: `${c.field} = ${c.value}`,
            citation: `from your words: "${c.phrase}"`,
            source: "system",
          });
        }

        /**
         * THE MODEL'S LINES. The only entries in this ledger with
         * `source: "model"`, and they are held to a harder standard than the
         * computed ones: the shape is validated against a strict schema, every
         * node key must already exist in the registry, and anything the model
         * could not build has to be declared rather than quietly dropped.
         */
        /**
         * Answered without a model. Worth its own line, because "we did not
         * generate anything" looks identical to "generation failed" unless
         * somebody says which it was.
         */
        if (graph.source === "resolved" && resolution.kind === "change") {
          ledger.push({
            kind: "MATCHED",
            text: `${resolution.graphKey} v${resolution.version} already does this`,
            citation:
              `No workflow was generated. ` +
              resolution.changes
                .map(
                  (c) =>
                    `${c.nodeId}.${c.field} ${JSON.stringify(c.from) ?? "unset"} → ${JSON.stringify(c.to)} (from "${c.phrase}")`,
                )
                .join("; "),
            source: "system",
          });
        }
        if (graph.source === "resolved" && resolution.kind === "already-satisfied") {
          ledger.push({
            kind: "MATCHED",
            text: `${resolution.graphKey} v${resolution.version} already does exactly this`,
            citation:
              "Every setting you asked for is the value it is already set to. " +
              "Nothing was generated and nothing needs changing.",
            source: "system",
          });
        }

        if (graph.source === "model") {
          /**
           * The step chain, not `builtSummary`. The summary is a full sentence
           * per node — nine of them ran to 700 characters in one ledger row,
           * which is unreadable in a list. The chain says what was built; the
           * canvas is where the detail belongs.
           */
          ledger.push({
            kind: "CHOSE",
            text: `built ${graph.nodes.length} step${graph.nodes.length === 1 ? "" : "s"}`,
            citation:
              `${orderedStepIds(graph.nodes, graph.edges).join(" → ")} · generated by ` +
              `${graph.model}, every step checked against the node registry before you saw it`,
            source: "model",
          });
          /**
           * The gap report. A model that silently drops half a request is far
           * worse than one that says what it could not do — so this is surfaced
           * as its own line per item rather than folded into a footnote.
           */
          /**
           * THE CHAIN. Said in the author's own terms: one description turned
           * out to describe work in more than one application, so here is
           * every workflow it becomes and the event joining each pair.
           */
          if (chain && chain.length > 1) {
            ledger.push({
              kind: "SPLIT",
              text: `this becomes ${chain.length} workflows, one per application`,
              citation:
                `${chainDecision?.reason ?? ""} ` +
                chain
                  .map((c) => `${c.module.toUpperCase()}: ${c.steps.join(" → ")}`)
                  .join("  ·  "),
              source: "system",
            });

            for (const link of chain) {
              if (!link.startsWith) continue;
              const h = link.startsWith;

              if (link.alreadyBuilt) {
                ledger.push({
                  kind: "MATCHED",
                  text: `${link.module.toUpperCase()}'s half already exists — ${link.alreadyBuilt}`,
                  citation:
                    `${h.eventType} is already bound and running, so nothing needs ` +
                    `building on that side.`,
                  source: "system",
                });
                continue;
              }

              /**
               * A join nobody publishes is the one failure this design can
               * produce silently: the first workflow succeeds, the second is
               * never triggered, and no error is raised anywhere. Worth saying
               * out loud even when it turns out to be fine.
               */
              if (link.handoffEmitted === "no") {
                ledger.push({
                  kind: "SKIPPED",
                  text: `${h.fromModule.toUpperCase()} does not publish ${h.eventType}`,
                  citation:
                    `Every step in ${h.fromModule.toUpperCase()}'s half has declared ` +
                    `what it publishes, and none of them publish ${h.eventType}. So ` +
                    `${h.toModule.toUpperCase()}'s half would never be triggered — ` +
                    `the first workflow would succeed and the work would simply stop. ` +
                    `Add a step that publishes it, or join these two on an event ` +
                    `${h.fromModule.toUpperCase()} does publish.`,
                  source: "system",
                });
              } else if (link.handoffEmitted === "unknown") {
                ledger.push({
                  kind: "SKIPPED",
                  text: `cannot tell whether ${h.eventType} is published`,
                  citation:
                    `Some steps in ${h.fromModule.toUpperCase()}'s half have not ` +
                    `declared what they publish, so this cannot be checked here. If ` +
                    `none of them publish ${h.eventType}, ` +
                    `${h.toModule.toUpperCase()}'s half never starts and nothing ` +
                    `reports a failure. Worth confirming before this goes live.`,
                  source: "system",
                });
              }

              ledger.push({
                kind: h.exists ? "CHOSE" : "SKIPPED",
                text: h.exists
                  ? `handoff ${h.fromModule.toUpperCase()} → ${h.toModule.toUpperCase()} via ${h.eventType}`
                  : `no event joins ${h.fromModule.toUpperCase()} to ${h.toModule.toUpperCase()} yet`,
                citation: h.exists
                  ? `${h.eventType} already exists in the catalogue, so both halves ` +
                    `keep their own version and either can change without the other.`
                  : `Nothing in the catalogue joins these two, so ${h.eventType} would ` +
                    `have to be registered before this chain can run. Adding to a ` +
                    `shared catalogue is something every application lives with.`,
                source: "system",
              });
            }
          }

          /**
           * Crossing applications without splitting is a decision too, and one
           * an author will want to see — it is why there is one workflow on
           * screen and not two.
           */
          if (spansModules && !chain) {
            const apps = [
              ...new Set((split?.segments ?? []).map((seg) => seg.module)),
            ];
            ledger.push({
              kind: "CHOSE",
              text: `one workflow spanning ${apps.map((a) => a.toUpperCase()).join(" and ")}`,
              citation:
                `${chainDecision?.reason ?? ""} Its steps run in order in a single ` +
                `run, so each one can read what the steps before it produced.`,
              source: "system",
            });
          }

          /**
           * Said plainly, and as a SKIPPED rather than a failure: the workflow
           * is fine, it is the permission that is missing, and the person who
           * can give it is somebody else.
           */
          /**
           * Duplicates first, because they are wrong rather than merely worth
           * knowing: the same input processed twice, two sets of results, and
           * nothing in any log to say so.
           */
          for (const t of triggeredWorkflows.filter(
            (x) => x.alsoRunsHere.length > 0,
          )) {
            ledger.push({
              kind: "SKIPPED",
              text: `${t.impl} already starts ${t.graphKey} — ${t.alsoRunsHere.join(", ")} would run twice`,
              citation:
                `${t.impl} publishes ${t.eventType} when it finishes, and that ` +
                `event starts ${t.graphKey}, which runs ` +
                `${t.alsoRunsHere.join(", ")}. This flow runs ` +
                `${t.alsoRunsHere.length === 1 ? "that step" : "those steps"} ` +
                `too, so one input would be processed twice — once here, once ` +
                `in ${t.graphKey}. Remove ` +
                `${t.alsoRunsHere.length === 1 ? "it" : "them"} and let ` +
                `${t.graphKey} do that part, or keep ` +
                `${t.alsoRunsHere.length === 1 ? "it" : "them"} and retire that ` +
                `binding.`,
              source: "system",
            });
          }

          for (const t of triggeredWorkflows.filter(
            (x) => x.alsoRunsHere.length === 0,
          )) {
            ledger.push({
              kind: "CHOSE",
              text: `${t.impl} also starts ${t.graphKey}`,
              citation:
                `Publishing ${t.eventType} starts ${t.graphKey} as a separate ` +
                `run. Often exactly the intention — that is what a handoff is — ` +
                `but it happens whether or not it was meant, so it is worth ` +
                `knowing it does.`,
              source: "system",
            });
          }

          if (borrowedSteps.length > 0) {
            const owners = [...new Set(borrowedSteps.map((b) => b.ownedBy))];
            ledger.push({
              kind: "SKIPPED",
              text: `${borrowedSteps.length} step${borrowedSteps.length === 1 ? "" : "s"} belong${borrowedSteps.length === 1 ? "s" : ""} to ${owners.map((o) => o.toUpperCase()).join(" and ")}`,
              citation:
                `${borrowedSteps.map((b) => b.step).join(", ")} ` +
                `${borrowedSteps.length === 1 ? "is" : "are"} owned by ` +
                `${owners.map((o) => o.toUpperCase()).join(" and ")} and not marked ` +
                `shareable. You can build and test this now, but going live needs ` +
                `${owners.length === 1 ? "that team" : "those teams"} to mark ` +
                `${borrowedSteps.length === 1 ? "it" : "them"} shareable first — ` +
                `a borrowed step runs under its owner's database role, so it is ` +
                `their call to make.`,
              source: "system",
            });
          }

          for (const gap of graph.unsupported) {
            ledger.push({
              kind: "SKIPPED",
              text: gap,
              citation:
                "The model reported this as something it could not build from the " +
                "available steps. Add it by hand in the editor, or reword the description.",
              source: "model",
            });
          }
        } else {
          ledger.push({
            kind: "SKIPPED",
            text: "The shape was not generated — showing one step to start from",
            citation: graph.fallbackReason ?? "Generation was unavailable.",
            source: "system",
          });
        }

        return {
          module,
          description,
          /**
           * `score` still travels because tests assert on ordering, but the UI
           * does not render it — see the ledger note above. `everPublished` and
           * `publishCount` are what the screen actually shows, because "nothing
           * publishes this" is the one fact that makes a trigger choice wrong
           * in a way nobody notices later.
           */
          triggerCandidates: ranked.map((c) => ({
            eventType: c.eventType,
            description: c.description,
            producedWhen: c.producedWhen,
            score: c.score,
            matchedOn: c.matchedOn,
            publishCount: c.publishCount,
            everPublished: c.everPublished,
          })),
          /** How many shared no wording at all — the drawer is the way to them. */
          notRanked: scored.length - matched.length,
          /**
           * The proposed shape. `source` is load-bearing on screen: a generated
           * graph and a fallback placeholder must never look alike, because one
           * is a suggestion and the other is an apology.
           */
          graph,
          /**
           * The workflows this description becomes, in the order the work
           * flows through them.
           *
           * Null when it stayed inside one application, which is the ordinary
           * case — a concept nobody needs today should cost them no attention.
           */
          chain,
          plan,
          spansModules,
          chainDecision,
          borrowedSteps,
          triggeredWorkflows,
          suggestedTrigger: best?.eventType ?? null,
          availableNodes: nodeRows.map((n: any) => ({
            key: n.key,
            title: n.title,
            description: n.description,
            sideEffect: n.side_effect,
            source: n.source,
            hasSchemas: Boolean(n.input_schema),
          })),
          extractedConfig: extracted,
          routing: {
            existing: routing.rows.map((r: any) => ({
              graphKey: r.graph_key,
              moduleQueue: r.module_queue,
            })),
            /**
             * Fan-out is not available. A unique index permits one active
             * binding per event, so "also run mine" cannot be written down
             * today — offering it would produce a choice that fails on save.
             */
            fanoutPossible: false,
          },
          ledger,
        };
      });
    } catch (err) {
      req.log?.error?.(err);
      return reply
        .code(500)
        .send({ error: "propose_failed", message: String(err) });
    }
  });

  /**
   * POST /workflows/accept
   * { graphKey, module, triggerEventType, nodes:[{id, impl, config}], description }
   *
   * Creates the DRAFT. It cannot run — the router reads active only — and the
   * trigger travels inside the definition until go-live creates the binding.
   */
  /**
   * POST /workflows/accept-chain
   * { links: [{ graphKey, module, triggerEventType, registerTrigger?, nodes }],
   *   description }
   *
   * Accepts a flow that crosses applications: one DRAFT per application, and
   * any handoff event that does not exist yet registered on the way.
   *
   * WHY THIS IS SEPARATE FROM /accept RATHER THAN A FLAG ON IT.
   *
   * Accepting several workflows is a different promise from accepting one. It
   * writes to the shared event catalogue, it creates workflows in applications
   * the author does not own, and it either all happens or none of it does. A
   * boolean on the single-workflow endpoint would hide all three behind a
   * parameter somebody could set by accident.
   *
   * NOTHING GOES LIVE. Every workflow is a draft, and a draft cannot run — the
   * router reads active bindings only. The chain becomes real one go-live at a
   * time, which is also the point at which each application's gate runs.
   */
  app.post("/workflows/accept-chain", async (req: any, reply: any) => {
    const body = req.body ?? {};
    const links = Array.isArray(body.links) ? body.links : [];

    if (links.length < 2) {
      return reply.code(400).send({
        error: "not_a_chain",
        message:
          "A chain is two or more workflows. Use /workflows/accept for one.",
      });
    }
    for (const link of links) {
      const key = String(link.graphKey ?? "").trim();
      if (!/^[a-z0-9]+(\.[a-z0-9-]+)+$/.test(key)) {
        return reply.code(400).send({
          error: "graph_key_convention",
          message: `"${key}" should look like module.thing.workflow — lowercase, dotted.`,
        });
      }
      if (!String(link.triggerEventType ?? "").trim()) {
        return reply.code(400).send({
          error: "trigger_required",
          message: `${key} has no trigger, so nothing could ever start it.`,
        });
      }
      if (!Array.isArray(link.nodes) || link.nodes.length === 0) {
        return reply.code(400).send({
          error: "no_steps",
          message: `${key} has no steps.`,
        });
      }
    }

    try {
      return await withOrgScope(pool, readOrgId(req.headers), async (client) => {
        /**
         * ALL OR NOTHING.
         *
         * Half a chain is worse than none: workflows that hand off to
         * something that was never created, and a new event in the shared
         * catalogue that nothing publishes. One transaction, so a failure on
         * the third link leaves no trace of the first two.
         */
        await client.query("BEGIN");
        try {
          const taken: string[] = [];
          for (const link of links) {
            const exists = await client.query(
              `SELECT 1 FROM graph_definitions WHERE graph_key = $1 LIMIT 1`,
              [String(link.graphKey)],
            );
            if (exists.rowCount) taken.push(String(link.graphKey));
          }
          if (taken.length > 0) {
            await client.query("ROLLBACK");
            return reply.code(409).send({
              error: "graph_key_taken",
              message: `${taken.join(", ")} already exist${taken.length === 1 ? "s" : ""}. Rename before accepting the chain.`,
            });
          }

          const createdEvents: string[] = [];
          const created: Array<{ graphKey: string; module: string }> = [];

          for (const link of links) {
            const graphKey = String(link.graphKey).trim();
            const trigger = String(link.triggerEventType).trim();

            /**
             * A handoff nobody has declared yet.
             *
             * Registered permissively — `additionalProperties: true` — because
             * what it carries is decided by whoever emits it, and guessing a
             * strict shape now would start rejecting the very events this
             * chain is meant to produce. The same reason the bootstrap
             * registers placeholder schemas rather than inventing fields.
             */
            if (link.registerTrigger === true) {
              const already = await client.query(
                `SELECT 1 FROM event_schemas WHERE event_type = $1 LIMIT 1`,
                [trigger],
              );
              if (!already.rowCount) {
                await client.query(
                  `INSERT INTO event_schemas (
                     event_type, schema_version, description, payload_schema,
                     envelope_fields, produced_when, primary_consumer, status
                   )
                   SELECT $1, '1.0', $2,
                     '{"type":"object","additionalProperties":true}'::jsonb,
                     e.envelope_fields, $3, $4, 'ACTIVE'
                   FROM event_schemas e WHERE e.schema_version = '1.0' LIMIT 1`,
                  [
                    trigger,
                    `Handoff from ${String(link.fromModule ?? "one application")} to ${String(link.module ?? "another")}, created with a workflow chain.`,
                    String(link.fromModule ?? "another application"),
                    graphKey,
                  ],
                );
                createdEvents.push(trigger);
              }
            }

            const nodes = link.nodes as Array<any>;
            const edges: Array<[string, string]> = [
              ["__start__", String(nodes[0].id)],
            ];
            for (let i = 0; i < nodes.length - 1; i += 1) {
              edges.push([String(nodes[i].id), String(nodes[i + 1].id)]);
            }
            edges.push([String(nodes[nodes.length - 1].id), "__end__"]);

            const definition = {
              graphKey,
              // The trigger lives in the definition because a draft binding
              // cannot be stored. For links after the first this IS the
              // handoff, which is what makes the chain recoverable later.
              entryInput: trigger,
              nodes: nodes.map((n) => ({
                id: String(n.id),
                impl: String(n.impl),
                config: n.config ?? {},
              })),
              edges,
            };

            await client.query(
              `INSERT INTO graph_definitions
                 (id, org_id, graph_key, version, definition, checksum, status, created_by)
               VALUES ($1, NULL, $2, 1, $3::jsonb, $4, 'draft', $5)`,
              [
                `${graphKey}@1`,
                graphKey,
                JSON.stringify(definition),
                checksumOf(definition),
                req.headers["x-admin-id"] ?? "admin-local",
              ],
            );
            created.push({ graphKey, module: String(link.module ?? "") });
          }

          await client.query("COMMIT");
          return {
            created,
            createdEvents,
            status: "draft",
            /**
             * Said plainly because it is the thing people assume otherwise:
             * accepting a chain changes nothing about what runs today.
             */
            note:
              "Every workflow is a draft. Nothing runs until each one goes " +
              "live, and each go-live is checked on its own.",
          };
        } catch (err) {
          await client.query("ROLLBACK");
          throw err;
        }
      });
    } catch (err: any) {
      req.log?.error?.(err);
      return reply
        .code(500)
        .send({ error: "accept_chain_failed", message: String(err) });
    }
  });

  app.post("/workflows/accept", async (req: any, reply: any) => {
    const body = req.body ?? {};
    const graphKey = String(body.graphKey ?? "").trim();
    const triggerEventType = String(body.triggerEventType ?? "").trim();
    const nodes = Array.isArray(body.nodes) ? body.nodes : [];

    if (!/^[a-z0-9]+(\.[a-z0-9-]+)+$/.test(graphKey)) {
      return reply.code(400).send({
        error: "graph_key_convention",
        message: `"${graphKey}" should look like module.thing.workflow — lowercase, dotted.`,
      });
    }
    if (!triggerEventType) {
      return reply.code(400).send({
        error: "trigger_required",
        message:
          "A workflow with no trigger can never run. Choose one, or register a new event.",
      });
    }
    if (nodes.length === 0) {
      return reply
        .code(400)
        .send({ error: "no_steps", message: "A workflow needs at least one step." });
    }

    try {
      return await withOrgScope(pool, readOrgId(req.headers), async (client) => {
        const exists = await client.query(
          `SELECT 1 FROM graph_definitions WHERE graph_key = $1 LIMIT 1`,
          [graphKey],
        );
        if (exists.rowCount) {
          return reply.code(409).send({
            error: "graph_key_taken",
            message: `${graphKey} already exists. Choose another name, or edit the existing workflow.`,
          });
        }

        const edges: Array<[string, string]> = [];
        edges.push(["__start__", nodes[0].id]);
        for (let i = 0; i < nodes.length - 1; i++) {
          edges.push([nodes[i].id, nodes[i + 1].id]);
        }
        edges.push([nodes[nodes.length - 1].id, "__end__"]);

        const definition = {
          graphKey,
          // The trigger lives here because a draft binding cannot be stored —
          // see the header. Go-live reads it to create the binding.
          entryInput: triggerEventType,
          nodes: nodes.map((n: any) => ({
            id: String(n.id),
            impl: String(n.impl),
            config: n.config ?? {},
          })),
          edges,
        };

        await client.query(
          `INSERT INTO graph_definitions
             (id, org_id, graph_key, version, definition, checksum, status, created_by)
           VALUES ($1, NULL, $2, 1, $3::jsonb, $4, 'draft', $5)`,
          [
            `${graphKey}@1`,
            graphKey,
            JSON.stringify(definition),
            checksumOf(definition),
            req.headers["x-admin-id"] ?? "admin-local",
          ],
        );

        return {
          graphKey,
          version: 1,
          status: "draft",
          triggerEventType,
          bindingCreated: false,
          note:
            "Draft created. The binding that makes it run is created at go-live — " +
            "a draft binding cannot be stored, and an active one would put an " +
            "unreviewed workflow into production.",
        };
      });
    } catch (err) {
      req.log?.error?.(err);
      return reply
        .code(500)
        .send({ error: "accept_failed", message: String(err) });
    }
  });
}
