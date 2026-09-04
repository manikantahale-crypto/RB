/**
 * What the applications on this platform are, and how work moves between them.
 *
 * WHY THIS FILE EXISTS.
 *
 * Until now "which module is this" was inferred from a string prefix, in three
 * places that disagreed: the node contract's `MODULES` said three, the
 * materializer and the editor each said four, and the live event catalogue and
 * bindings showed five — `orbit`, `relay` and `interview` all running in
 * production while being unrepresentable in a contract.
 *
 * THE PREFIX IS NOT THE OWNER. `syntra.jd.received` is the JD upload front
 * door: it carries a `syntra.` prefix and is consumed by ASTRA, which gates the
 * requirement and then hands off to SYNTRA. Reading the prefix as the producer
 * gives SYNTRA → ASTRA → SYNTRA, which is backwards, and it is a mistake a
 * person reading the catalogue will make as readily as a model will.
 *
 * So ownership is declared here rather than parsed from a name. Two things
 * follow that could not be said before:
 *
 *   - a request can be planned across applications in the right ORDER, because
 *     order is derived from who publishes what and who takes it in, not from
 *     the sequence a model happened to write
 *   - `unassigned` events and modules with no declared front door are visible,
 *     rather than being silently absorbed into "platform"
 */

/* ────────────────────────────── the registry ─────────────────────────── */

export type ModuleSpec = {
  key: string;
  title: string;
  /**
   * What this application is FOR, in one sentence a person would recognise.
   *
   * This is the text a cross-application planner reasons over — it decides
   * which half of a request belongs where — so it must describe the domain,
   * not the implementation. "Owns job requirements" is useful; "runs the
   * requirement workflow" is circular.
   */
  owns: string;
  /**
   * Events that START work in this module and are produced OUTSIDE it — an
   * upload, a webhook, a person clicking something, or another application's
   * handoff.
   *
   * This is the field that fixes the prefix problem: `syntra.jd.received` is
   * listed under ASTRA because ASTRA is what takes it in.
   */
  frontDoor: readonly string[];
  /**
   * Events this module publishes for somebody else to act on. Its own internal
   * events are not listed — only what crosses the boundary.
   */
  handsOff: readonly string[];
  /**
   * Capability lent to every module, rather than an application with a domain
   * of its own. `platform` is the only one today.
   *
   * Stated on every module rather than left off the ones where it is false:
   * an optional flag reads as "not thought about" and, with `as const`, it is
   * not even a property on the others.
   */
  shared: boolean;
};

/**
 * Declared from the live catalogue and bindings as of 2026-08-31.
 *
 * `frontDoor` and `handsOff` are deliberately not exhaustive: they list the
 * events that cross an application boundary, which is what ordering needs.
 * Internal chatter belongs in `event_schemas` and nowhere else.
 */
export const MODULE_REGISTRY = [
  {
    key: "astra",
    title: "Requirements and intake",
    owns:
      "Job requirements: where a requirement or JD arrives from any channel, is quality-checked, " +
      "normalised, and either accepted for matching or rejected.",
    frontDoor: [
      "astra.requirement.received",
      // The JD upload door. Named with a syntra. prefix for historical
      // reasons; ASTRA is what consumes it. See the note at the top.
      "syntra.jd.received",
      "astra.email.received",
      "astra.jobboard.fetch_requested",
    ],
    handsOff: ["syntra.jd.normalized", "astra.requirement.rejected"],
    shared: false,
  },
  {
    key: "syntra",
    title: "Candidates and matching",
    owns:
      "Bench candidates and the matching between them and accepted requirements: profiles, " +
      "duplicate detection, match scoring, shortlists.",
    frontDoor: ["syntra.jd.normalized", "syntra.resume.received"],
    handsOff: ["syntra.shortlist.ready", "syntra.candidate.submitted"],
    shared: false,
  },
  {
    key: "orbit",
    title: "Placements and lifecycle",
    owns:
      "What happens after a candidate is accepted: placement confirmation, lifecycle " +
      "transitions, revenue arrangement and activity history.",
    frontDoor: ["syntra.candidate.submitted", "orbit.placement.requested"],
    handsOff: ["orbit.placement.confirmed"],
    shared: false,
  },
  {
    key: "relay",
    title: "Outbound contact and consent",
    owns:
      "Reaching people outside the company: consent requests and reminders, sending profiles, " +
      "and the redaction that has to happen before anything leaves.",
    frontDoor: ["relay.consent.requested", "relay.profile.share_requested"],
    handsOff: ["relay.consent.granted", "relay.profile.sent"],
    shared: false,
  },
  {
    key: "interview",
    title: "Interviews and scoring",
    owns:
      "Interview sessions: questions presented, answers submitted and scored, follow-ups chosen.",
    frontDoor: ["interview.session.created"],
    handsOff: ["interview.session.completed"],
    shared: false,
  },
  {
    key: "platform",
    title: "Shared platform capability",
    owns:
      "Capability every application borrows rather than a domain of its own: pausing for a " +
      "person, branching on a judgement, retrying.",
    frontDoor: [],
    handsOff: [],
    shared: true,
  },
] as const satisfies readonly ModuleSpec[];

/**
 * Closed set. Onboarding a module adds it above — an unknown module is
 * unrepresentable rather than merely discouraged (principle 1).
 *
 * Written out as a tuple because `z.enum` needs literal members, and filled
 * from the registry at runtime so the two cannot say different things. The
 * cast is the one place they could drift, so a test asserts they match — add a
 * module above without adding it here and that test fails.
 */
export const MODULES = MODULE_REGISTRY.map((m) => m.key) as unknown as readonly [
  "astra",
  "syntra",
  "orbit",
  "relay",
  "interview",
  "platform",
];
export type Module = (typeof MODULES)[number];

/* ─────────────────────────────── ordering ────────────────────────────── */

export type ModuleEdge = {
  from: Module;
  to: Module;
  /** The published event that carries the work across. */
  via: string;
};

/**
 * Which applications hand work to which, and by which event.
 *
 * Derived, never declared twice: an edge exists when one module publishes an
 * event another names as a front door. That is the only definition of "comes
 * before" this platform has — a module is not earlier because it feels
 * earlier, it is earlier because its output is somebody's input.
 */
export function moduleEdges(
  registry: readonly ModuleSpec[] = MODULE_REGISTRY,
): ModuleEdge[] {
  const edges: ModuleEdge[] = [];
  for (const producer of registry) {
    for (const event of producer.handsOff) {
      for (const consumer of registry) {
        if (consumer.key === producer.key) continue;
        if (consumer.frontDoor.includes(event)) {
          edges.push({
            from: producer.key as Module,
            to: consumer.key as Module,
            via: event,
          });
        }
      }
    }
  }
  return edges;
}

/**
 * Put a set of modules in the order work actually flows through them.
 *
 * A topological sort over `moduleEdges`, with two deliberate properties:
 *
 *   - a module nothing hands to comes first, which is what makes an intake
 *     application lead a chain rather than trail it
 *   - a cycle does not throw. Applications legitimately talk both ways, and a
 *     planner that crashes on a round trip is worse than one that returns a
 *     stable order and lets the caller notice. Anything still unplaced is
 *     appended in registry order.
 */
export function orderModules(
  keys: readonly string[],
  registry: readonly ModuleSpec[] = MODULE_REGISTRY,
): Module[] {
  const wanted = registry.filter((m) => keys.includes(m.key));
  const edges = moduleEdges(registry).filter(
    (e) => keys.includes(e.from) && keys.includes(e.to),
  );

  const incoming = new Map<string, number>();
  for (const m of wanted) incoming.set(m.key, 0);
  for (const e of edges) incoming.set(e.to, (incoming.get(e.to) ?? 0) + 1);

  const ordered: Module[] = [];
  const placed = new Set<string>();
  let ready = wanted.filter((m) => (incoming.get(m.key) ?? 0) === 0);

  while (ready.length > 0) {
    // Registry order breaks ties, so the same request always plans the same
    // way. A planner whose output moves between runs cannot be reviewed.
    const next = ready[0]!;
    ordered.push(next.key as Module);
    placed.add(next.key);
    for (const e of edges) {
      if (e.from !== next.key || placed.has(e.to)) continue;
      incoming.set(e.to, (incoming.get(e.to) ?? 1) - 1);
    }
    ready = wanted.filter(
      (m) => !placed.has(m.key) && (incoming.get(m.key) ?? 0) === 0,
    );
  }

  for (const m of wanted) {
    if (!placed.has(m.key)) ordered.push(m.key as Module);
  }
  return ordered;
}

/** The module that takes this event in, if any declares it a front door. */
export function moduleForFrontDoor(
  eventType: string,
  registry: readonly ModuleSpec[] = MODULE_REGISTRY,
): Module | null {
  const hit = registry.find((m) => m.frontDoor.includes(eventType));
  return hit ? (hit.key as Module) : null;
}

/** The module that publishes this event across a boundary, if any. */
export function modulePublishing(
  eventType: string,
  registry: readonly ModuleSpec[] = MODULE_REGISTRY,
): Module | null {
  const hit = registry.find((m) => m.handsOff.includes(eventType));
  return hit ? (hit.key as Module) : null;
}
